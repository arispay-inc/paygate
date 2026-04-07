/**
 * PayGate — Facilitator API routes.
 *
 * Standard x402 facilitator endpoints. Any merchant on the internet
 * can call these to verify/settle payments from agents.
 */
import type { FastifyInstance } from 'fastify';
import { prisma } from '../db.js';
import { settlers, SETTLEMENT_MODE } from '../config.js';
import {
  getNonceStatus,
  reserveNonce,
  confirmNonce,
  releaseNonce,
  NonceConflictError,
  verifyPaymentSignature,
} from '../services/payment.js';
import {
  formatUSDC,
  mockSettle,
  CHAIN_REGISTRY,
  chainFromNetworkId,
  type FacilitatorSettleRequest,
  type FacilitatorSettleResponse,
  type X402ErrorResponse,
  type SettlementChain,
} from '../x402/index.js';

// Facilitator merchant ID (set during seed, passed via init)
let facilitatorMerchantId = '';

export function setFacilitatorMerchantId(id: string) {
  facilitatorMerchantId = id;
}

export function getFacilitatorMerchantId(): string {
  return facilitatorMerchantId;
}

export default async function facilitatorRoutes(app: FastifyInstance) {
  // ── Discovery ────────────────────────────────────────
  app.get('/facilitator', async (_request, reply) => {
    const supportedNetworks = (Object.keys(CHAIN_REGISTRY) as SettlementChain[]).map((chain) => {
      const config = CHAIN_REGISTRY[chain];
      return {
        chain,
        network: config.networkId,
        asset: config.usdcAddress,
        settlement: settlers.has(chain) ? 'on-chain' : 'mock',
      };
    });

    const relayerAddress = settlers.values().next().value?.relayerAddress;

    return reply.send({
      facilitator: 'PayGate',
      version: '1.0.0',
      x402Version: 2,
      settlement: SETTLEMENT_MODE,
      gasSponsored: true,
      supportedNetworks,
      endpoints: {
        verify: 'POST /facilitator/verify',
        settle: 'POST /facilitator/settle',
      },
      ...(relayerAddress && { relayer: relayerAddress }),
    });
  });

  // ── Verify (no settlement) ───────────────────────────
  app.post<{ Body: FacilitatorSettleRequest }>(
    '/facilitator/verify',
    async (request, reply) => {
      const { paymentPayload, paymentRequirements } = request.body || {};

      if (!paymentPayload?.payload?.authorization || !paymentPayload?.payload?.signature) {
        return reply.status(400).send({
          success: false,
          error: 'Missing paymentPayload with authorization and signature',
          code: 'INVALID_REQUEST',
        } as X402ErrorResponse);
      }

      if (!paymentRequirements) {
        return reply.status(400).send({
          success: false,
          error: 'Missing paymentRequirements',
          code: 'INVALID_REQUEST',
        } as X402ErrorResponse);
      }

      try {
        const auth = paymentPayload.payload.authorization;
        const result = verifyPaymentSignature(paymentPayload, paymentRequirements);

        return reply.send({
          valid: result.valid,
          payer: auth.from,
          payTo: auth.to,
          amount: auth.value,
          amountUSDC: formatUSDC(auth.value),
          network: paymentRequirements.network,
          ...(result.errors.length > 0 && { errors: result.errors }),
        });
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : 'Verification failed';
        return reply.status(400).send({ valid: false, error: message });
      }
    },
  );

  // ── Settle ───────────────────────────────────────────
  app.post<{ Body: FacilitatorSettleRequest }>(
    '/facilitator/settle',
    async (request, reply) => {
      const { paymentPayload, paymentRequirements, x402Version } = request.body || {};

      if (!paymentPayload?.payload?.authorization || !paymentPayload?.payload?.signature) {
        return reply.status(400).send({
          success: false,
          errorReason: 'invalid_request',
          errorMessage: 'Missing paymentPayload with authorization and signature',
        } as FacilitatorSettleResponse);
      }

      if (!paymentRequirements) {
        return reply.status(400).send({
          success: false,
          errorReason: 'invalid_request',
          errorMessage: 'Missing paymentRequirements',
        } as FacilitatorSettleResponse);
      }

      const auth = paymentPayload.payload.authorization;
      const networkId = paymentRequirements.network;

      // Reserve nonce BEFORE settlement attempt.
      // If the process crashes mid-settlement, the pending nonce
      // prevents a duplicate settlement on retry.
      try {
        await reserveNonce({
          nonce: auth.nonce,
          network: networkId,
          from: auth.from,
        });
      } catch (err) {
        if (err instanceof NonceConflictError) {
          const status = err.status === 'settled' ? 409 : 202;
          const reason = err.status === 'settled' ? 'nonce_already_used' : 'nonce_pending';
          return reply.status(status).send({
            success: false,
            errorReason: reason,
            errorMessage: err.message,
          } as FacilitatorSettleResponse);
        }
        throw err;
      }

      // Route to the correct chain settler
      const targetChain = chainFromNetworkId(networkId);
      const chainSettler = targetChain ? settlers.get(targetChain) : null;

      let result: FacilitatorSettleResponse;
      try {
        if (chainSettler) {
          result = await chainSettler.settle(paymentPayload);
        } else {
          result = mockSettle(paymentPayload);
        }
      } catch (err) {
        // Settlement threw unexpectedly — release the nonce so agent can retry
        await releaseNonce(auth.nonce, networkId);
        throw err;
      }

      if (result.success) {
        // Confirm the pending nonce with txHash
        await confirmNonce({
          nonce: auth.nonce,
          network: networkId,
          txHash: result.transaction,
        });

        // Audit trail
        await prisma.agfacTransaction.create({
          data: {
            merchantId: facilitatorMerchantId,
            endpointId: null,
            endpointPath: paymentPayload.resource || paymentRequirements.resource || 'unknown',
            price: auth.value,
            payer: auth.from,
            status: 'success',
            txHash: result.transaction,
            metadata: {
              settlementMode: SETTLEMENT_MODE,
              network: result.network,
              payTo: auth.to,
              resource: paymentPayload.resource,
              x402Version: x402Version || 2,
            },
          },
        });
      } else {
        // Settlement failed cleanly — release the nonce so agent can retry
        await releaseNonce(auth.nonce, networkId);
      }

      const status = result.success ? 200 : 402;
      return reply.status(status).send(result);
    },
  );
}

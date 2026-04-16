/**
 * PayGate — Reverse proxy routes (catch-all).
 *
 * MUST be registered last so it doesn't shadow /api/* and /health routes.
 */
import type { FastifyInstance } from 'fastify';
import { prisma } from '../db.js';
import { BASE_URL, settlers, SETTLEMENT_MODE, NETWORK, NETWORK_ID } from '../config.js';
import { reserveNonce, confirmNonce, releaseNonce, NonceConflictError } from '../services/payment.js';
import { findEndpointForProxy, proxyToTarget } from '../services/proxy.js';
import {
  formatUSDC,
  buildAgfacRequirements,
  mockVerifyAgfac,
  CHAIN_REGISTRY,
  type AgfacPaymentPayload,
  type AgfacPaymentRequirements,
  type X402PaymentPayload,
  type X402ErrorResponse,
} from '../x402/index.js';

export default async function proxyRoutes(app: FastifyInstance) {
  // ── Proxy handler ────────────────────────────────────
  async function handleProxyRequest(request: any, reply: any, method: 'GET' | 'POST') {
    const slug = request.params.slug as string;
    const path = '/' + ((request.params as any)['*'] || '');

    if (['api', 'health', 'favicon.ico', 'facilitator', '_'].includes(slug)) {
      return reply.status(404).send({ error: 'Not found' });
    }

    const merchant = await prisma.agfacMerchant.findUnique({ where: { slug } });
    if (!merchant) {
      return reply.status(404).send({
        success: false,
        error: `Merchant "${slug}" not found. Register at ${BASE_URL}`,
        code: 'MERCHANT_NOT_FOUND',
      } as X402ErrorResponse);
    }

    const endpoint = await findEndpointForProxy(slug, path, method);
    if (!endpoint) {
      const available = await prisma.agfacEndpoint.findMany({
        where: { merchantId: merchant.id, active: true },
      });
      const endpointList = available
        .map((e: any) => `${e.method} /${slug}${e.path} — ${e.description} ($${formatUSDC(e.price)})`)
        .sort();

      return reply.status(404).send({
        success: false,
        error: `No ${method} endpoint at /${slug}${path}`,
        code: 'ENDPOINT_NOT_FOUND',
        availableEndpoints: endpointList,
      });
    }

    // ── x402 paywall check ────────────────────────────
    const paymentHeader = request.headers['x-payment'] as string | undefined;

    if (!paymentHeader) {
      const requirements: AgfacPaymentRequirements = buildAgfacRequirements({
        price: endpoint.price,
        payTo: merchant.wallet,
        resource: `${BASE_URL}/${slug}${path}`,
        description: endpoint.description,
        asset: CHAIN_REGISTRY[NETWORK].usdcAddress,
        network: NETWORK_ID,
      });

      return reply
        .status(402)
        .header('X-Payment-Requirements', JSON.stringify(requirements))
        .send({
          error: 'Payment Required',
          requirements,
          message: `This endpoint costs ${formatUSDC(endpoint.price)} USDC per call. Include an X-PAYMENT header.`,
        });
    }

    // ── Decode payment ────────────────────────────────
    // Accepts the standard x402 wire format:
    //   { x402Version, scheme, network, payload: { signature, authorization: { from, to, value, validAfter, validBefore, nonce } } }
    // Legacy flat AgfacPaymentPayload is no longer emitted by any client.
    let rawPayment: X402PaymentPayload;
    try {
      rawPayment = JSON.parse(Buffer.from(paymentHeader, 'base64').toString('utf-8'));
    } catch {
      return reply.status(400).send({
        success: false, error: 'Invalid X-PAYMENT header', code: 'INVALID_PAYMENT',
      } as X402ErrorResponse);
    }

    const auth = rawPayment?.payload?.authorization;
    if (!auth?.nonce || !auth?.from || !rawPayment?.payload?.signature) {
      return reply.status(400).send({
        success: false, error: 'Malformed payment payload — missing authorization fields', code: 'INVALID_PAYMENT',
      } as X402ErrorResponse);
    }

    // Normalise to flat fields used throughout this handler
    const payload: AgfacPaymentPayload = {
      signature: rawPayment.payload.signature,
      from: auth.from,
      value: auth.value,
      nonce: auth.nonce,
      validAfter: Number(auth.validAfter),
      validBefore: Number(auth.validBefore),
    };

    // ── Reserve nonce before settlement ─────────────────
    const networkId = NETWORK_ID;

    try {
      await reserveNonce({ nonce: payload.nonce, network: networkId, from: payload.from });
    } catch (err) {
      if (err instanceof NonceConflictError) {
        const code = err.status === 'settled' ? 'NONCE_REUSED' : 'NONCE_PENDING';
        return reply.status(409).send({
          success: false, error: err.message, code,
        } as X402ErrorResponse);
      }
      throw err;
    }

    // ── Verify + settle ───────────────────────────────
    let txHash: string | undefined;
    let settlementError: string | undefined;

    const chainSettler = settlers.get(NETWORK);

    try {
      if (chainSettler) {
        const x402Payload: X402PaymentPayload = {
          x402Version: rawPayment.x402Version ?? 1,
          payload: {
            signature: payload.signature,
            authorization: {
              from: payload.from,
              to: merchant.wallet,
              value: payload.value,
              validAfter: String(payload.validAfter),
              validBefore: String(payload.validBefore),
              nonce: payload.nonce,
            },
          },
          accepted: {
            scheme: 'exact',
            network: chainSettler.networkId,
            maxAmountRequired: endpoint.price,
            resource: `${BASE_URL}/${slug}${path}`,
            asset: chainSettler.usdcAddress,
            payTo: merchant.wallet,
            extra: { name: 'USDC', version: '2' },
          },
          resource: `${BASE_URL}/${slug}${path}`,
        };

        const result = await chainSettler.settle(x402Payload);
        if (!result.success) {
          settlementError = result.errorReason || result.errorMessage || 'Settlement failed';
        } else {
          txHash = result.transaction;
        }
      } else {
        const result = mockVerifyAgfac(payload, endpoint.price);
        if (!result.valid) {
          settlementError = result.error;
        } else {
          txHash = result.txHash;
        }
      }
    } catch (err) {
      // Settlement threw — release nonce so agent can retry
      await releaseNonce(payload.nonce, networkId);
      throw err;
    }

    if (settlementError) {
      // Settlement failed cleanly — release nonce
      await releaseNonce(payload.nonce, networkId);

      await prisma.agfacTransaction.create({
        data: {
          merchantId: merchant.id,
          endpointId: endpoint.id,
          endpointPath: path,
          price: endpoint.price,
          payer: payload.from || 'unknown',
          status: 'failed',
          errorMessage: settlementError,
        },
      });

      return reply.status(403).send({
        success: false, error: settlementError, code: 'PAYMENT_FAILED',
      } as X402ErrorResponse);
    }

    // ── Confirm nonce with txHash ─────────────────────
    await confirmNonce({ nonce: payload.nonce, network: networkId, txHash });

    // ── Proxy to real API ─────────────────────────────
    const query = (request.query || {}) as Record<string, string>;
    const body = request.body;
    const proxyResult = await proxyToTarget(endpoint, query, body, method);

    await prisma.agfacTransaction.create({
      data: {
        merchantId: merchant.id,
        endpointId: endpoint.id,
        endpointPath: path,
        price: endpoint.price,
        payer: payload.from,
        status: 'success',
        txHash,
        metadata: proxyResult.data,
      },
    });

    return reply.status(proxyResult.status).send({
      success: proxyResult.status < 400,
      data: proxyResult.data,
      payment: {
        txHash,
        payer: payload.from,
        amount: formatUSDC(endpoint.price) + ' USDC',
        merchant: merchant.name,
        settlement: SETTLEMENT_MODE,
      },
    });
  }

  // Catch-all routes
  app.get('/:slug/*', async (request, reply) => handleProxyRequest(request, reply, 'GET'));
  app.post('/:slug/*', async (request, reply) => handleProxyRequest(request, reply, 'POST'));

  // Merchant root (no path)
  app.get('/:slug', async (request, reply) => {
    const slug = (request.params as any).slug;
    if (['api', 'health', 'favicon.ico', 'facilitator', '_'].includes(slug)) return reply.callNotFound();

    const merchant = await prisma.agfacMerchant.findUnique({ where: { slug } });
    if (!merchant) return reply.callNotFound();

    const endpoints = await prisma.agfacEndpoint.findMany({
      where: { merchantId: merchant.id, active: true },
    });

    return reply.send({
      merchant: merchant.name,
      slug: merchant.slug,
      endpoints: endpoints.map((e: any) => ({
        method: e.method,
        path: `/${slug}${e.path}`,
        proxyUrl: `${BASE_URL}/${slug}${e.path}`,
        price: formatUSDC(e.price) + ' USDC',
        description: e.description,
      })),
      message: 'Call any endpoint above. First request returns 402 with price. Pay with X-PAYMENT header to access.',
    });
  });
}

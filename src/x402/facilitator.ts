/**
 * PayGate — Facilitator mock (for local dev / testing).
 */
import { randomBytes, createHmac } from 'crypto';
import type {
  X402PaymentPayload,
  FacilitatorSettleResponse,
  AgfacPaymentPayload,
  VerificationResult,
} from './types.js';

// ── Mock facilitator (for local dev / testing) ──────

const usedNonces = new Set<string>();

/**
 * Mock settlement -- validates payment structure, returns fake txHash.
 * Good enough for local testing; no on-chain interaction.
 * Network must be passed by the caller — it's the deployment's NETWORK_ID
 * (validated upstream), not a fallback.
 */
export function mockSettle(
  paymentPayload: X402PaymentPayload,
  networkId: string,
): FacilitatorSettleResponse {
  const auth = paymentPayload?.payload?.authorization;
  if (!auth) {
    return { success: false, errorReason: 'missing_authorization' };
  }

  if (usedNonces.has(auth.nonce)) {
    return { success: false, errorReason: 'nonce_already_used' };
  }
  usedNonces.add(auth.nonce);

  const now = Math.floor(Date.now() / 1000);
  if (Number(auth.validBefore) < now) {
    return { success: false, errorReason: 'payment_expired' };
  }

  const txHash = `0x${randomBytes(32).toString('hex')}`;
  return {
    success: true,
    payer: auth.from,
    transaction: txHash,
    network: networkId,
  };
}

/**
 * Mock verification for AgFac simplified payment format.
 * Checks nonce, amount, and validity window.
 */
export function mockVerifyAgfac(
  payload: AgfacPaymentPayload,
  requiredAmount: string,
): VerificationResult {
  if (usedNonces.has(payload.nonce)) {
    return { valid: false, error: 'Nonce already used (replay attempt)' };
  }
  if (BigInt(payload.value) < BigInt(requiredAmount)) {
    return { valid: false, error: `Insufficient payment: sent ${payload.value}, need ${requiredAmount}` };
  }
  const now = Math.floor(Date.now() / 1000);
  if (payload.validBefore < now) return { valid: false, error: 'Payment expired' };
  if (payload.validAfter > now) return { valid: false, error: 'Payment not yet valid' };
  if (!payload.signature) return { valid: false, error: 'Missing signature' };

  usedNonces.add(payload.nonce);
  const txHash = '0x' + createHmac('sha256', 'agfac')
    .update(payload.nonce + payload.from + Date.now())
    .digest('hex');
  return { valid: true, txHash };
}

/**
 * Reset mock state (for testing).
 */
export function resetMockState(): void {
  usedNonces.clear();
}

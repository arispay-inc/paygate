/**
 * PayGate — Payment verification and nonce management.
 *
 * DB-backed nonce replay protection using the FacilitatorNonce model.
 *
 * Settlement uses a reserve-before-settle pattern:
 *   1. reserveNonce() -- inserts with settledAt=null (pending)
 *   2. On-chain settlement attempt
 *   3a. Success -> confirmNonce() -- sets settledAt + txHash
 *   3b. Failure -> releaseNonce() -- deletes the pending record
 *
 * If the process crashes between 1 and 3, the pending nonce stays in the DB.
 * On retry, getNonceStatus() returns 'pending' and the caller can decide
 * whether to retry settlement or reject.
 */
import { prisma } from '../db.js';
import { ethers } from 'ethers';
import {
  USDC_BASE_SEPOLIA,
  USDC_BASE_MAINNET,
  USDC_ETHEREUM_MAINNET,
  USDC_POLYGON_MAINNET,
  type X402PaymentAccept,
  type X402PaymentPayload,
} from '../x402/index.js';

export type NonceStatus = 'available' | 'pending' | 'settled';

/**
 * Check the status of a nonce.
 *   - 'available': not in DB, safe to use
 *   - 'pending': reserved but not yet confirmed (settlement in-flight or crashed)
 *   - 'settled': confirmed with txHash
 */
export async function getNonceStatus(nonce: string, network: string): Promise<NonceStatus> {
  const existing = await prisma.facilitatorNonce.findUnique({
    where: { nonce_network: { nonce, network } },
  });
  if (!existing) return 'available';
  return existing.settledAt ? 'settled' : 'pending';
}

/**
 * Reserve a nonce before attempting settlement.
 * Creates a pending record (settledAt=null).
 * Throws if the nonce is already reserved or settled.
 */
export async function reserveNonce(opts: {
  nonce: string;
  network: string;
  from: string;
}): Promise<void> {
  try {
    await prisma.facilitatorNonce.create({
      data: {
        nonce: opts.nonce,
        network: opts.network,
        from: opts.from,
        // settledAt and txHash left null — pending state
      },
    });
  } catch (err: unknown) {
    // Unique constraint violation = nonce already exists
    if (err instanceof Error && err.message.includes('Unique constraint')) {
      const status = await getNonceStatus(opts.nonce, opts.network);
      throw new NonceConflictError(status);
    }
    throw err;
  }
}

/**
 * Confirm a pending nonce after successful settlement.
 */
export async function confirmNonce(opts: {
  nonce: string;
  network: string;
  txHash?: string;
}): Promise<void> {
  await prisma.facilitatorNonce.update({
    where: { nonce_network: { nonce: opts.nonce, network: opts.network } },
    data: {
      txHash: opts.txHash,
      settledAt: new Date(),
    },
  });
}

/**
 * Release a pending nonce after a failed settlement.
 * Allows the agent to retry with the same nonce.
 */
export async function releaseNonce(nonce: string, network: string): Promise<void> {
  await prisma.facilitatorNonce.deleteMany({
    where: {
      nonce,
      network,
      settledAt: null, // only delete if still pending
    },
  });
}

/**
 * Error thrown when a nonce is already reserved or settled.
 */
export class NonceConflictError extends Error {
  public readonly status: NonceStatus;
  constructor(status: NonceStatus) {
    super(status === 'settled'
      ? 'This payment nonce has already been settled'
      : 'This payment nonce is currently being processed');
    this.status = status;
  }
}

// ── Legacy helpers (kept for backward compat with proxy route) ──

export async function isNonceUsed(nonce: string, network: string): Promise<boolean> {
  const status = await getNonceStatus(nonce, network);
  return status !== 'available';
}

export async function recordNonce(opts: {
  nonce: string;
  network: string;
  from: string;
  txHash?: string;
}): Promise<void> {
  // Upsert: if pending record exists, confirm it. Otherwise create confirmed.
  await prisma.facilitatorNonce.upsert({
    where: { nonce_network: { nonce: opts.nonce, network: opts.network } },
    update: { txHash: opts.txHash, settledAt: new Date() },
    create: {
      nonce: opts.nonce,
      network: opts.network,
      from: opts.from,
      txHash: opts.txHash,
      settledAt: new Date(),
    },
  });
}

// ── Known USDC EIP-712 domains per contract address ──

// EIP-712 domain names differ per USDC deployment.
// Base Sepolia USDC (0x036CbD5...) uses "USDC".
// Mainnet contracts (Ethereum, Base, Polygon) use "USD Coin".
// Using the wrong name produces a valid-looking signature that recovers to
// a different address → invalid_exact_evm_signature.
const USDC_DOMAINS: Record<string, { name: string; version: string }> = {
  [USDC_BASE_SEPOLIA.toLowerCase()]: { name: 'USDC', version: '2' },
  [USDC_BASE_MAINNET.toLowerCase()]: { name: 'USD Coin', version: '2' },
  [USDC_ETHEREUM_MAINNET.toLowerCase()]: { name: 'USD Coin', version: '2' },
  [USDC_POLYGON_MAINNET.toLowerCase()]: { name: 'USD Coin', version: '2' },
};

const VERIFY_TYPES = {
  TransferWithAuthorization: [
    { name: 'from', type: 'address' },
    { name: 'to', type: 'address' },
    { name: 'value', type: 'uint256' },
    { name: 'validAfter', type: 'uint256' },
    { name: 'validBefore', type: 'uint256' },
    { name: 'nonce', type: 'bytes32' },
  ],
};

/**
 * Verify an x402 payment signature (EIP-712 transferWithAuthorization).
 * Returns { valid, errors } -- does NOT settle or record nonces.
 */
export function verifyPaymentSignature(
  paymentPayload: X402PaymentPayload,
  paymentRequirements: X402PaymentAccept,
): { valid: boolean; payer: string; errors: string[] } {
  const auth = paymentPayload.payload.authorization;
  const chainId = Number(paymentRequirements.network.split(':')[1]);
  const asset = ethers.getAddress(paymentRequirements.asset);
  const knownDomain = USDC_DOMAINS[asset.toLowerCase()];

  const domain = {
    name: knownDomain?.name || 'USDC',
    version: knownDomain?.version || '2',
    chainId,
    verifyingContract: asset,
  };

  const values = {
    from: ethers.getAddress(auth.from),
    to: ethers.getAddress(auth.to),
    value: BigInt(auth.value),
    validAfter: BigInt(auth.validAfter),
    validBefore: BigInt(auth.validBefore),
    nonce: auth.nonce,
  };

  const recoveredAddress = ethers.verifyTypedData(
    domain,
    VERIFY_TYPES,
    values,
    paymentPayload.payload.signature,
  );

  const errors: string[] = [];
  const now = Math.floor(Date.now() / 1000);

  const signerMatch = recoveredAddress.toLowerCase() === auth.from.toLowerCase();
  if (!signerMatch) errors.push(`Signer mismatch: recovered ${recoveredAddress}, expected ${auth.from}`);

  const amountOk = BigInt(auth.value) >= BigInt(paymentRequirements.maxAmountRequired);
  if (!amountOk) errors.push(`Insufficient amount: ${auth.value} < ${paymentRequirements.maxAmountRequired}`);

  const notExpired = Number(auth.validBefore) > now;
  if (!notExpired) errors.push('Payment expired');

  const isActive = Number(auth.validAfter) <= now;
  if (!isActive) errors.push('Payment not yet valid');

  const payToMatch = auth.to.toLowerCase() === paymentRequirements.payTo.toLowerCase();
  if (!payToMatch) errors.push(`payTo mismatch: ${auth.to} != ${paymentRequirements.payTo}`);

  return {
    valid: signerMatch && amountOk && notExpired && isActive && payToMatch,
    payer: auth.from,
    errors,
  };
}

/**
 * PayGate — x402 type definitions.
 */

// ── x402 Protocol Types (wire format) ──────────────

/** x402 v2 payment requirements -- returned in the HTTP 402 response body. */
export interface X402PaymentRequirements {
  x402Version: 2;
  accepts: X402PaymentAccept[];
}

/** A single payment option within a 402 response. */
export interface X402PaymentAccept {
  /** Always "exact" for EIP-3009 transferWithAuthorization. */
  scheme: 'exact';
  /** CAIP-2 network identifier (e.g. "eip155:84532" for Base Sepolia). */
  network: string;
  /** USDC amount in base units -- 6 decimals (e.g. "55000" = $0.055). */
  maxAmountRequired: string;
  /** The resource being purchased. */
  resource: string;
  /** USDC contract address on the settlement chain. */
  asset: string;
  /** Wallet address that receives the USDC payment. */
  payTo: string;
  /** USDC token metadata for EIP-712. */
  extra: {
    name: 'USDC';
    version: '2';
  };
}

/** EIP-3009 transferWithAuthorization fields. */
export interface TransferAuthorization {
  from: string;
  to: string;
  value: string;
  validAfter: string;
  validBefore: string;
  nonce: string;
}

/**
 * x402 v2 payment payload -- sent by the payer in the X-PAYMENT header
 * as a base64-encoded JSON string.
 */
export interface X402PaymentPayload {
  x402Version: 2;
  payload: {
    signature: string;
    authorization: TransferAuthorization;
  };
  accepted: X402PaymentAccept;
  resource: string;
}

// ── Facilitator API types ─────────────────────────

/** Body sent to POST /facilitator/settle. */
export interface FacilitatorSettleRequest {
  x402Version: number;
  paymentPayload: X402PaymentPayload;
  paymentRequirements: X402PaymentAccept;
}

/** Response from POST /facilitator/settle. */
export interface FacilitatorSettleResponse {
  success: boolean;
  payer?: string;
  transaction?: string;
  network?: string;
  errorReason?: string;
  errorMessage?: string;
}

/** Facilitator verification result (simplified). */
export interface VerificationResult {
  valid: boolean;
  txHash?: string;
  error?: string;
}

// ── AgFac Types (reverse proxy / paywall) ─────────

/** AgFac simplified payment requirements (legacy flat format). */
export interface AgfacPaymentRequirements {
  x402Version: 2;
  scheme: 'exact';
  network: string;
  maxAmountRequired: string;
  payTo: string;
  resource: string;
  description: string;
  asset: string;
  expiry: string;
}

/** Decoded X-PAYMENT header from agent (AgFac simplified format). */
export interface AgfacPaymentPayload {
  signature: string;
  from: string;
  value: string;
  nonce: string;
  validAfter: number;
  validBefore: number;
}

/** A registered merchant (AgFac). */
export interface AgfacMerchant {
  id: string;
  slug: string;
  name: string;
  wallet: string;
  email: string;
  apiKey: string;
  createdAt: string;
}

/** A paywalled API endpoint registered by a merchant. */
export interface PaywalledEndpoint {
  id: string;
  merchantId: string;
  merchantSlug: string;
  path: string;
  targetUrl: string;
  /** Price in USDC base units (6 decimals). 100000 = $0.10. */
  price: string;
  description: string;
  method: 'GET' | 'POST';
  active: boolean;
}

/** Recorded transaction. */
export interface AgfacTransaction {
  id: string;
  timestamp: string;
  merchantId: string;
  merchantSlug: string;
  endpoint: string;
  price: string;
  priceUSDC: string;
  payer: string;
  status: 'success' | 'failed';
  txHash?: string;
  response?: unknown;
}

// ── Shared Types ──────────────────────────────────

/** Standard error response across all x402 services. */
export interface X402ErrorResponse {
  success: false;
  error: string;
  code: string;
}

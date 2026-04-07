/**
 * PayGate — x402 protocol types, constants, and utilities.
 */

// Types
export type {
  // x402 protocol
  X402PaymentRequirements,
  X402PaymentAccept,
  X402PaymentPayload,
  TransferAuthorization,
  FacilitatorSettleRequest,
  FacilitatorSettleResponse,
  VerificationResult,

  // AgFac
  AgfacPaymentRequirements,
  AgfacPaymentPayload,
  AgfacMerchant,
  PaywalledEndpoint,
  AgfacTransaction,

  // Shared
  X402ErrorResponse,
} from './types.js';

// Constants
export {
  // USDC addresses
  USDC_BASE_SEPOLIA,
  USDC_BASE_MAINNET,
  USDC_ETHEREUM_MAINNET,
  USDC_POLYGON_MAINNET,
  USDC_DECIMALS,

  // Chain IDs
  CHAIN_ID_BASE_SEPOLIA,
  CHAIN_ID_BASE_MAINNET,
  CHAIN_ID_ETHEREUM_MAINNET,
  CHAIN_ID_POLYGON_MAINNET,
  CHAIN_ID_POLYGON_AMOY,

  // CAIP-2 network IDs
  NETWORK_BASE_SEPOLIA,
  NETWORK_BASE_MAINNET,
  NETWORK_ETHEREUM_MAINNET,
  NETWORK_POLYGON_MAINNET,
  NETWORK_POLYGON_AMOY,

  // EIP-712
  USDC_EIP712_DOMAIN_BASE_SEPOLIA,
  USDC_EIP712_DOMAIN_BASE_MAINNET,
  TRANSFER_WITH_AUTHORIZATION_TYPES,

  // Defaults
  PAYMENT_EXPIRY_MS,
  RPC_URLS,
} from './constants.js';

// Helpers
export {
  formatUSDC,
  buildAgfacRequirements,
} from './helpers.js';

// Facilitator (mock)
export {
  mockSettle,
  mockVerifyAgfac,
  resetMockState,
} from './facilitator.js';

// On-chain settlement
export {
  createOnChainSettler,
  createHybridSettler,
  CHAIN_REGISTRY,
  chainFromNetworkId,
} from './settlement.js';
export type { SettlementConfig, SettlementChain, ChainConfig } from './settlement.js';

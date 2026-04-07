/**
 * PayGate — Shared constants for x402.
 *
 * Single source of truth for USDC addresses, chain IDs,
 * EIP-712 domain/types, and protocol defaults.
 */

// ── USDC Contract Addresses ──────────────────────────

/** USDC on Base Sepolia (testnet). */
export const USDC_BASE_SEPOLIA = '0x036CbD53842c5426634e7929541eC2318f3dCF7e';

/** USDC on Base Mainnet. */
export const USDC_BASE_MAINNET = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';

/** USDC on Ethereum Mainnet. */
export const USDC_ETHEREUM_MAINNET = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48';

/** USDC on Polygon Mainnet. */
export const USDC_POLYGON_MAINNET = '0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359';

/** USDC has 6 decimal places. */
export const USDC_DECIMALS = 6;

// ── Chain IDs ────────────────────────────────────────

export const CHAIN_ID_BASE_SEPOLIA = 84532;
export const CHAIN_ID_BASE_MAINNET = 8453;
export const CHAIN_ID_ETHEREUM_MAINNET = 1;
export const CHAIN_ID_POLYGON_MAINNET = 137;
export const CHAIN_ID_POLYGON_AMOY = 80002;

// ── CAIP-2 Network Identifiers ──────────────────────

export const NETWORK_BASE_SEPOLIA = 'eip155:84532';
export const NETWORK_BASE_MAINNET = 'eip155:8453';
export const NETWORK_ETHEREUM_MAINNET = 'eip155:1';
export const NETWORK_POLYGON_MAINNET = 'eip155:137';
export const NETWORK_POLYGON_AMOY = 'eip155:80002';

// ── EIP-712 Domains ─────────────────────────────────

/** EIP-712 domain for USDC on Base Sepolia. */
export const USDC_EIP712_DOMAIN_BASE_SEPOLIA = {
  name: 'USD Coin',
  version: '2',
  chainId: CHAIN_ID_BASE_SEPOLIA,
  verifyingContract: USDC_BASE_SEPOLIA,
} as const;

/** EIP-712 domain for USDC on Base Mainnet. */
export const USDC_EIP712_DOMAIN_BASE_MAINNET = {
  name: 'USD Coin',
  version: '2',
  chainId: CHAIN_ID_BASE_MAINNET,
  verifyingContract: USDC_BASE_MAINNET,
} as const;

// ── EIP-712 Types ───────────────────────────────────

/**
 * EIP-712 types for TransferWithAuthorization (EIP-3009).
 * ethers.js v6 format -- omit EIP712Domain (added automatically).
 */
export const TRANSFER_WITH_AUTHORIZATION_TYPES = {
  TransferWithAuthorization: [
    { name: 'from', type: 'address' },
    { name: 'to', type: 'address' },
    { name: 'value', type: 'uint256' },
    { name: 'validAfter', type: 'uint256' },
    { name: 'validBefore', type: 'uint256' },
    { name: 'nonce', type: 'bytes32' },
  ],
} as const;

// ── Protocol Defaults ───────────────────────────────

/** Default payment expiry window (5 minutes). */
export const PAYMENT_EXPIRY_MS = 5 * 60 * 1000;

/** RPC URLs */
export const RPC_URLS = {
  BASE_SEPOLIA: 'https://sepolia.base.org',
  BASE_MAINNET: 'https://mainnet.base.org',
  POLYGON_AMOY: 'https://rpc-amoy.polygon.technology',
} as const;

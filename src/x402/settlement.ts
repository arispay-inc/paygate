/**
 * PayGate — On-chain USDC settlement via EIP-3009.
 *
 * This module handles real on-chain settlement of x402 payments
 * by calling USDC's transferWithAuthorization contract function.
 *
 * Supports Base Sepolia (testnet), Base Mainnet, Ethereum, Polygon.
 */
import { ethers } from 'ethers';
import type { X402PaymentPayload, FacilitatorSettleResponse } from './types.js';
import {
  USDC_BASE_SEPOLIA,
  USDC_BASE_MAINNET,
  USDC_ETHEREUM_MAINNET,
  USDC_POLYGON_MAINNET,
  RPC_URLS,
  CHAIN_ID_BASE_SEPOLIA,
  CHAIN_ID_BASE_MAINNET,
  CHAIN_ID_ETHEREUM_MAINNET,
  CHAIN_ID_POLYGON_MAINNET,
  NETWORK_BASE_SEPOLIA,
  NETWORK_BASE_MAINNET,
  NETWORK_ETHEREUM_MAINNET,
  NETWORK_POLYGON_MAINNET,
} from './constants.js';

// ── USDC ABI (just the function we need) ────────────

const USDC_ABI = [
  'function transferWithAuthorization(address from, address to, uint256 value, uint256 validAfter, uint256 validBefore, bytes32 nonce, uint8 v, bytes32 r, bytes32 s) external',
  'function balanceOf(address) view returns (uint256)',
  'function allowance(address owner, address spender) view returns (uint256)',
];

// ── Supported chains ───────────────────────────────

export type SettlementChain =
  | 'base-sepolia'
  | 'base'
  | 'ethereum'
  | 'polygon';

export interface ChainConfig {
  usdcAddress: string;
  networkId: string;
  chainId: number;
  defaultRpcUrl: string;
}

export const CHAIN_REGISTRY: Record<SettlementChain, ChainConfig> = {
  'base-sepolia': {
    usdcAddress: USDC_BASE_SEPOLIA,
    networkId: NETWORK_BASE_SEPOLIA,
    chainId: CHAIN_ID_BASE_SEPOLIA,
    defaultRpcUrl: RPC_URLS.BASE_SEPOLIA,
  },
  'base': {
    usdcAddress: USDC_BASE_MAINNET,
    networkId: NETWORK_BASE_MAINNET,
    chainId: CHAIN_ID_BASE_MAINNET,
    defaultRpcUrl: RPC_URLS.BASE_MAINNET,
  },
  'ethereum': {
    usdcAddress: USDC_ETHEREUM_MAINNET,
    networkId: NETWORK_ETHEREUM_MAINNET,
    chainId: CHAIN_ID_ETHEREUM_MAINNET,
    defaultRpcUrl: 'https://eth.llamarpc.com',
  },
  'polygon': {
    usdcAddress: USDC_POLYGON_MAINNET,
    networkId: NETWORK_POLYGON_MAINNET,
    chainId: CHAIN_ID_POLYGON_MAINNET,
    defaultRpcUrl: 'https://polygon-rpc.com',
  },
};

/**
 * Resolve a CAIP-2 network ID (e.g. "eip155:8453") to a settlement chain.
 * Returns undefined if the network is not supported.
 */
export function chainFromNetworkId(networkId: string): SettlementChain | undefined {
  for (const [chain, config] of Object.entries(CHAIN_REGISTRY)) {
    if (config.networkId === networkId) return chain as SettlementChain;
  }
  return undefined;
}

// ── Settlement configuration ────────────────────────

export interface SettlementConfig {
  /** Private key of the relayer wallet that submits the tx. */
  relayerPrivateKey: string;
  /** Chain to settle on. Required — no implicit default. */
  chain: SettlementChain;
  /** Custom RPC URL (overrides default). */
  rpcUrl?: string;
}

/**
 * Create an on-chain settlement function.
 *
 * Returns a function that takes a PaymentPayload and submits
 * the transferWithAuthorization on-chain.
 */
export function createOnChainSettler(config: SettlementConfig) {
  const chain = config.chain;
  const chainConfig = CHAIN_REGISTRY[chain];
  const rpcUrl = config.rpcUrl ?? chainConfig.defaultRpcUrl;
  const usdcAddress = chainConfig.usdcAddress;
  const networkId = chainConfig.networkId;

  const provider = new ethers.JsonRpcProvider(rpcUrl);
  const relayerWallet = new ethers.Wallet(config.relayerPrivateKey, provider);
  const usdcContract = new ethers.Contract(usdcAddress, USDC_ABI, relayerWallet);

  /**
   * Settle a payment on-chain by submitting the signed
   * transferWithAuthorization to the USDC contract.
   */
  async function settle(paymentPayload: X402PaymentPayload): Promise<FacilitatorSettleResponse> {
    const auth = paymentPayload?.payload?.authorization;
    const signature = paymentPayload?.payload?.signature;

    if (!auth || !signature) {
      return { success: false, errorReason: 'missing_authorization_or_signature' };
    }

    try {
      // Split the EIP-712 signature into v, r, s
      const sig = ethers.Signature.from(signature);

      // Submit transferWithAuthorization on-chain
      const tx = await usdcContract.transferWithAuthorization(
        auth.from,
        auth.to,
        BigInt(auth.value),
        BigInt(auth.validAfter),
        BigInt(auth.validBefore),
        auth.nonce,
        sig.v,
        sig.r,
        sig.s,
        { gasLimit: 150_000 },
      );

      // Wait for confirmation (1 block)
      const receipt = await tx.wait(1);

      return {
        success: true,
        payer: auth.from,
        transaction: receipt.hash,
        network: networkId,
      };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Settlement transaction failed';

      // Parse common revert reasons
      if (message.includes('caller must be the payee')) {
        return { success: false, errorReason: 'caller_not_payee', errorMessage: 'Relayer must be the payTo address' };
      }
      if (message.includes('authorization is used')) {
        return { success: false, errorReason: 'nonce_already_used', errorMessage: 'This authorization has already been used' };
      }
      if (message.includes('authorization is expired')) {
        return { success: false, errorReason: 'payment_expired', errorMessage: 'The authorization has expired' };
      }
      if (message.includes('insufficient balance') || message.includes('ERC20: transfer amount exceeds balance')) {
        return { success: false, errorReason: 'insufficient_balance', errorMessage: 'Payer has insufficient USDC balance' };
      }

      return { success: false, errorReason: 'transaction_failed', errorMessage: message };
    }
  }

  /**
   * Check USDC balance of an address.
   */
  async function getBalance(address: string): Promise<bigint> {
    return usdcContract.balanceOf(address);
  }

  return {
    settle,
    getBalance,
    relayerAddress: relayerWallet.address,
    chain,
    usdcAddress,
    networkId,
  };
}

/**
 * Create a hybrid settler that tries on-chain first, falls back to mock.
 * Useful during development: real settlement when wallet is funded, mock otherwise.
 */
export function createHybridSettler(config: SettlementConfig) {
  const onChain = createOnChainSettler(config);

  return {
    ...onChain,
    async settle(paymentPayload: X402PaymentPayload): Promise<FacilitatorSettleResponse> {
      try {
        const result = await onChain.settle(paymentPayload);
        if (result.success) return result;
        // If on-chain fails, fall back to mock for dev convenience
        console.warn(`[paygate] On-chain settlement failed (${result.errorReason}), falling back to mock`);
        const { mockSettle } = await import('./facilitator.js');
        return mockSettle(paymentPayload, onChain.networkId);
      } catch {
        console.warn('[paygate] On-chain settlement error, falling back to mock');
        const { mockSettle } = await import('./facilitator.js');
        return mockSettle(paymentPayload, onChain.networkId);
      }
    },
  };
}

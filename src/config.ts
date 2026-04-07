/**
 * PayGate — Configuration and settlement setup.
 */
import 'dotenv/config';
import {
  createHybridSettler,
  createOnChainSettler,
  CHAIN_REGISTRY,
  type SettlementChain,
} from './x402/index.js';

// ── Server ──────────────────────────────────────────

export const PORT = Number(process.env.PORT) || 4404;
export const BASE_URL = process.env.BASE_URL || `http://localhost:${PORT}`;
export const NODE_ENV = process.env.NODE_ENV || 'development';

// ── CORS ────────────────────────────────────────────

function parseCorsOrigin(): string | string[] | boolean {
  const raw = process.env.CORS_ORIGIN;
  if (!raw) {
    return NODE_ENV === 'production'
      ? 'https://agfac-production.up.railway.app'
      : true; // allow all in dev
  }
  if (raw === '*') return true;
  if (raw.includes(',')) return raw.split(',').map((s) => s.trim());
  return raw;
}

export const CORS_ORIGIN = parseCorsOrigin();

// ── Settlement ──────────────────────────────────────

export const RELAYER_PRIVATE_KEY = process.env.RELAYER_PRIVATE_KEY || '';
export const SETTLEMENT_STRICT = !!process.env.SETTLEMENT_STRICT;
export const SETTLEMENT_MODE = RELAYER_PRIVATE_KEY ? 'on-chain' : 'mock';

/**
 * Build settlers for every supported chain.
 * In strict mode, use createOnChainSettler (no mock fallback).
 * In default mode, use createHybridSettler (falls back to mock on failure).
 */
export const settlers = new Map<SettlementChain, ReturnType<typeof createHybridSettler>>();

if (RELAYER_PRIVATE_KEY) {
  const rpcOverrides: Partial<Record<SettlementChain, string | undefined>> = {
    'base-sepolia': process.env.BASE_SEPOLIA_RPC_URL || process.env.BASE_RPC_URL,
    'base-mainnet': process.env.BASE_MAINNET_RPC_URL,
    'ethereum-mainnet': process.env.ETHEREUM_RPC_URL,
    'polygon-mainnet': process.env.POLYGON_RPC_URL,
  };

  const factory = SETTLEMENT_STRICT ? createOnChainSettler : createHybridSettler;

  for (const chain of Object.keys(CHAIN_REGISTRY) as SettlementChain[]) {
    settlers.set(chain, factory({
      relayerPrivateKey: RELAYER_PRIVATE_KEY,
      chain,
      rpcUrl: rpcOverrides[chain] || undefined,
    }));
  }

  const first = settlers.values().next().value!;
  console.log(`  Settlement: ${SETTLEMENT_STRICT ? 'STRICT ON-CHAIN' : 'ON-CHAIN'} (relayer ${first.relayerAddress.slice(0, 10)}... on ${settlers.size} chains)`);
} else {
  console.log('  Settlement: MOCK (set RELAYER_PRIVATE_KEY for real settlement)');
}

// ── Admin ───────────────────────────────────────────

export const ADMIN_API_KEY = process.env.ADMIN_API_KEY || '';

// ── Demo ────────────────────────────────────────────

export const DEMO_MERCHANT_WALLET = process.env.DEMO_MERCHANT_WALLET || '0x0000000000000000000000000000000000000001';

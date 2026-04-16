/**
 * PayGate — Configuration and settlement setup.
 *
 * Single-network deployment: one PayGate service handles exactly one chain,
 * selected via the NETWORK env var. No implicit defaults, no silent fallbacks.
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

// ── Network (single-network deployment) ────────────

const VALID_NETWORKS: readonly SettlementChain[] = ['base-sepolia', 'base', 'ethereum', 'polygon'];
const rawNetwork = process.env.NETWORK;
if (!rawNetwork || !(VALID_NETWORKS as readonly string[]).includes(rawNetwork)) {
  console.error(
    `[startup] NETWORK must be one of: ${VALID_NETWORKS.join(', ')} (got: ${rawNetwork ?? 'unset'})`,
  );
  process.exit(1);
}
export const NETWORK = rawNetwork as SettlementChain;
export const NETWORK_ID = CHAIN_REGISTRY[NETWORK].networkId; // CAIP-2 e.g. "eip155:8453"

// ── Settlement ──────────────────────────────────────

export const RELAYER_PRIVATE_KEY = process.env.RELAYER_PRIVATE_KEY || '';
export const SETTLEMENT_STRICT = !!process.env.SETTLEMENT_STRICT;
export const SETTLEMENT_MODE = RELAYER_PRIVATE_KEY ? 'on-chain' : 'mock';

// RPC URL for the deployment's network. Sepolia is allowed to fall back to
// viem/ethers' public RPC; every other network requires an explicit URL or
// settlement will fail opaquely at transaction time.
const RPC_ENV_VAR: Record<SettlementChain, string> = {
  'base-sepolia': 'BASE_SEPOLIA_RPC_URL',
  'base': 'BASE_MAINNET_RPC_URL',
  'ethereum': 'ETHEREUM_RPC_URL',
  'polygon': 'POLYGON_RPC_URL',
};
const rpcEnvVar = RPC_ENV_VAR[NETWORK];
const rpcUrl = process.env[rpcEnvVar] || (NETWORK === 'base-sepolia' ? process.env.BASE_RPC_URL : undefined);
if (NETWORK !== 'base-sepolia' && !rpcUrl) {
  console.error(`[startup] NETWORK=${NETWORK} requires ${rpcEnvVar}`);
  process.exit(1);
}

// Build exactly one settler for the deployment's network (if relayer key set)
export const settlers = new Map<SettlementChain, ReturnType<typeof createHybridSettler>>();

if (RELAYER_PRIVATE_KEY) {
  const factory = SETTLEMENT_STRICT ? createOnChainSettler : createHybridSettler;
  const settler = factory({
    relayerPrivateKey: RELAYER_PRIVATE_KEY,
    chain: NETWORK,
    rpcUrl,
  });
  settlers.set(NETWORK, settler);
  console.log(
    `  Settlement: ${SETTLEMENT_STRICT ? 'STRICT ON-CHAIN' : 'ON-CHAIN'} (relayer ${settler.relayerAddress.slice(0, 10)}... on ${NETWORK})`,
  );
} else {
  console.log(`  Settlement: MOCK on ${NETWORK} (set RELAYER_PRIVATE_KEY for real settlement)`);
}

// ── Admin ───────────────────────────────────────────

export const ADMIN_API_KEY = process.env.ADMIN_API_KEY || '';

// ── Demo ────────────────────────────────────────────

export const DEMO_MERCHANT_WALLET = process.env.DEMO_MERCHANT_WALLET || '0x0000000000000000000000000000000000000001';

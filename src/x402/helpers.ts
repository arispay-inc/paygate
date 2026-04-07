/**
 * PayGate — Shared utility functions.
 */
import { USDC_DECIMALS } from './constants.js';

/**
 * Format USDC base units (string) to human-readable string.
 * e.g. "100000" -> "0.10", "1000000" -> "1.00"
 */
export function formatUSDC(baseUnits: string | bigint): string {
  const n = Number(BigInt(baseUnits)) / 10 ** USDC_DECIMALS;
  return n < 0.01 ? n.toFixed(4) : n.toFixed(2);
}

/**
 * Build a simplified AgFac-style payment requirements object.
 */
export function buildAgfacRequirements(opts: {
  price: string;
  payTo: string;
  resource: string;
  description: string;
  asset: string;
  network: string;
  expiryMs?: number;
}): {
  x402Version: 2;
  scheme: 'exact';
  network: string;
  maxAmountRequired: string;
  payTo: string;
  resource: string;
  description: string;
  asset: string;
  expiry: string;
} {
  const { price, payTo, resource, description, asset, network, expiryMs = 5 * 60 * 1000 } = opts;
  return {
    x402Version: 2,
    scheme: 'exact',
    network,
    maxAmountRequired: price,
    payTo,
    resource,
    description,
    asset,
    expiry: new Date(Date.now() + expiryMs).toISOString(),
  };
}

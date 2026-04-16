/**
 * PayGate — Merchant business logic.
 */
import { randomBytes, createHash } from 'crypto';
import { prisma } from '../db.js';
import type { AgfacMerchant, PaywalledEndpoint } from '../x402/index.js';

export function generateSlug(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

export function hashApiKey(key: string): string {
  return createHash('sha256').update(key).digest('hex');
}

export async function createMerchantInternal(data: {
  name: string;
  slug?: string;
  email: string;
  wallet: string;
}): Promise<AgfacMerchant> {
  const apiKey = 'agfac_' + randomBytes(24).toString('hex');
  const slug = data.slug || generateSlug(data.name) + '-' + randomBytes(2).toString('hex');
  const apiKeyHash = hashApiKey(apiKey);

  const merchant = await prisma.agfacMerchant.create({
    data: {
      slug,
      name: data.name,
      wallet: data.wallet,
      email: data.email,
      apiKeyHash,
    },
  });

  return {
    id: merchant.id,
    slug: merchant.slug,
    name: merchant.name,
    wallet: merchant.wallet,
    email: merchant.email,
    apiKey,
    createdAt: merchant.createdAt.toISOString(),
  };
}

export async function addEndpointInternal(
  merchantId: string,
  data: {
    path: string;
    targetUrl: string;
    price: string;
    description: string;
    method: 'GET' | 'POST';
  },
): Promise<PaywalledEndpoint> {
  const merchant = await prisma.agfacMerchant.findUnique({ where: { id: merchantId } });
  if (!merchant) throw new Error('Merchant not found');

  let path = data.path.startsWith('/') ? data.path : '/' + data.path;
  path = path.replace(/\/$/, '');

  const ep = await prisma.agfacEndpoint.create({
    data: {
      merchantId,
      path,
      targetUrl: data.targetUrl,
      price: data.price,
      description: data.description,
      method: data.method,
      active: true,
    },
  });

  return {
    id: ep.id,
    merchantId: ep.merchantId,
    merchantSlug: merchant.slug,
    path: ep.path,
    targetUrl: ep.targetUrl,
    price: ep.price,
    description: ep.description,
    method: ep.method as 'GET' | 'POST',
    active: ep.active,
  };
}

export async function getMerchantRevenue(merchantId: string): Promise<bigint> {
  const transactions = await prisma.agfacTransaction.findMany({
    where: { merchantId, status: 'success' },
    select: { price: true },
  });
  return transactions.reduce((sum: bigint, t: { price: string }) => sum + BigInt(t.price), 0n);
}

export async function getMerchantByApiKey(key: string) {
  const keyHash = hashApiKey(key);
  return prisma.agfacMerchant.findUnique({ where: { apiKeyHash: keyHash } });
}

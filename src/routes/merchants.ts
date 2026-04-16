/**
 * PayGate — Merchant management routes.
 */
import type { FastifyInstance } from 'fastify';
import { prisma } from '../db.js';
import { BASE_URL, NETWORK } from '../config.js';
import { formatUSDC } from '../x402/index.js';
import { createMerchantInternal, getMerchantRevenue, hashApiKey } from '../services/merchant.js';

export default async function merchantRoutes(app: FastifyInstance) {
  // ── Register merchant ────────────────────────────────
  app.post<{
    Body: { name: string; email: string; wallet: string };
  }>('/api/merchants', async (request, reply) => {
    const { name, email, wallet } = request.body || {};

    if (!name || !email || !wallet) {
      return reply.status(400).send({
        success: false, error: 'Missing required fields: name, email, wallet', code: 'INVALID_REQUEST',
      });
    }
    if (!/^0x[a-fA-F0-9]{40}$/.test(wallet)) {
      return reply.status(400).send({
        success: false, error: 'Invalid wallet address (must be 0x + 40 hex chars)', code: 'INVALID_WALLET',
      });
    }

    const merchant = await createMerchantInternal({ name, email, wallet });
    return reply.status(201).send({
      success: true,
      merchant: {
        id: merchant.id,
        slug: merchant.slug,
        name: merchant.name,
        wallet: merchant.wallet,
        email: merchant.email,
        apiKey: merchant.apiKey,
        network: NETWORK,
        proxyBase: `${BASE_URL}/${merchant.slug}`,
        createdAt: merchant.createdAt,
      },
      message: `Merchant "${merchant.name}" registered on ${NETWORK}. Proxy: ${BASE_URL}/${merchant.slug}`,
    });
  });

  // ── List merchants (public directory) ────────────────
  app.get<{
    Querystring: { page?: string; limit?: string };
  }>('/api/merchants', async (request, reply) => {
    const page = Math.max(1, Number(request.query.page) || 1);
    const limit = Math.min(100, Math.max(1, Number(request.query.limit) || 20));
    const skip = (page - 1) * limit;

    const [merchants, total] = await Promise.all([
      prisma.agfacMerchant.findMany({
        skip,
        take: limit,
        include: { _count: { select: { endpoints: { where: { active: true } } } } },
      }),
      prisma.agfacMerchant.count(),
    ]);

    // Public directory: name, slug, proxyBase, endpoint count only
    const list = merchants.map((m: any) => ({
      id: m.id,
      slug: m.slug,
      name: m.name,
      proxyBase: `${BASE_URL}/${m.slug}`,
      endpoints: m._count.endpoints,
    }));

    return reply.send({
      data: list,
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
    });
  });

  // ── Get merchant details ─────────────────────────────
  app.get<{ Params: { id: string } }>('/api/merchants/:id', async (request, reply) => {
    const merchant = await prisma.agfacMerchant.findFirst({
      where: {
        OR: [
          { id: request.params.id },
          { slug: request.params.id },
        ],
      },
      include: {
        endpoints: { where: { active: true } },
      },
    });

    if (!merchant) {
      return reply.status(404).send({ success: false, error: 'Merchant not found', code: 'NOT_FOUND' });
    }

    // Check if caller is the merchant (authenticated via API key header)
    const authKey = request.headers['authorization']?.replace('Bearer ', '').trim();
    const isOwner = authKey ? hashApiKey(authKey) === merchant.apiKeyHash : false;

    const response: any = {
      id: merchant.id,
      slug: merchant.slug,
      name: merchant.name,
      proxyBase: `${BASE_URL}/${merchant.slug}`,
      endpoints: merchant.endpoints.map((e: any) => ({
        id: e.id,
        path: e.path,
        proxyUrl: `${BASE_URL}/${merchant.slug}${e.path}`,
        targetUrl: e.targetUrl.startsWith('__builtin:') ? '(built-in demo)' : e.targetUrl,
        price: e.price,
        priceUSDC: formatUSDC(e.price),
        method: e.method,
        description: e.description,
      })),
    };

    // Only expose wallet + revenue to the merchant themselves
    if (isOwner) {
      response.wallet = merchant.wallet;
      response.network = NETWORK;
      response.revenue = formatUSDC((await getMerchantRevenue(merchant.id)).toString());
    }

    return reply.send(response);
  });

  // ── Login with API key ───────────────────────────────
  app.post<{ Body: { apiKey: string } }>('/api/login', {
    config: { rateLimit: { max: 5, timeWindow: '1 minute' } },
  }, async (request, reply) => {
    const key = (request.body?.apiKey || '').trim();
    const keyHash = hashApiKey(key);

    const merchant = await prisma.agfacMerchant.findUnique({
      where: { apiKeyHash: keyHash },
      include: {
        endpoints: { where: { active: true } },
        transactions: true,
      },
    });

    if (!merchant) {
      return reply.status(401).send({ success: false, error: 'Secret key not found', code: 'INVALID_KEY' });
    }

    return reply.send({
      success: true,
      merchant: {
        id: merchant.id,
        slug: merchant.slug,
        name: merchant.name,
        email: merchant.email,
        wallet: merchant.wallet,
        apiKey: key,
        network: NETWORK,
        proxyBase: `${BASE_URL}/${merchant.slug}`,
        endpoints: merchant.endpoints.map((e: any) => ({
          id: e.id,
          path: e.path,
          proxyUrl: `${BASE_URL}/${merchant.slug}${e.path}`,
          price: e.price,
          priceUSDC: formatUSDC(e.price),
          method: e.method,
          description: e.description,
        })),
        totalRevenue: formatUSDC((await getMerchantRevenue(merchant.id)).toString()),
        totalTransactions: merchant.transactions.length,
      },
    });
  });
}

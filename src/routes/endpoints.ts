/**
 * PayGate — Endpoint management routes.
 */
import type { FastifyInstance } from 'fastify';
import { prisma } from '../db.js';
import { BASE_URL } from '../config.js';
import { formatUSDC } from '../x402/index.js';
import { addEndpointInternal } from '../services/merchant.js';
import { requireMerchantAuth } from '../middleware/api-key-auth.js';

export default async function endpointRoutes(app: FastifyInstance) {
  // ── Add endpoint (authenticated) ─────────────────────
  app.post<{
    Body: {
      merchantId?: string;
      apiKey?: string;
      path: string;
      targetUrl: string;
      price: string;
      description: string;
      method: 'GET' | 'POST';
    };
  }>('/api/endpoints', {
    preHandler: requireMerchantAuth,
  }, async (request, reply) => {
    const merchant = (request as any).merchant;
    const { path, targetUrl, price, description, method } = request.body || {};

    if (!path || !targetUrl || !price || !description || !method) {
      return reply.status(400).send({
        success: false, error: 'Missing fields: path, targetUrl, price, description, method', code: 'INVALID_REQUEST',
      });
    }

    const ep = await addEndpointInternal(merchant.id, { path, targetUrl, price, description, method });
    return reply.status(201).send({
      success: true,
      endpoint: {
        id: ep.id,
        path: ep.path,
        proxyUrl: `${BASE_URL}/${merchant.slug}${ep.path}`,
        targetUrl: ep.targetUrl,
        price: ep.price,
        priceUSDC: formatUSDC(ep.price),
        method: ep.method,
        description: ep.description,
      },
      message: `Endpoint added. Agents can now call ${BASE_URL}/${merchant.slug}${ep.path}`,
    });
  });

  // ── List endpoints ───────────────────────────────────
  app.get<{
    Querystring: { merchantId?: string; slug?: string; page?: string; limit?: string };
  }>('/api/endpoints', async (request, reply) => {
    const { merchantId, slug } = request.query;
    const page = Math.max(1, Number(request.query.page) || 1);
    const limit = Math.min(100, Math.max(1, Number(request.query.limit) || 20));
    const skip = (page - 1) * limit;

    const where: any = { active: true };
    if (merchantId) where.merchantId = merchantId;
    if (slug) where.merchant = { slug };

    const [endpoints, total] = await Promise.all([
      prisma.agfacEndpoint.findMany({
        where,
        skip,
        take: limit,
        include: { merchant: true },
      }),
      prisma.agfacEndpoint.count({ where }),
    ]);

    return reply.send({
      data: endpoints.map((e: any) => ({
        id: e.id,
        merchantSlug: e.merchant.slug,
        merchantName: e.merchant.name,
        path: e.path,
        proxyUrl: `${BASE_URL}/${e.merchant.slug}${e.path}`,
        targetUrl: e.targetUrl.startsWith('__builtin:') ? '(built-in demo)' : e.targetUrl,
        price: e.price,
        priceUSDC: formatUSDC(e.price),
        method: e.method,
        description: e.description,
      })),
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
    });
  });

  // ── Delete endpoint (authenticated) ──────────────────
  app.delete<{ Params: { id: string } }>('/api/endpoints/:id', {
    preHandler: requireMerchantAuth,
  }, async (request, reply) => {
    const merchant = (request as any).merchant;

    const ep = await prisma.agfacEndpoint.findUnique({ where: { id: request.params.id } });
    if (!ep) return reply.status(404).send({ success: false, error: 'Endpoint not found', code: 'NOT_FOUND' });
    if (ep.merchantId !== merchant.id) {
      return reply.status(403).send({ success: false, error: 'Not your endpoint', code: 'FORBIDDEN' });
    }

    await prisma.agfacEndpoint.update({
      where: { id: request.params.id },
      data: { active: false },
    });

    return reply.send({ success: true, message: 'Endpoint deactivated' });
  });
}

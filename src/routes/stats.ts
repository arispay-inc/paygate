/**
 * PayGate — Stats and simulation routes.
 */
import { randomBytes } from 'crypto';
import type { FastifyInstance } from 'fastify';
import { prisma } from '../db.js';
import { BASE_URL, ADMIN_API_KEY } from '../config.js';
import { formatUSDC, type AgfacPaymentPayload } from '../x402/index.js';
import { requireAdminAuth } from '../middleware/api-key-auth.js';
import { findEndpointForProxy } from '../services/proxy.js';

export default async function statsRoutes(app: FastifyInstance) {
  // ── Platform stats (admin-only) ──────────────────────
  app.get<{
    Querystring: { page?: string; limit?: string };
  }>('/api/stats', {
    ...(ADMIN_API_KEY && { preHandler: requireAdminAuth(ADMIN_API_KEY) }),
  }, async (request, reply) => {
    const page = Math.max(1, Number(request.query.page) || 1);
    const limit = Math.min(100, Math.max(1, Number(request.query.limit) || 20));
    const skip = (page - 1) * limit;

    const successTxs = await prisma.agfacTransaction.findMany({
      where: { status: 'success' },
      select: { price: true },
    });
    const totalRevenue = successTxs.reduce((sum: bigint, t: { price: string }) => sum + BigInt(t.price), 0n).toString();

    const [transactions, merchantCount, endpointCount, transactionCount, successCount] = await Promise.all([
      prisma.agfacTransaction.findMany({
        take: limit,
        skip,
        orderBy: { createdAt: 'desc' },
      }),
      prisma.agfacMerchant.count(),
      prisma.agfacEndpoint.count({ where: { active: true } }),
      prisma.agfacTransaction.count(),
      prisma.agfacTransaction.count({ where: { status: 'success' } }),
    ]);

    return reply.send({
      merchants: merchantCount,
      endpoints: endpointCount,
      totalTransactions: transactionCount,
      successfulTransactions: successCount,
      totalRevenue: formatUSDC(totalRevenue),
      recentTransactions: transactions,
      pagination: { page, limit, total: transactionCount, totalPages: Math.ceil(transactionCount / limit) },
    });
  });

  // ── Agent simulation ─────────────────────────────────
  app.post<{ Body: { slug: string; path: string; params?: Record<string, string> } }>(
    '/api/simulate-agent',
    async (request, reply) => {
      const { slug, path, params } = request.body || {};
      const merchant = await prisma.agfacMerchant.findUnique({ where: { slug } });
      if (!merchant) {
        return reply.status(404).send({ success: false, error: `Merchant "${slug}" not found`, code: 'NOT_FOUND' });
      }

      let ep = await findEndpointForProxy(slug, path, 'GET');
      if (!ep) ep = await findEndpointForProxy(slug, path, 'POST');
      if (!ep) {
        return reply.status(404).send({ success: false, error: `No endpoint at /${slug}${path}`, code: 'NOT_FOUND' });
      }

      const steps: Array<{ step: number; label: string; detail: string }> = [];

      steps.push({ step: 1, label: 'Discover', detail: `Agent found /${slug}${ep.path} — ${ep.description} ($${formatUSDC(ep.price)}/call)` });
      steps.push({ step: 2, label: '402 Challenge', detail: `Server returned 402: costs ${formatUSDC(ep.price)} USDC. Pay to ${merchant.wallet.slice(0, 10)}...` });

      const nonce = randomBytes(16).toString('hex');
      const now = Math.floor(Date.now() / 1000);
      const agentWallet = '0x' + randomBytes(20).toString('hex');
      const payload: AgfacPaymentPayload = {
        signature: '0x' + randomBytes(65).toString('hex'),
        from: agentWallet,
        value: ep.price,
        nonce,
        validAfter: now - 60,
        validBefore: now + 300,
      };
      steps.push({ step: 3, label: 'Sign Payment', detail: `Agent signed ${formatUSDC(ep.price)} USDC from ${agentWallet.slice(0, 10)}...` });

      const paymentHeader = Buffer.from(JSON.stringify(payload)).toString('base64');
      const proxyUrl = `/${slug}${ep.path}`;
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        'X-PAYMENT': paymentHeader,
      };

      let apiResponse: any;
      if (ep.method === 'GET') {
        const qs = params ? '?' + new URLSearchParams(params).toString() : '';
        const res = await app.inject({ method: 'GET', url: proxyUrl + qs, headers });
        apiResponse = JSON.parse(res.body);
      } else {
        const res = await app.inject({ method: 'POST', url: proxyUrl, headers, payload: params || {} });
        apiResponse = JSON.parse(res.body);
      }

      steps.push({ step: 4, label: 'Pay + Proxy', detail: `Payment verified. Request forwarded to ${ep.targetUrl.startsWith('__builtin:') ? 'demo API' : ep.targetUrl}` });

      if (apiResponse.success) {
        steps.push({ step: 5, label: 'Response', detail: `API returned data. ${formatUSDC(ep.price)} USDC settled to ${merchant.name}.` });
      } else {
        steps.push({ step: 5, label: 'Failed', detail: apiResponse.error || 'Unknown error' });
      }

      return reply.send({
        steps,
        apiResponse,
        agent: agentWallet,
        merchant: { name: merchant.name, slug: merchant.slug },
        paid: formatUSDC(ep.price) + ' USDC',
        txHash: apiResponse?.payment?.txHash,
      });
    },
  );
}

/**
 * PayGate — Health check route.
 */
import type { FastifyInstance } from 'fastify';
import { prisma } from '../db.js';

export default async function healthRoutes(app: FastifyInstance) {
  app.get('/health', async (_request, reply) => {
    const [merchantCount, endpointCount, transactionCount] = await Promise.all([
      prisma.agfacMerchant.count(),
      prisma.agfacEndpoint.count({ where: { active: true } }),
      prisma.agfacTransaction.count(),
    ]);

    return reply.send({
      status: 'ok',
      service: 'paygate',
      merchants: merchantCount,
      endpoints: endpointCount,
      transactions: transactionCount,
    });
  });
}

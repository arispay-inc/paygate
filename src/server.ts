/**
 * PayGate — x402 Reverse Proxy + Paywall
 *
 * Merchants register their API, set prices per endpoint.
 * PayGate sits in front as a reverse proxy:
 *   1. Merchant registers: name, wallet, email -> gets slug + API key
 *   2. Merchant adds endpoints: target URL + price + description
 *   3. Agents call /{slug}/path -> PayGate returns 402 with price
 *   4. Agent signs x402 payment -> retries with X-PAYMENT header
 *   5. PayGate verifies payment -> forwards request to merchant's real API
 *   6. Returns the real API response to the agent
 *
 * "Put PayGate in front of your API. Zero code changes."
 */
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import Fastify from 'fastify';
import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import fastifyStatic from '@fastify/static';
import { PORT, CORS_ORIGIN, SETTLEMENT_MODE, SETTLEMENT_STRICT, settlers } from './config.js';
import { prisma } from './db.js';
import { seedDemoData } from './seed.js';
import type { X402ErrorResponse } from './x402/index.js';

// Route plugins
import merchantRoutes from './routes/merchants.js';
import endpointRoutes from './routes/endpoints.js';
import facilitatorRoutes from './routes/facilitator.js';
import statsRoutes from './routes/stats.js';
import healthRoutes from './routes/health.js';
import proxyRoutes from './routes/proxy.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PROJECT_ROOT = join(__dirname, '..');

// ── Fastify app ─────────────────────────────────────

const app = Fastify({ logger: { level: 'warn' } });

await app.register(cors, { origin: CORS_ORIGIN, credentials: true });
await app.register(rateLimit, { max: 60, timeWindow: '1 minute' });
await app.register(fastifyStatic, {
  root: join(PROJECT_ROOT, 'public'),
  prefix: '/_/',
  decorateReply: true,
});

// Serve index.html at root
app.get('/', async (_request, reply) => {
  return reply.sendFile('index.html');
});

app.setErrorHandler((error: Error, _request, reply) => {
  console.error('[paygate] Error:', error.message, error.stack);
  return reply.status(500).send({
    success: false, error: 'Internal server error', code: 'INTERNAL_ERROR',
  } as X402ErrorResponse);
});

// ── Register routes ─────────────────────────────────
// Order matters: proxy routes MUST be last (catch-all)

await app.register(merchantRoutes);
await app.register(endpointRoutes);
await app.register(facilitatorRoutes);
await app.register(statsRoutes);
await app.register(healthRoutes);
await app.register(proxyRoutes); // catch-all — last

// ── Start ───────────────────────────────────────────

try {
  await seedDemoData();

  const merchantCount = await prisma.agfacMerchant.count();
  const endpointCount = await prisma.agfacEndpoint.count({ where: { active: true } });

  await app.listen({ port: PORT, host: '0.0.0.0' });
  console.log(`
  ┌──────────────────────────────────────────────────┐
  │  PayGate — http://localhost:${PORT}                   │
  │                                                  │
  │  x402 Reverse Proxy + Paywall                    │
  │                                                  │
  │  Merchants: ${String(merchantCount).padEnd(35)}│
  │  Endpoints: ${String(endpointCount).padEnd(35)}│
  │  Settle:    ${(SETTLEMENT_STRICT ? 'STRICT ' : '') + SETTLEMENT_MODE}${' '.repeat(Math.max(0, 35 - ((SETTLEMENT_STRICT ? 'STRICT ' : '') + SETTLEMENT_MODE).length))}│
  │                                                  │
  │  Facilitator:                                    │
  │    Verify:  POST /facilitator/verify             │
  │    Settle:  POST /facilitator/settle             │
  │    Gas:     SPONSORED (agents pay $0 gas)        │
  │    Chains:  ${String(settlers.size || 0).padEnd(36)}│
  │                                                  │
  │  Proxy:                                          │
  │    Register: POST /api/merchants                 │
  │    Add API:  POST /api/endpoints                 │
  │    Proxy:    GET  /{slug}/{path}                 │
  └──────────────────────────────────────────────────┘
  `);
} catch (err) {
  app.log.error(err);
  process.exit(1);
}

/**
 * PayGate — API key authentication middleware.
 */
import type { FastifyRequest, FastifyReply } from 'fastify';
import { getMerchantByApiKey } from '../services/merchant.js';

/**
 * Extract Bearer token from Authorization header or body apiKey field.
 */
function extractApiKey(request: FastifyRequest): string {
  const header = request.headers['authorization'];
  if (header) return header.replace('Bearer ', '').trim();
  const body = request.body as any;
  if (body?.apiKey) return body.apiKey.trim();
  return '';
}

/**
 * Fastify preHandler that authenticates merchant by API key.
 * Sets request.merchantId on success.
 */
export async function requireMerchantAuth(
  request: FastifyRequest,
  reply: FastifyReply,
) {
  const key = extractApiKey(request);
  if (!key) {
    return reply.status(401).send({
      success: false, error: 'API key required', code: 'UNAUTHORIZED',
    });
  }

  const merchant = await getMerchantByApiKey(key);
  if (!merchant) {
    return reply.status(401).send({
      success: false, error: 'Invalid API key', code: 'UNAUTHORIZED',
    });
  }

  (request as any).merchant = merchant;
  (request as any).merchantId = merchant.id;
}

/**
 * Require admin API key (for platform-level endpoints).
 */
export function requireAdminAuth(adminApiKey: string) {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    if (!adminApiKey) {
      return reply.status(503).send({
        success: false, error: 'Admin API not configured', code: 'NOT_CONFIGURED',
      });
    }
    const key = extractApiKey(request);
    if (key !== adminApiKey) {
      return reply.status(401).send({
        success: false, error: 'Invalid admin key', code: 'UNAUTHORIZED',
      });
    }
  };
}

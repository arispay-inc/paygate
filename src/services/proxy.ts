/**
 * PayGate — Proxy utilities.
 */
import { prisma } from '../db.js';
import { handleBuiltin } from '../mock/builtins.js';
import type { PaywalledEndpoint } from '../x402/index.js';

export async function findEndpointForProxy(
  slug: string,
  path: string,
  method: string,
): Promise<PaywalledEndpoint | undefined> {
  const ep = await prisma.agfacEndpoint.findFirst({
    where: {
      merchant: { slug },
      path,
      method,
      active: true,
    },
    include: { merchant: true },
  });

  if (!ep) return undefined;

  return {
    id: ep.id,
    merchantId: ep.merchantId,
    merchantSlug: ep.merchant.slug,
    path: ep.path,
    targetUrl: ep.targetUrl,
    price: ep.price,
    description: ep.description,
    method: ep.method as 'GET' | 'POST',
    active: ep.active,
  };
}

/**
 * Forward a request to the merchant's real API (or handle built-in demo).
 */
export async function proxyToTarget(
  endpoint: PaywalledEndpoint,
  query: Record<string, string>,
  body: any,
  method: string,
): Promise<{ status: number; data: any }> {
  if (endpoint.targetUrl.startsWith('__builtin:')) {
    const data = handleBuiltin(endpoint.targetUrl, query, body);
    return { status: 200, data };
  }

  try {
    const url = new URL(endpoint.targetUrl);
    for (const [k, v] of Object.entries(query)) {
      url.searchParams.set(k, v);
    }

    const fetchOptions: RequestInit = {
      method: method.toUpperCase(),
      headers: { 'Content-Type': 'application/json', 'User-Agent': 'PayGate/1.0 (x402 Proxy)' },
      signal: AbortSignal.timeout(15000),
    };
    if (method.toUpperCase() === 'POST' && body) {
      fetchOptions.body = JSON.stringify(body);
    }

    const res = await fetch(url.toString(), fetchOptions);
    const contentType = res.headers.get('content-type') || '';

    let data: any;
    if (contentType.includes('application/json')) {
      data = await res.json();
    } else {
      data = { text: await res.text() };
    }

    return { status: res.status, data };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Proxy request failed';
    return { status: 502, data: { error: message, code: 'PROXY_ERROR' } };
  }
}

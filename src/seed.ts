/**
 * PayGate — Seed data (idempotent).
 */
import { prisma } from './db.js';
import { DEMO_MERCHANT_WALLET } from './config.js';
import { createMerchantInternal, addEndpointInternal } from './services/merchant.js';
import { setFacilitatorMerchantId } from './routes/facilitator.js';

export async function seedDemoData() {
  // Ensure the facilitator sentinel merchant exists
  let facMerchant = await prisma.agfacMerchant.findUnique({ where: { slug: '_facilitator' } });
  if (!facMerchant) {
    facMerchant = await prisma.agfacMerchant.create({
      data: {
        slug: '_facilitator',
        name: 'PayGate Facilitator',
        wallet: '0x0000000000000000000000000000000000000000',
        email: 'facilitator@paygate.dev',
        apiKeyHash: 'facilitator-internal-no-key',
      },
    });
  }
  setFacilitatorMerchantId(facMerchant.id);

  // Check if demo merchant already exists (idempotent)
  const existing = await prisma.agfacMerchant.findUnique({ where: { slug: 'demo' } });
  if (existing) return;

  // Demo merchant with stable wallet address
  const demo = await createMerchantInternal({
    name: 'Demo APIs',
    slug: 'demo',
    email: 'demo@paygate.dev',
    wallet: DEMO_MERCHANT_WALLET,
  });

  await addEndpointInternal(demo.id, {
    path: '/joke',
    targetUrl: '__builtin:joke',
    price: '10000',
    description: 'Get a random programming joke',
    method: 'GET',
  });
  await addEndpointInternal(demo.id, {
    path: '/quote',
    targetUrl: '__builtin:quote',
    price: '5000',
    description: 'Get an inspirational quote',
    method: 'GET',
  });
  await addEndpointInternal(demo.id, {
    path: '/weather',
    targetUrl: '__builtin:weather',
    price: '50000',
    description: 'Get weather data for a city',
    method: 'GET',
  });
  await addEndpointInternal(demo.id, {
    path: '/translate',
    targetUrl: '__builtin:translate',
    price: '100000',
    description: 'Translate text between languages',
    method: 'POST',
  });
  await addEndpointInternal(demo.id, {
    path: '/summarize',
    targetUrl: '__builtin:summarize',
    price: '200000',
    description: 'Summarize a block of text',
    method: 'POST',
  });
}

#!/usr/bin/env node
/**
 * test-paygate.mjs
 *
 * End-to-end test of PayGate as a standalone x402 facilitator.
 *
 * The flow:
 *   1. Agent calls a merchant API (e.g. api.arcticx.ai)
 *   2. Merchant returns HTTP 402 + payment requirements
 *   3. Agent signs an EIP-3009 transferWithAuthorization
 *   4. Agent sends the signed payment to PayGate /facilitator/settle
 *   5. PayGate verifies + settles -> returns txHash
 *   6. Agent retries the merchant API with proof of payment
 *
 * For this test we simulate the merchant 402 response locally
 * and hit a real (or local) PayGate facilitator for settlement.
 *
 * Usage:
 *   PAYGATE_URL=http://localhost:4404 node test-paygate.mjs
 *   PAYGATE_URL=https://agfac-production.up.railway.app node test-paygate.mjs
 *   AGFAC_URL=http://localhost:4404 node test-paygate.mjs  # backward compat
 */

import { ethers } from 'ethers';

// ── Config ──────────────────────────────────────────

const PAYGATE_URL = process.env.PAYGATE_URL || process.env.AGFAC_URL || 'http://localhost:4404';
const MERCHANT_API = process.env.MERCHANT_API || 'https://api.arcticx.ai';

// USDC on Base Sepolia
const USDC_ADDRESS = '0x036CbD53842c5426634e7929541eC2318f3dCF7e';
const NETWORK = 'eip155:84532';

const EIP712_DOMAIN = {
  name: 'USD Coin',
  version: '2',
  chainId: 84532,
  verifyingContract: USDC_ADDRESS,
};

const TRANSFER_WITH_AUTHORIZATION_TYPES = {
  TransferWithAuthorization: [
    { name: 'from', type: 'address' },
    { name: 'to', type: 'address' },
    { name: 'value', type: 'uint256' },
    { name: 'validAfter', type: 'uint256' },
    { name: 'validBefore', type: 'uint256' },
    { name: 'nonce', type: 'bytes32' },
  ],
};

// ── Test utilities ─────────────────────────────────────

let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (condition) {
    passed++;
    console.log(`  ✅ ${message}`);
  } else {
    failed++;
    console.error(`  ❌ FAIL: ${message}`);
  }
}

function heading(text) {
  console.log(`\n── ${text} ${'─'.repeat(50 - text.length)}`);
}

// ── Helpers ────────────────────────────────────────────

/**
 * Simulate what a merchant (like arcticx.ai) would return
 * as a 402 response. In production, you'd get this by calling
 * the merchant API and receiving HTTP 402.
 */
function simulateMerchant402(resource, price, merchantWallet) {
  return {
    x402Version: 2,
    accepts: [
      {
        scheme: 'exact',
        network: NETWORK,
        maxAmountRequired: price,
        resource,
        asset: USDC_ADDRESS,
        payTo: merchantWallet,
        extra: { name: 'USDC', version: '2' },
      },
    ],
  };
}

/**
 * Sign an EIP-3009 transferWithAuthorization using the agent's wallet.
 */
async function signPayment(wallet, accept) {
  const now = Math.floor(Date.now() / 1000);
  const nonce = ethers.hexlify(ethers.randomBytes(32));

  const authorization = {
    from: wallet.address,
    to: accept.payTo,
    value: accept.maxAmountRequired,
    validAfter: (now - 60).toString(),
    validBefore: (now + 480).toString(),
    nonce,
  };

  const signature = await wallet.signTypedData(
    EIP712_DOMAIN,
    TRANSFER_WITH_AUTHORIZATION_TYPES,
    {
      from: ethers.getAddress(authorization.from),
      to: ethers.getAddress(authorization.to),
      value: BigInt(authorization.value),
      validAfter: BigInt(authorization.validAfter),
      validBefore: BigInt(authorization.validBefore),
      nonce: authorization.nonce,
    },
  );

  return {
    x402Version: 2,
    payload: { signature, authorization },
    accepted: accept,
    resource: accept.resource,
  };
}

// ══════════════════════════════════════════════════════
// Tests
// ══════════════════════════════════════════════════════

console.log(`
╔══════════════════════════════════════════════════════╗
║  PayGate Facilitator Test                            ║
║  Facilitator: ${PAYGATE_URL.padEnd(38)}║
║  Merchant:    ${MERCHANT_API.padEnd(38)}║
╚══════════════════════════════════════════════════════╝`);

// Create a test agent wallet (ephemeral, no real funds needed for mock)
const agentWallet = ethers.Wallet.createRandom();
console.log(`\n  Agent wallet: ${agentWallet.address}`);

// ── Test 1: Discovery ──────────────────────────────────

heading('1. Facilitator Discovery');

try {
  const res = await fetch(`${PAYGATE_URL}/facilitator`);
  const info = await res.json();
  assert(res.status === 200, `GET /facilitator returns 200`);
  assert(info.facilitator === 'PayGate', `Facilitator identifies as PayGate`);
  assert(info.x402Version === 2, `Supports x402 v2`);
  assert(info.settlement, `Settlement mode: ${info.settlement}`);
  assert(info.supportedNetworks?.length > 0, `Supports ${info.supportedNetworks.length} network(s)`);
  console.log(`  Networks: ${info.supportedNetworks.map(n => n.name).join(', ')}`);
} catch (err) {
  assert(false, `Discovery failed: ${err.message}`);
}

// ── Test 2: Merchant 402 Challenge ─────────────────────

heading('2. Merchant 402 Challenge (simulated)');

const merchantWallet = ethers.Wallet.createRandom().address;
const resource = `${MERCHANT_API}/v1/data`;
const price = '100000'; // $0.10 USDC

const requirements = simulateMerchant402(resource, price, merchantWallet);
const accept = requirements.accepts[0];

console.log(`  Resource:  ${resource}`);
console.log(`  Price:     ${Number(price) / 1e6} USDC`);
console.log(`  Pay to:    ${merchantWallet.slice(0, 20)}...`);
assert(accept.scheme === 'exact', 'Payment scheme is "exact"');
assert(accept.network === NETWORK, `Network is ${NETWORK}`);

// ── Test 3: Agent Signs Payment ────────────────────────

heading('3. Agent Signs Payment');

let paymentPayload;
try {
  paymentPayload = await signPayment(agentWallet, accept);
  assert(!!paymentPayload.payload.signature, 'EIP-712 signature created');
  assert(paymentPayload.payload.authorization.from === agentWallet.address, 'Signed by agent wallet');
  assert(paymentPayload.payload.authorization.to === merchantWallet, 'Pays to merchant wallet');
  assert(paymentPayload.payload.authorization.value === price, `Amount: ${price} base units`);
  console.log(`  Signature: ${paymentPayload.payload.signature.slice(0, 30)}...`);
} catch (err) {
  assert(false, `Signing failed: ${err.message}`);
}

// ── Test 4: Verify via Facilitator ─────────────────────

heading('4. Verify Payment (no settlement)');

try {
  const res = await fetch(`${PAYGATE_URL}/facilitator/verify`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      x402Version: 2,
      paymentPayload,
      paymentRequirements: accept,
    }),
  });
  const result = await res.json();
  assert(res.status === 200, 'POST /facilitator/verify returns 200');
  assert(result.valid === true, 'Payment is valid');
  assert(result.payer === agentWallet.address, `Payer: ${result.payer.slice(0, 20)}...`);
  assert(result.amountUSDC, `Amount: ${result.amountUSDC} USDC`);
} catch (err) {
  assert(false, `Verify failed: ${err.message}`);
}

// ── Test 5: Settle via Facilitator ─────────────────────

heading('5. Settle Payment');

let txHash;
try {
  const res = await fetch(`${PAYGATE_URL}/facilitator/settle`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      x402Version: 2,
      paymentPayload,
      paymentRequirements: accept,
    }),
  });
  const result = await res.json();
  assert(res.status === 200, 'POST /facilitator/settle returns 200');
  assert(result.success === true, 'Settlement successful');
  assert(!!result.transaction, `txHash: ${result.transaction?.slice(0, 30)}...`);
  assert(!!result.payer, `Payer: ${result.payer}`);
  assert(!!result.network, `Network: ${result.network}`);
  txHash = result.transaction;
} catch (err) {
  assert(false, `Settle failed: ${err.message}`);
}

// ── Test 6: Replay Protection ──────────────────────────

heading('6. Replay Protection');

try {
  const res = await fetch(`${PAYGATE_URL}/facilitator/settle`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      x402Version: 2,
      paymentPayload,
      paymentRequirements: accept,
    }),
  });
  const result = await res.json();
  assert(res.status === 409, `Replay returns 409 (got ${res.status})`);
  assert(result.success === false, 'Replay rejected');
  assert(result.errorReason === 'nonce_already_used', `Reason: ${result.errorReason}`);
} catch (err) {
  assert(false, `Replay test failed: ${err.message}`);
}

// ── Test 7: Invalid Payment ────────────────────────────

heading('7. Invalid Payment (bad signature)');

try {
  const badPayload = {
    x402Version: 2,
    payload: {
      signature: '0x' + 'ff'.repeat(65),
      authorization: {
        from: agentWallet.address,
        to: merchantWallet,
        value: price,
        validAfter: '0',
        validBefore: String(Math.floor(Date.now() / 1000) + 300),
        nonce: ethers.hexlify(ethers.randomBytes(32)),
      },
    },
    accepted: accept,
    resource,
  };

  const res = await fetch(`${PAYGATE_URL}/facilitator/verify`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      x402Version: 2,
      paymentPayload: badPayload,
      paymentRequirements: accept,
    }),
  });
  const result = await res.json();
  // Should either be invalid or return an error
  assert(result.valid === false || result.errors?.length > 0, 'Bad signature rejected');
} catch (err) {
  assert(false, `Bad signature test failed: ${err.message}`);
}

// ── Test 8: Try calling the real merchant ──────────────

heading('8. Real Merchant Probe');

try {
  const res = await fetch(MERCHANT_API, {
    signal: AbortSignal.timeout(10000),
  });
  console.log(`  ${MERCHANT_API} → ${res.status} ${res.statusText}`);
  if (res.status === 402) {
    const body = await res.json().catch(() => null);
    const reqHeader = res.headers.get('x-payment-requirements');
    assert(true, 'Merchant returned 402 — x402 enabled!');
    if (reqHeader) {
      console.log(`  X-Payment-Requirements: ${reqHeader.slice(0, 80)}...`);
    }
    if (body?.accepts || body?.requirements) {
      console.log(`  Payment requirements found in body`);
    }
  } else {
    console.log(`  Merchant did not return 402 — may need a specific endpoint`);
  }
} catch (err) {
  console.log(`  Could not reach merchant: ${err.message}`);
  console.log(`  (This is fine — the facilitator flow still works with simulated 402s)`);
}

// ── Summary ────────────────────────────────────────────

console.log(`\n${'═'.repeat(54)}`);
console.log(`  Results: ${passed} passed, ${failed} failed`);
console.log(`${'═'.repeat(54)}\n`);

if (failed > 0) {
  console.log('  Some tests failed. Check the output above.');
  process.exit(1);
} else {
  console.log('  All tests passed! PayGate facilitator is working.\n');
  console.log('  Next steps:');
  console.log('  • Have arcticx.ai call POST /facilitator/settle when agents pay');
  console.log('  • Set RELAYER_PRIVATE_KEY on PayGate for real on-chain settlement');
  console.log('  • Fund the relayer with ETH (gas) on Base Sepolia\n');
}

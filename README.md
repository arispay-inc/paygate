# PayGate — x402 Payment Facilitator

PayGate is a gas-sponsored x402 payment facilitator. It verifies and settles USDC micropayments from AI agents on behalf of merchants, using EIP-3009 `transferWithAuthorization`. Agents sign off-chain — they never need ETH for gas.

**Live:** https://agfac-production.up.railway.app

## How It Works

```
Agent → merchant API → HTTP 402 + payment requirements
Agent signs EIP-3009 transferWithAuthorization (off-chain)
Agent retries request with X-PAYMENT header
Merchant → POST paygate/facilitator/settle → { success, txHash }
Merchant serves the response
```

PayGate never holds funds. USDC goes directly from agent wallet to merchant wallet via the USDC contract.

## Two Modes

### 1. Facilitator (primary)

Any merchant on the internet can use PayGate to settle x402 payments. No registration required.

| Endpoint | Purpose |
|----------|---------|
| `GET /facilitator` | Discovery — networks, settlement mode, capabilities |
| `POST /facilitator/verify` | Verify EIP-712 signature (dry run, no funds move) |
| `POST /facilitator/settle` | Verify + settle on-chain, returns txHash |

### 2. Reverse Proxy

Merchants register their API and set per-endpoint prices. PayGate sits in front as an HTTP 402 paywall — zero code changes to the merchant's API.

| Endpoint | Purpose |
|----------|---------|
| `POST /api/merchants` | Register merchant (name, wallet, email) |
| `POST /api/endpoints` | Add paywalled endpoint (path, price, target URL) |
| `GET /{slug}/{path}` | Proxy — returns 402 or forwards after payment |

## Supported Chains

| Chain | Network ID | Settlement |
|-------|-----------|------------|
| Base Sepolia | `eip155:84532` | Testnet |
| Base Mainnet | `eip155:8453` | Production |
| Ethereum Mainnet | `eip155:1` | Production |
| Polygon Mainnet | `eip155:137` | Production |

Single relayer key works across all EVM chains (same address).

## Quick Start

```bash
# Install dependencies
pnpm install

# Generate Prisma client (schema lives in apps/api/prisma/)
pnpm exec prisma generate --schema=../api/prisma/schema.prisma

# Run locally (mock settlement)
pnpm dev

# Run with real on-chain settlement
RELAYER_PRIVATE_KEY=0x... pnpm dev
```

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `DATABASE_URL` | Yes | PostgreSQL connection string (Supabase pooler) |
| `PORT` | No | Server port (default: 4404) |
| `BASE_URL` | No | Public URL (default: `http://localhost:4404`) |
| `RELAYER_PRIVATE_KEY` | No | EVM private key for on-chain settlement. Without it, mock mode. |
| `SETTLEMENT_STRICT` | No | Set `true` to disable mock fallback — on-chain failures are real failures |
| `ADMIN_API_KEY` | No | Required to access `GET /api/stats` |
| `DEMO_MERCHANT_WALLET` | No | Wallet for the demo merchant seed (default: burn address) |
| `CORS_ORIGIN` | No | Allowed origins. Comma-separated or `*`. Default: permissive in dev, production URL in prod. |
| `BASE_SEPOLIA_RPC_URL` | No | Override default Base Sepolia RPC |
| `BASE_MAINNET_RPC_URL` | No | Override default Base Mainnet RPC |
| `ETHEREUM_RPC_URL` | No | Override default Ethereum RPC |
| `POLYGON_RPC_URL` | No | Override default Polygon RPC |

## Project Structure

```
src/
  server.ts              # Entrypoint — Fastify init, plugin registration
  config.ts              # Configuration, settlers, CORS
  db.ts                  # Prisma client
  seed.ts                # Demo data (idempotent)
  middleware/
    api-key-auth.ts      # Merchant + admin API key auth
  routes/
    merchants.ts         # Merchant CRUD + login
    endpoints.ts         # Endpoint CRUD
    facilitator.ts       # x402 facilitator (verify + settle)
    proxy.ts             # Catch-all reverse proxy
    stats.ts             # Platform stats + agent simulation
    health.ts            # Health check
  services/
    merchant.ts          # Merchant business logic
    payment.ts           # Nonce management + EIP-712 verification
    proxy.ts             # Proxy forwarding
  mock/
    builtins.ts          # Demo API handlers
```

## Settlement Safety

PayGate uses a **reserve-before-settle** pattern for nonce management:

1. **Reserve** — nonce recorded as `pending` in DB before settlement attempt
2. **Settle** — on-chain `transferWithAuthorization` submitted
3. **Confirm** — nonce updated with txHash on success
4. **Release** — nonce deleted on failure (agent can retry)

If the process crashes mid-settlement, the pending nonce prevents double-spend on retry.

## Deployment

Deploys to Railway via Dockerfile (`apps/agfac/Dockerfile`). Auto-deploys from GitHub push.

```bash
# Build
pnpm build

# Docker build (from monorepo root)
docker build -f apps/agfac/Dockerfile .
```

The Dockerfile copies the Prisma schema from `apps/api/prisma/` and generates its own client.

## Testing

```bash
# Run E2E tests against local
AGFAC_URL=http://localhost:4404 node test-agfac-facilitator.mjs

# Run E2E tests against production
AGFAC_URL=https://agfac-production.up.railway.app node test-agfac-facilitator.mjs
```

## Database

Uses the shared ArisPay Prisma schema (`apps/api/prisma/schema.prisma`). Models:

- `AgfacMerchant` — registered merchants with wallet, settlement chain, API key hash
- `AgfacEndpoint` — paywalled endpoints with price, target URL, method
- `AgfacTransaction` — settlement audit trail
- `FacilitatorNonce` — persistent nonce replay protection

Migrations run via `pnpm db:migrate` from `apps/api/`.

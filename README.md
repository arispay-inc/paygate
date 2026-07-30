# PayGate (superseded)

> **This repository is superseded and kept for history only.** The service
> that ran here (previously at `agfac-production.up.railway.app`) is offline,
> and the architecture described in this repo's history is no longer what
> ArisPay operates.

## Where things live now

| What you want | Where it is |
|---|---|
| Gate an Express/Fastify route with an x402 paywall | [`paygate` on npm](https://www.npmjs.com/package/paygate) — `npx paygate init` scaffolds a working seller |
| A public x402 facilitator (verify + settle) | [`facilitator.arispay.app`](https://facilitator.arispay.app) — free, no signup, USDC + EURC on Base mainnet, non-custodial. Docs: [arispay-inc/facilitator](https://github.com/arispay-inc/facilitator) |
| Pay x402 APIs from an agent | [`payagent` on npm](https://www.npmjs.com/package/payagent) |
| Hosted merchant dashboard | [paygate.arispay.app](https://paygate.arispay.app) |

Current network/asset support is whatever the live
[`GET /supported`](https://facilitator.arispay.app/supported) returns —
at the time of this notice: Base mainnet (`eip155:8453`) only, USDC and
EURC. Claims in this repository's earlier README (Ethereum/Polygon mainnet
settlement, gas-sponsored model) do **not** reflect the current service.

Company: [ArisPay](https://arispay.app) · Status: [status.arispay.app](https://status.arispay.app)

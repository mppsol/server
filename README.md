# @mppsol/server

HTTP middleware for [MPP.sol](https://github.com/mppsol/spec) — emits MPP
`402 Payment Required` challenges and verifies Solana payments
(`solana-direct` and `solana-session`).

Ships with a [Hono](https://hono.dev) adapter; the underlying primitives
are framework-agnostic so adding Express, Fastify, or Cloudflare-Workers
adapters is straightforward.

## Install

```sh
npm install @mppsol/server hono
```

## Quick start (Hono)

```ts
import { Hono } from 'hono';
import { mppMiddleware, InMemoryNonceStore } from '@mppsol/server';

const app = new Hono();

const nonces = new InMemoryNonceStore();

app.use(
  '/v1/joke',
  mppMiddleware({
    config: {
      realm: 'api.example.com',
      cluster: 'mainnet-beta',
      recipient: '9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin',
      mint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', // USDC
      amount: '1000',          // 0.001 USDC
      rpcUrl: 'https://api.mainnet-beta.solana.com',
      schemes: ['solana-direct'],
      minConfirmations: 'confirmed',
      deadlineSecs: 300,
      nonces,
    },
  }),
);

app.get('/v1/joke', (c) => c.text('Why don\'t scientists trust atoms? Because they make up everything.'));

export default app;
```

A first request to `GET /v1/joke` returns `402 Payment Required` with a
Solana payment challenge. The client signs and submits a USDC transfer
to the recipient with a Memo program instruction binding the nonce,
then retries with the `Authorization: Payment` header. The middleware
verifies the on-chain payment, sets a `Payment-Receipt` header, and
hands off to your handler.

## What's verified

For `solana-direct`:

1. The signature decodes to 64 bytes, the nonce echoes the challenge.
2. The transaction is fetched at the configured commitment level.
3. The transaction did not error and was included before the deadline.
4. The recipient token account was credited at least the requested
   amount of the configured mint (computed as `post − pre` so
   Token-2022 transfer fees are handled correctly).
5. A nonce-binding instruction is present — either a Memo program
   instruction whose data equals base64url(nonce), or a
   `mppsol/pay nonce=<b64url>` log line emitted by the `mppsol_cpi`
   program.
6. The nonce is single-use.

For `solana-session`:

1. The off-chain debit message decodes to the canonical 104-byte layout
   with the correct domain separator.
2. The nonce echoes the challenge.
3. The Ed25519 signature verifies against the session's
   `authorized_signer`.
4. The session is `Active`, not expired, with a matching cluster.
5. The debit's `sequence > session.lastSeenSequence` (replay
   protection).
6. The debit's `amount ≤ session.remainingCap`.

On success the server records the settle in the SessionStore. On-chain
batched `Settle` submission is the operator's responsibility — see
[`spec/settlement.md` §5](https://github.com/mppsol/spec/blob/main/spec/settlement.md#5-session-settlement-batching).

## Storage

`InMemoryNonceStore` is included for dev/single-process use. Production
deployments need a durable, replicated store — implement `NonceStore`
against Postgres / Redis / DynamoDB. Same pattern for `SessionStore`.

The nonce store MUST persist consumed-nonce state for at least
`deadlineSecs` to prevent replay across restarts (per
[`spec/security.md` §2.1](https://github.com/mppsol/spec/blob/main/spec/security.md#21-one-shot-replay)).

## Solana RPC

`createRpcClient(rpcUrl)` ships a minimal fetch-based RPC client that
calls `getTransaction`, `getSlot`, `getGenesisHash`. No `@solana/web3.js`
or `@solana/kit` dependency. If you already have a Solana RPC client,
implement the `RpcClient` interface and pass it via `mppMiddleware({
config, rpc })`.

## What's NOT in this package (yet)

- **On-chain Settle batch submission** for sessions. Implement using
  your preferred Solana SDK; this is operational, not protocol.
- **Production storage adapters**. Bring your own database.
- **Confirmation tracking** (monitoring `confirmed → finalized` for
  released payments). Spec recommends it; not enforced here.
- **Token-2022 extension validation** (confidential transfers, freeze
  authorities). The mint allowlist is currently single-mint via config.

## Sub-paths

- `@mppsol/server` — full surface, framework-agnostic primitives + Hono.
- `@mppsol/server/hono` — Hono middleware re-export only.

## Status

Spec at v0.1 draft. Breaking changes expected before v1.0.

## License

Apache-2.0. Maintained by [psyto](https://github.com/psyto).

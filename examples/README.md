# @mppsol/server examples

## hono.ts — minimal paid endpoint

A Hono server that protects `GET /joke` behind MPP.sol direct-mode on
Solana devnet.

### Setup

```sh
# 1. Install deps for the example
npm install hono @hono/node-server

# 2. Get a devnet USDC token account to receive payments.
#    Requires solana-cli + spl-token (https://spl.solana.com/token).
spl-token create-account 4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU --url devnet

# 3. Note the address printed above and set it:
export MPPSOL_RECIPIENT=<your-devnet-usdc-token-account>
```

### Run

```sh
bun run examples/hono.ts
# or
npx tsx examples/hono.ts
```

### Try it

```sh
# First request: returns 402 with WWW-Authenticate
curl -i http://localhost:3000/joke
```

You'll see something like:

```
HTTP/1.1 402 Payment Required
www-authenticate: Payment realm="jokes.example.com", methods="solana-direct", solana-cluster="devnet", solana-recipient="...", solana-mint="...", solana-amount="1000", solana-nonce="...", solana-deadline="..."
```

Pay according to the challenge (use `@mppsol/agent` — see
`/Users/hiroyusai/src/mppsol-agent/examples/`), then retry with the
`Authorization: Payment ...` header.

### What this demonstrates

- `mppMiddleware` plugs into any Hono route.
- `InMemoryNonceStore` works for dev/single-process servers; swap for a
  Postgres/Redis-backed `NonceStore` in production.
- `solana-direct` scheme — one Solana tx per request. No on-chain
  program required for direct mode.

### Production notes

- Run the recipient account on a wallet you control. The middleware
  doesn't validate that it's yours; whoever owns the configured token
  account collects payments.
- For mainnet, set `cluster: 'mainnet-beta'`, `mint:
  'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'` (mainnet USDC),
  `rpcUrl: <your-mainnet-rpc>`. Otherwise identical.
- `InMemoryNonceStore` does NOT survive restarts. Use a durable store
  in production to prevent nonce-replay across restarts.

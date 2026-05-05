// Minimal Hono server that protects /joke with MPP.sol direct-mode
// (one-shot HTTP 402 payment) on Solana devnet.
//
// Run: bun run examples/hono.ts
// Then: curl -i http://localhost:3000/joke   # → 402 with WWW-Authenticate
//       (pay per the challenge, then retry with Authorization header)
//
// Replace RECIPIENT_TOKEN_ACCOUNT with your USDC token account on devnet.

import { Hono } from 'hono';
import { serve } from '@hono/node-server';
import { mppMiddleware, InMemoryNonceStore } from '@mppsol/server';

// Devnet USDC mint (well-known, used by faucets and tests).
const DEVNET_USDC = '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU';

// Replace with your devnet USDC token account (the receiver).
// Get one via: spl-token create-account 4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU --url devnet
const RECIPIENT_TOKEN_ACCOUNT = process.env.MPPSOL_RECIPIENT
  ?? 'YOUR_DEVNET_USDC_TOKEN_ACCOUNT_HERE';

const app = new Hono();
const nonces = new InMemoryNonceStore();

app.use(
  '/joke',
  mppMiddleware({
    config: {
      realm: 'jokes.example.com',
      cluster: 'devnet',
      recipient: RECIPIENT_TOKEN_ACCOUNT,
      mint: DEVNET_USDC,
      amount: '1000', // 0.001 USDC (mint has 6 decimals)
      rpcUrl: 'https://api.devnet.solana.com',
      schemes: ['solana-direct'],
      minConfirmations: 'confirmed',
      deadlineSecs: 300,
      nonces,
    },
  }),
);

app.get('/joke', (c) =>
  c.text("Why don't scientists trust atoms? Because they make up everything."),
);

const port = Number(process.env.PORT ?? 3000);
console.log(`Listening on http://localhost:${port}`);
console.log(`Recipient: ${RECIPIENT_TOKEN_ACCOUNT}`);
serve({ fetch: app.fetch, port });

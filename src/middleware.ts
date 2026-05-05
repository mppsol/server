import type { Context, MiddlewareHandler } from 'hono';
import {
  b64urlDecode,
  decodeDebit,
  parseAuthorization,
  serializeChallengeError,
} from '@mppsol/core';
import { issueChallenge } from './challenge.js';
import { buildReceiptHeader } from './receipt.js';
import { createRpcClient, type RpcClient } from './rpc.js';
import type { ServerConfig } from './types.js';
import { verifyDirect } from './verify-direct.js';
import { verifySession } from './verify-session.js';

export interface MppMiddlewareOptions {
  config: ServerConfig;
  // Optional pre-built RPC client. If absent, one is built from config.rpcUrl.
  rpc?: RpcClient;
}

// Hono middleware. On incoming requests:
//   - If no `Authorization: Payment` header, returns 402 with a fresh
//     `WWW-Authenticate: Payment` challenge.
//   - If present, parses it, verifies the payment, and on success sets a
//     `Payment-Receipt` header and calls next(). On failure returns 402
//     with an error parameter.
//
// Mount this in front of the resource(s) it protects. Each request gets
// its own challenge nonce; for repeated calls from the same client,
// prefer sessions over one-shot.
export function mppMiddleware(opts: MppMiddlewareOptions): MiddlewareHandler {
  const { config } = opts;
  const rpc = opts.rpc ?? createRpcClient(config.rpcUrl);

  return async (c: Context, next) => {
    const authHeader = c.req.header('authorization');

    if (!authHeader) {
      const issued = issueChallenge(config);
      await config.nonces.reserve(issued.nonce, issued.deadline);
      return c.text('Payment required', 402, {
        'www-authenticate': issued.headerValue,
      });
    }

    let auth;
    try {
      auth = parseAuthorization(authHeader);
    } catch (e) {
      return c.text('Bad authorization', 402, {
        'www-authenticate': serializeChallengeError('invalid-signature'),
      });
    }

    let challengeNonce: Uint8Array;
    if (auth.scheme === 'solana-direct') {
      challengeNonce = b64urlDecode(auth.nonce);
    } else {
      try {
        const debit = decodeDebit(b64urlDecode(auth.debit));
        challengeNonce = debit.nonce;
      } catch {
        return c.text('Bad debit', 402, {
          'www-authenticate': serializeChallengeError('invalid-signature'),
        });
      }
    }

    const record = await config.nonces.consume(challengeNonce);
    if (!record) {
      return c.text('Nonce', 402, {
        'www-authenticate': serializeChallengeError('nonce-unknown'),
      });
    }

    const result =
      auth.scheme === 'solana-direct'
        ? await verifyDirect(auth, config, rpc, record.nonce, record.deadline)
        : await verifySession(auth, config, record.nonce, record.deadline);

    if (!result.ok) {
      return c.text('Verification failed', 402, {
        'www-authenticate': serializeChallengeError(result.error),
      });
    }

    c.header('payment-receipt', buildReceiptHeader(result.receipt));
    await next();
    return undefined;
  };
}

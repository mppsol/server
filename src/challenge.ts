import type { SolanaChallenge } from '@mppsol/core';
import { DEFAULT_CONFIRMATION } from '@mppsol/core';
import { b64urlEncode, serializeChallenge } from '@mppsol/core';
import { generateNonce } from './nonce.js';
import type { ServerConfig } from './types.js';

export interface IssuedChallenge {
  challenge: SolanaChallenge;
  nonce: Uint8Array;
  deadline: number;
  headerValue: string;
}

// Issue a fresh MPP challenge for the configured server. Caller is
// responsible for persisting the nonce in the NonceStore (this is done
// by the middleware).
export function issueChallenge(config: ServerConfig): IssuedChallenge {
  const nonce = generateNonce();
  const deadlineSecs = config.deadlineSecs ?? 300;
  const deadline = Math.floor(Date.now() / 1000) + deadlineSecs;
  const challenge: SolanaChallenge = {
    realm: config.realm,
    methods: config.schemes ?? ['solana-direct', 'solana-session'],
    cluster: config.cluster,
    recipient: config.recipient,
    mint: config.mint,
    amount: config.amount,
    nonce: b64urlEncode(nonce),
    deadline: String(deadline),
    minConfirmations: config.minConfirmations ?? DEFAULT_CONFIRMATION,
  };
  return {
    challenge,
    nonce,
    deadline,
    headerValue: serializeChallenge(challenge),
  };
}

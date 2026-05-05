import { ed25519 } from '@noble/curves/ed25519';
import { base58 } from '@scure/base';
import {
  decodeDebit,
  MppErrorCode,
  SessionState,
  type SolanaSessionAuthorization,
} from '@mppsol/core';
import { b64urlDecode } from './headers.js';
import type {
  ServerConfig,
  SessionReceiptData,
  VerifyResult,
} from './types.js';

// Verifies a `solana-session` Authorization header against the configured
// challenge and the server's session store. Performs:
//   1. Nonce echo check.
//   2. Debit decoding (incl. domain separator).
//   3. Ed25519 signature verification by the session's authorized_signer.
//   4. Session state check (Active, not expired, cluster matches).
//   5. Sequence monotonicity + cap availability.
//   6. Records the settle in the SessionStore.
//
// On-chain Settle batch submission is the server operator's responsibility;
// this verifier only validates the off-chain debit and updates local
// accounting. See spec/settlement.md §5 for batching guidance.
export async function verifySession(
  auth: SolanaSessionAuthorization,
  config: ServerConfig,
  challengeNonce: Uint8Array,
  challengeDeadline: number,
): Promise<VerifyResult> {
  if (!config.sessions) {
    return { ok: false, error: MppErrorCode.SessionNotFound };
  }

  const debitBytes = b64urlDecode(auth.debit);
  let debit;
  try {
    debit = decodeDebit(debitBytes);
  } catch {
    return { ok: false, error: MppErrorCode.InvalidSignature };
  }

  if (!bytesEqual(debit.nonce, challengeNonce)) {
    return { ok: false, error: MppErrorCode.NonceUnknown };
  }

  if (debit.expiry > BigInt(challengeDeadline)) {
    return { ok: false, error: MppErrorCode.DeadlinePassed };
  }
  if (debit.expiry < BigInt(Math.floor(Date.now() / 1000))) {
    return { ok: false, error: MppErrorCode.DeadlinePassed };
  }

  const sigBytes = b64urlDecode(auth.signature);
  if (sigBytes.length !== 64) {
    return { ok: false, error: MppErrorCode.InvalidSignature };
  }

  const session = await config.sessions.get(auth.session);
  if (!session) {
    return { ok: false, error: MppErrorCode.SessionNotFound };
  }
  if (session.state === SessionState.Revoked) {
    return { ok: false, error: MppErrorCode.SessionRevoked };
  }
  if (session.state === SessionState.Closed) {
    return { ok: false, error: MppErrorCode.SessionRevoked };
  }
  if (session.expiry < BigInt(Math.floor(Date.now() / 1000))) {
    return { ok: false, error: MppErrorCode.SessionExpired };
  }

  const expectedSession = base58.decode(auth.session);
  if (!bytesEqual(debit.session, expectedSession)) {
    return { ok: false, error: MppErrorCode.InvalidSignature };
  }

  if (debit.sequence <= session.lastSeenSequence) {
    return { ok: false, error: MppErrorCode.SequenceReused };
  }

  if (debit.amount > session.remainingCap) {
    return { ok: false, error: MppErrorCode.CapExceeded };
  }

  const signerPubkey = base58.decode(session.authorizedSigner);
  const sigOk = ed25519.verify(sigBytes, debitBytes, signerPubkey);
  if (!sigOk) {
    return { ok: false, error: MppErrorCode.InvalidSignature };
  }

  const recorded = await config.sessions.recordSettle(
    auth.session,
    debit.sequence,
    debit.amount,
  );
  if (!recorded) {
    return { ok: false, error: MppErrorCode.SequenceReused };
  }

  const receipt: SessionReceiptData = {
    scheme: 'solana-session',
    session: auth.session,
    sequence: debit.sequence,
    amount: debit.amount,
    nonce: debit.nonce,
  };
  return { ok: true, receipt };
}

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

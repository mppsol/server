import { describe, it, expect } from 'vitest';
import { ed25519 } from '@noble/curves/ed25519';
import { base58 } from '@scure/base';
import {
  b64urlEncode,
  DEBIT_DOMAIN_SEP,
  encodeDebit,
  MppErrorCode,
  SessionState,
  type Debit,
  type Session,
  type SolanaSessionAuthorization,
} from '@mppsol/core';
import { verifySession } from '../src/verify-session.js';
import type { ServerConfig, SessionStore } from '../src/types.js';

function makeSigner() {
  const priv = ed25519.utils.randomPrivateKey();
  const pub = ed25519.getPublicKey(priv);
  return { priv, pub, b58: base58.encode(pub) };
}

function makeSessionPubkey() {
  return base58.encode(ed25519.getPublicKey(ed25519.utils.randomPrivateKey()));
}

function makeStore(session: Session | null): SessionStore {
  let recordedSequence: bigint = session?.lastSeenSequence ?? 0n;
  return {
    async get(_) {
      if (!session) return null;
      return { ...session, lastSeenSequence: recordedSequence };
    },
    async recordSettle(_, sequence) {
      if (sequence <= recordedSequence) return false;
      recordedSequence = sequence;
      return true;
    },
  };
}

function buildAuth(
  sessionPub: string,
  signerPriv: Uint8Array,
  debit: Debit,
): SolanaSessionAuthorization {
  const debitBytes = encodeDebit(debit);
  const sig = ed25519.sign(debitBytes, signerPriv);
  return {
    scheme: 'solana-session',
    session: sessionPub,
    debit: b64urlEncode(debitBytes),
    signature: b64urlEncode(sig),
  };
}

describe('verifySession', () => {
  const nonce = new Uint8Array(32).fill(0xab);
  const challengeDeadline = Math.floor(Date.now() / 1000) + 300;
  const config = {
    realm: 'x',
    cluster: 'mainnet-beta',
    recipient: 'recipient',
    mint: 'mint',
    amount: '1000',
    rpcUrl: '',
    nonces: { reserve: async () => {}, consume: async () => null, isFresh: async () => true },
  } as unknown as ServerConfig;

  function makeSession(signer: ReturnType<typeof makeSigner>, sessionPub: string): Session {
    return {
      owner: 'owner',
      authorizedSigner: signer.b58,
      server: 'server',
      mint: 'mint',
      escrow: 'escrow',
      totalCap: 100000n,
      remainingCap: 100000n,
      lastSeenSequence: 0n,
      expiry: BigInt(challengeDeadline + 600),
      state: SessionState.Active,
      clusterGenesisHash: new Uint8Array(32),
      sessionId: new Uint8Array(16),
      bump: 255,
    };
  }

  function makeDebit(sessionPubB58: string, overrides: Partial<Debit> = {}): Debit {
    return {
      session: base58.decode(sessionPubB58),
      nonce,
      amount: 1000n,
      expiry: BigInt(challengeDeadline),
      sequence: 1n,
      domainSep: DEBIT_DOMAIN_SEP,
      ...overrides,
    };
  }

  it('accepts a valid signed debit', async () => {
    const signer = makeSigner();
    const sessionPub = makeSessionPubkey();
    const session = makeSession(signer, sessionPub);
    const debit = makeDebit(sessionPub);
    const auth = buildAuth(sessionPub, signer.priv, debit);

    const result = await verifySession(
      auth,
      { ...config, sessions: makeStore(session) },
      nonce,
      challengeDeadline,
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.receipt.scheme).toBe('solana-session');
      expect(result.receipt.amount).toBe(1000n);
    }
  });

  it('rejects a debit signed by the wrong key', async () => {
    const realSigner = makeSigner();
    const wrongSigner = makeSigner();
    const sessionPub = makeSessionPubkey();
    const session = makeSession(realSigner, sessionPub);
    const debit = makeDebit(sessionPub);
    const auth = buildAuth(sessionPub, wrongSigner.priv, debit);

    const result = await verifySession(
      auth,
      { ...config, sessions: makeStore(session) },
      nonce,
      challengeDeadline,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe(MppErrorCode.InvalidSignature);
  });

  it('rejects a debit with mismatched nonce', async () => {
    const signer = makeSigner();
    const sessionPub = makeSessionPubkey();
    const session = makeSession(signer, sessionPub);
    const wrongNonce = new Uint8Array(32).fill(0xff);
    const debit = makeDebit(sessionPub, { nonce: wrongNonce });
    const auth = buildAuth(sessionPub, signer.priv, debit);

    const result = await verifySession(
      auth,
      { ...config, sessions: makeStore(session) },
      nonce,
      challengeDeadline,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe(MppErrorCode.NonceUnknown);
  });

  it('rejects sequence reuse', async () => {
    const signer = makeSigner();
    const sessionPub = makeSessionPubkey();
    const session = { ...makeSession(signer, sessionPub), lastSeenSequence: 5n };
    const debit = makeDebit(sessionPub, { sequence: 5n });
    const auth = buildAuth(sessionPub, signer.priv, debit);

    const result = await verifySession(
      auth,
      { ...config, sessions: makeStore(session) },
      nonce,
      challengeDeadline,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe(MppErrorCode.SequenceReused);
  });

  it('rejects amount exceeding cap', async () => {
    const signer = makeSigner();
    const sessionPub = makeSessionPubkey();
    const session = { ...makeSession(signer, sessionPub), remainingCap: 500n };
    const debit = makeDebit(sessionPub, { amount: 1000n });
    const auth = buildAuth(sessionPub, signer.priv, debit);

    const result = await verifySession(
      auth,
      { ...config, sessions: makeStore(session) },
      nonce,
      challengeDeadline,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe(MppErrorCode.CapExceeded);
  });

  it('rejects revoked session', async () => {
    const signer = makeSigner();
    const sessionPub = makeSessionPubkey();
    const session = { ...makeSession(signer, sessionPub), state: SessionState.Revoked };
    const debit = makeDebit(sessionPub);
    const auth = buildAuth(sessionPub, signer.priv, debit);

    const result = await verifySession(
      auth,
      { ...config, sessions: makeStore(session) },
      nonce,
      challengeDeadline,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe(MppErrorCode.SessionRevoked);
  });

  it('rejects expired session', async () => {
    const signer = makeSigner();
    const sessionPub = makeSessionPubkey();
    const session = {
      ...makeSession(signer, sessionPub),
      expiry: BigInt(Math.floor(Date.now() / 1000) - 1),
    };
    const debit = makeDebit(sessionPub);
    const auth = buildAuth(sessionPub, signer.priv, debit);

    const result = await verifySession(
      auth,
      { ...config, sessions: makeStore(session) },
      nonce,
      challengeDeadline,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe(MppErrorCode.SessionExpired);
  });

  it('rejects when no SessionStore is configured', async () => {
    const signer = makeSigner();
    const sessionPub = makeSessionPubkey();
    const debit = makeDebit(sessionPub);
    const auth = buildAuth(sessionPub, signer.priv, debit);

    const result = await verifySession(
      auth,
      { ...config },
      nonce,
      challengeDeadline,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe(MppErrorCode.SessionNotFound);
  });
});

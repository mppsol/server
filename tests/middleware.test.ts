import { describe, it, expect } from 'vitest';
import { Hono } from 'hono';
import { ed25519 } from '@noble/curves/ed25519';
import { base58 } from '@scure/base';
import {
  b64urlEncode,
  DEBIT_DOMAIN_SEP,
  encodeDebit,
  parseChallenge,
  parseReceipt,
  SessionState,
  type Debit,
  type Session,
} from '@mppsol/core';
import { mppMiddleware, InMemoryNonceStore } from '../src/index.js';
import type { ServerConfig, SessionStore } from '../src/types.js';

function makeApp(config: ServerConfig) {
  const app = new Hono();
  app.use('/paid', mppMiddleware({ config }));
  app.get('/paid', (c) => c.text('content'));
  return app;
}

function makeSessionStore(session: Session): SessionStore {
  let recordedSequence = session.lastSeenSequence;
  return {
    async get() {
      return { ...session, lastSeenSequence: recordedSequence };
    },
    async recordSettle(_, sequence) {
      if (sequence <= recordedSequence) return false;
      recordedSequence = sequence;
      return true;
    },
  };
}

describe('mppMiddleware', () => {
  it('returns 402 with WWW-Authenticate when no Authorization header', async () => {
    const app = makeApp({
      realm: 'x',
      cluster: 'mainnet-beta',
      recipient: 'r',
      mint: 'm',
      amount: '1000',
      rpcUrl: '',
      nonces: new InMemoryNonceStore(),
    });

    const res = await app.request('/paid');
    expect(res.status).toBe(402);

    const challengeHeader = res.headers.get('www-authenticate');
    expect(challengeHeader).toBeTruthy();
    const challenge = parseChallenge(challengeHeader!);
    expect(challenge.realm).toBe('x');
    expect(challenge.amount).toBe('1000');
  });

  it('returns 200 with Payment-Receipt on valid session payment', async () => {
    const signerPriv = ed25519.utils.randomPrivateKey();
    const signerPub = base58.encode(ed25519.getPublicKey(signerPriv));
    const sessionPub = base58.encode(
      ed25519.getPublicKey(ed25519.utils.randomPrivateKey()),
    );

    const session: Session = {
      owner: 'owner',
      authorizedSigner: signerPub,
      server: 'server',
      mint: 'm',
      escrow: 'escrow',
      totalCap: 100000n,
      remainingCap: 100000n,
      lastSeenSequence: 0n,
      expiry: BigInt(Math.floor(Date.now() / 1000) + 3600),
      state: SessionState.Active,
      clusterGenesisHash: new Uint8Array(32),
      sessionId: new Uint8Array(16),
      bump: 255,
    };

    const config: ServerConfig = {
      realm: 'x',
      cluster: 'mainnet-beta',
      recipient: 'r',
      mint: 'm',
      amount: '1000',
      rpcUrl: '',
      schemes: ['solana-session'],
      nonces: new InMemoryNonceStore(),
      sessions: makeSessionStore(session),
    };
    const app = makeApp(config);

    // First request: 402
    const res402 = await app.request('/paid');
    expect(res402.status).toBe(402);
    const challenge = parseChallenge(res402.headers.get('www-authenticate')!);

    // Build a signed debit and retry
    const debit: Debit = {
      session: base58.decode(sessionPub),
      nonce: new Uint8Array(
        Buffer.from(challenge.nonce.replace(/-/g, '+').replace(/_/g, '/'), 'base64'),
      ),
      amount: 1000n,
      expiry: BigInt(challenge.deadline),
      sequence: 1n,
      domainSep: DEBIT_DOMAIN_SEP,
    };
    const debitBytes = encodeDebit(debit);
    const sig = ed25519.sign(debitBytes, signerPriv);

    const authHeader = `Payment scheme="solana-session", session="${sessionPub}", debit="${b64urlEncode(debitBytes)}", signature="${b64urlEncode(sig)}"`;

    const res200 = await app.request('/paid', {
      headers: { authorization: authHeader },
    });
    expect(res200.status).toBe(200);
    expect(await res200.text()).toBe('content');

    const receiptHeader = res200.headers.get('payment-receipt');
    expect(receiptHeader).toBeTruthy();
    const receipt = parseReceipt(receiptHeader!);
    expect(receipt.scheme).toBe('solana-session');
    if (receipt.scheme === 'solana-session') {
      expect(receipt.session).toBe(sessionPub);
      expect(receipt.sequence).toBe('1');
      expect(receipt.amount).toBe('1000');
    }
  });

  it('returns 402 with error param on bad signature', async () => {
    const signerPriv = ed25519.utils.randomPrivateKey();
    const wrongPriv = ed25519.utils.randomPrivateKey();
    const signerPub = base58.encode(ed25519.getPublicKey(signerPriv));
    const sessionPub = base58.encode(
      ed25519.getPublicKey(ed25519.utils.randomPrivateKey()),
    );

    const session: Session = {
      owner: 'owner',
      authorizedSigner: signerPub,
      server: 'server',
      mint: 'm',
      escrow: 'escrow',
      totalCap: 100000n,
      remainingCap: 100000n,
      lastSeenSequence: 0n,
      expiry: BigInt(Math.floor(Date.now() / 1000) + 3600),
      state: SessionState.Active,
      clusterGenesisHash: new Uint8Array(32),
      sessionId: new Uint8Array(16),
      bump: 255,
    };

    const config: ServerConfig = {
      realm: 'x',
      cluster: 'mainnet-beta',
      recipient: 'r',
      mint: 'm',
      amount: '1000',
      rpcUrl: '',
      schemes: ['solana-session'],
      nonces: new InMemoryNonceStore(),
      sessions: makeSessionStore(session),
    };
    const app = makeApp(config);

    const res402 = await app.request('/paid');
    const challenge = parseChallenge(res402.headers.get('www-authenticate')!);

    const debit: Debit = {
      session: base58.decode(sessionPub),
      nonce: new Uint8Array(
        Buffer.from(challenge.nonce.replace(/-/g, '+').replace(/_/g, '/'), 'base64'),
      ),
      amount: 1000n,
      expiry: BigInt(challenge.deadline),
      sequence: 1n,
      domainSep: DEBIT_DOMAIN_SEP,
    };
    const debitBytes = encodeDebit(debit);
    const badSig = ed25519.sign(debitBytes, wrongPriv);
    const authHeader = `Payment scheme="solana-session", session="${sessionPub}", debit="${b64urlEncode(debitBytes)}", signature="${b64urlEncode(badSig)}"`;

    const res = await app.request('/paid', {
      headers: { authorization: authHeader },
    });
    expect(res.status).toBe(402);
    const errHeader = res.headers.get('www-authenticate')!;
    expect(errHeader).toContain('error=');
    expect(errHeader).toContain('invalid-signature');
  });
});

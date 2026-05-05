import { describe, it, expect } from 'vitest';
import {
  b64urlEncode,
  MEMO_PROGRAM_ID,
  MppErrorCode,
  type SolanaDirectAuthorization,
} from '@mppsol/core';
import { verifyDirect } from '../src/verify-direct.js';
import type { RpcClient, RpcTransaction } from '../src/rpc.js';
import type { ServerConfig } from '../src/types.js';

const RECIPIENT = '9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin';
const MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';

function nowSecs() {
  return Math.floor(Date.now() / 1000);
}

function makeConfig(overrides: Partial<ServerConfig> = {}): ServerConfig {
  return {
    realm: 'x',
    cluster: 'mainnet-beta',
    recipient: RECIPIENT,
    mint: MINT,
    amount: '1000',
    rpcUrl: '',
    nonces: {
      reserve: async () => {},
      consume: async () => null,
      isFresh: async () => true,
    },
    ...overrides,
  };
}

function makeAuth(nonceBytes: Uint8Array, signatureBytes?: Uint8Array): SolanaDirectAuthorization {
  return {
    scheme: 'solana-direct',
    signature: b64urlEncode(signatureBytes ?? new Uint8Array(64).fill(0xab)),
    nonce: b64urlEncode(nonceBytes),
  };
}

function makeTx(opts: {
  recipient?: string;
  mint?: string;
  preAmount?: bigint;
  postAmount?: bigint;
  nonceForMemo?: Uint8Array | null;
  blockTime?: number | null;
  err?: unknown;
  logMessages?: string[];
}): RpcTransaction {
  const recipient = opts.recipient ?? RECIPIENT;
  const mint = opts.mint ?? MINT;
  const accountKeys = [recipient, MEMO_PROGRAM_ID];
  const instructions: Array<{ programIdIndex: number; accounts: number[]; data: string }> = [];

  if (opts.nonceForMemo !== null) {
    instructions.push({
      programIdIndex: 1,
      accounts: [],
      data: b64urlEncode(opts.nonceForMemo!),
    });
  }

  return {
    slot: 1000n,
    blockTime: opts.blockTime === null
      ? null
      : BigInt(opts.blockTime ?? nowSecs()),
    meta: {
      err: opts.err ?? null,
      preTokenBalances: opts.preAmount === undefined
        ? undefined
        : [{
            accountIndex: 0,
            mint,
            uiTokenAmount: { amount: opts.preAmount.toString(), decimals: 6 },
          }],
      postTokenBalances: opts.postAmount === undefined
        ? undefined
        : [{
            accountIndex: 0,
            mint,
            uiTokenAmount: { amount: opts.postAmount.toString(), decimals: 6 },
          }],
      logMessages: opts.logMessages,
    },
    transaction: {
      message: { accountKeys, instructions },
      signatures: [],
    },
  };
}

function makeMockRpc(tx: RpcTransaction | null): RpcClient {
  return {
    async getTransaction() { return tx; },
    async getSlot() { return 1000n; },
    async getGenesisHash() { return ''; },
  };
}

describe('verifyDirect', () => {
  const challengeNonce = new Uint8Array(32).fill(0xcd);
  const challengeDeadline = nowSecs() + 300;

  it('accepts a valid payment with proper Memo nonce binding', async () => {
    const auth = makeAuth(challengeNonce);
    const tx = makeTx({
      preAmount: 0n,
      postAmount: 1000n,
      nonceForMemo: challengeNonce,
    });

    const result = await verifyDirect(
      auth,
      makeConfig(),
      makeMockRpc(tx),
      challengeNonce,
      challengeDeadline,
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.receipt.scheme).toBe('solana-direct');
      expect(result.receipt.amount).toBe(1000n);
    }
  });

  it('accepts a payment over the requested amount', async () => {
    const auth = makeAuth(challengeNonce);
    const tx = makeTx({
      preAmount: 0n,
      postAmount: 5000n,
      nonceForMemo: challengeNonce,
    });

    const result = await verifyDirect(
      auth,
      makeConfig(),
      makeMockRpc(tx),
      challengeNonce,
      challengeDeadline,
    );

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.receipt.amount).toBe(5000n);
  });

  it('handles Token-2022 transfer fees correctly via post-pre delta', async () => {
    // Token-2022 mint with a fee — sender sends 1100, recipient receives 1000.
    // Verifier should look at the credited amount, not the instruction amount.
    const auth = makeAuth(challengeNonce);
    const tx = makeTx({
      preAmount: 50n,    // recipient already had 50
      postAmount: 1050n, // received 1000 net
      nonceForMemo: challengeNonce,
    });

    const result = await verifyDirect(
      auth,
      makeConfig(),
      makeMockRpc(tx),
      challengeNonce,
      challengeDeadline,
    );

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.receipt.amount).toBe(1000n);
  });

  it('rejects when the signature is not 64 bytes', async () => {
    const auth = makeAuth(challengeNonce, new Uint8Array(63));
    const result = await verifyDirect(
      auth,
      makeConfig(),
      makeMockRpc(null),
      challengeNonce,
      challengeDeadline,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe(MppErrorCode.InvalidSignature);
  });

  it('rejects when the auth nonce does not match challenge nonce', async () => {
    const wrongNonce = new Uint8Array(32).fill(0xff);
    const auth = makeAuth(wrongNonce);
    const result = await verifyDirect(
      auth,
      makeConfig(),
      makeMockRpc(null),
      challengeNonce,
      challengeDeadline,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe(MppErrorCode.NonceUnknown);
  });

  it('rejects when the tx is not found on-chain', async () => {
    const auth = makeAuth(challengeNonce);
    const result = await verifyDirect(
      auth,
      makeConfig(),
      makeMockRpc(null),
      challengeNonce,
      challengeDeadline,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe(MppErrorCode.TxNotConfirmed);
  });

  it('rejects when the tx errored on-chain', async () => {
    const auth = makeAuth(challengeNonce);
    const tx = makeTx({
      preAmount: 0n,
      postAmount: 1000n,
      nonceForMemo: challengeNonce,
      err: { InstructionError: [0, 'Custom'] },
    });
    const result = await verifyDirect(
      auth,
      makeConfig(),
      makeMockRpc(tx),
      challengeNonce,
      challengeDeadline,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe(MppErrorCode.TxNotConfirmed);
  });

  it('rejects when the tx blockTime is past the challenge deadline', async () => {
    const auth = makeAuth(challengeNonce);
    const tx = makeTx({
      preAmount: 0n,
      postAmount: 1000n,
      nonceForMemo: challengeNonce,
      blockTime: challengeDeadline + 100,
    });
    const result = await verifyDirect(
      auth,
      makeConfig(),
      makeMockRpc(tx),
      challengeNonce,
      challengeDeadline,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe(MppErrorCode.DeadlinePassed);
  });

  it('rejects when the credited amount is below the requested amount', async () => {
    const auth = makeAuth(challengeNonce);
    const tx = makeTx({
      preAmount: 0n,
      postAmount: 999n,    // 1 short
      nonceForMemo: challengeNonce,
    });
    const result = await verifyDirect(
      auth,
      makeConfig(),
      makeMockRpc(tx),
      challengeNonce,
      challengeDeadline,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe(MppErrorCode.AmountInsufficient);
  });

  it('rejects when the wrong mint was transferred', async () => {
    const auth = makeAuth(challengeNonce);
    const tx = makeTx({
      preAmount: 0n,
      postAmount: 1000n,
      mint: 'So11111111111111111111111111111111111111112', // Wrapped SOL, not USDC
      nonceForMemo: challengeNonce,
    });
    const result = await verifyDirect(
      auth,
      makeConfig(),
      makeMockRpc(tx),
      challengeNonce,
      challengeDeadline,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe(MppErrorCode.MintMismatch);
  });

  it('rejects when the nonce binding instruction is missing (no Memo, no CPI log)', async () => {
    const auth = makeAuth(challengeNonce);
    const tx = makeTx({
      preAmount: 0n,
      postAmount: 1000n,
      nonceForMemo: null, // no Memo
      // no logMessages either
    });
    const result = await verifyDirect(
      auth,
      makeConfig(),
      makeMockRpc(tx),
      challengeNonce,
      challengeDeadline,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe(MppErrorCode.NonceNotBound);
  });

  it('accepts when nonce-binding comes via the CPI log line instead of Memo', async () => {
    const auth = makeAuth(challengeNonce);
    const tx = makeTx({
      preAmount: 0n,
      postAmount: 1000n,
      nonceForMemo: null,
      logMessages: [
        `Program log: mppsol/pay nonce=${b64urlEncode(challengeNonce)} request_hash=abc amount=1000`,
      ],
    });
    const result = await verifyDirect(
      auth,
      makeConfig(),
      makeMockRpc(tx),
      challengeNonce,
      challengeDeadline,
    );
    expect(result.ok).toBe(true);
  });
});

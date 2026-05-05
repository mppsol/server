import { base58 } from '@scure/base';
import {
  b64urlDecode,
  b64urlEncode,
  MEMO_PROGRAM_ID,
  MppErrorCode,
  type SolanaDirectAuthorization,
} from '@mppsol/core';
import type { RpcClient, RpcTransaction } from './rpc.js';
import type { DirectReceiptData, ServerConfig, VerifyResult } from './types.js';

// Verifies a `solana-direct` Authorization header against the configured
// challenge. Performs:
//   1. Nonce freshness check (caller has already done isFresh).
//   2. RPC fetch of the tx by signature.
//   3. Confirmation level + deadline check.
//   4. SPL token balance delta check (handles Token-2022 transfer fees
//      correctly because we use post − pre, not the instruction amount).
//   5. Memo nonce-binding check.
//
// CPI nonce-binding (via mppsol_cpi::Pay) is recognized by log scanning
// for the "mppsol/pay nonce=…" log line emitted by the program. Until
// the program ships, only the Memo path is exercised.
export async function verifyDirect(
  auth: SolanaDirectAuthorization,
  config: ServerConfig,
  rpc: RpcClient,
  challengeNonce: Uint8Array,
  challengeDeadline: number,
): Promise<VerifyResult> {
  const sigBytes = b64urlDecode(auth.signature);
  if (sigBytes.length !== 64) {
    return { ok: false, error: MppErrorCode.InvalidSignature };
  }
  const authNonce = b64urlDecode(auth.nonce);
  if (!bytesEqual(authNonce, challengeNonce)) {
    return { ok: false, error: MppErrorCode.NonceUnknown };
  }

  const sigB58 = base58.encode(sigBytes);
  const tx = await rpc.getTransaction(
    sigB58,
    config.minConfirmations ?? 'confirmed',
  );
  if (!tx) {
    return { ok: false, error: MppErrorCode.TxNotConfirmed };
  }
  if (tx.meta.err !== null) {
    return { ok: false, error: MppErrorCode.TxNotConfirmed };
  }

  if (tx.blockTime !== null && tx.blockTime > BigInt(challengeDeadline)) {
    return { ok: false, error: MppErrorCode.DeadlinePassed };
  }

  const credited = creditedAmount(tx, config.recipient, config.mint);
  if (credited === null) {
    return { ok: false, error: MppErrorCode.MintMismatch };
  }
  const required = BigInt(config.amount);
  if (credited < required) {
    return { ok: false, error: MppErrorCode.AmountInsufficient };
  }

  if (!hasNonceBinding(tx, challengeNonce)) {
    return { ok: false, error: MppErrorCode.NonceNotBound };
  }

  const receipt: DirectReceiptData = {
    scheme: 'solana-direct',
    tx: sigBytes,
    slot: tx.slot,
    cluster: config.cluster,
    recipient: config.recipient,
    mint: config.mint,
    amount: credited,
    nonce: challengeNonce,
  };
  return { ok: true, receipt };
}

// Returns the net amount credited to `recipient` of the configured mint,
// or null if the mint is not present in any post-balance for the recipient.
function creditedAmount(
  tx: RpcTransaction,
  recipient: string,
  mint: string,
): bigint | null {
  if (mint === 'native') {
    const idx = tx.transaction.message.accountKeys.indexOf(recipient);
    if (idx === -1) return null;
    const pre = tx.meta.preBalances?.[idx];
    const post = tx.meta.postBalances?.[idx];
    if (pre === undefined || post === undefined) return null;
    return post - pre;
  }
  const accountKeys = tx.transaction.message.accountKeys;
  const recipientIdx = accountKeys.indexOf(recipient);
  if (recipientIdx === -1) return null;
  const pre = tx.meta.preTokenBalances?.find(
    (b) => b.accountIndex === recipientIdx && b.mint === mint,
  );
  const post = tx.meta.postTokenBalances?.find(
    (b) => b.accountIndex === recipientIdx && b.mint === mint,
  );
  if (!post) return null;
  const preAmt = pre ? BigInt(pre.uiTokenAmount.amount) : 0n;
  const postAmt = BigInt(post.uiTokenAmount.amount);
  return postAmt - preAmt;
}

// Looks for either:
//   - a Memo program instruction whose data == base64url(nonce), or
//   - a log message of form "Program log: mppsol/pay nonce=<b64url>"
// emitted by the mppsol_cpi program.
function hasNonceBinding(tx: RpcTransaction, nonce: Uint8Array): boolean {
  const expected = b64urlEncode(nonce);
  const accountKeys = tx.transaction.message.accountKeys;

  for (const ix of tx.transaction.message.instructions) {
    const programId = accountKeys[ix.programIdIndex];
    if (programId === MEMO_PROGRAM_ID && ix.data === expected) {
      return true;
    }
  }

  const logs = tx.meta.logMessages ?? [];
  const needle = `mppsol/pay nonce=${expected}`;
  for (const log of logs) {
    if (log.includes(needle)) return true;
  }
  return false;
}

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

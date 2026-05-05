import { b64urlEncode, serializeReceipt, type SolanaReceipt } from '@mppsol/core';
import type { ReceiptData } from './types.js';

// Convert internal receipt data (bigints, byte arrays) into the
// wire-format SolanaReceipt (strings, base64url) and serialize as a
// `Payment-Receipt` header value.
export function buildReceiptHeader(data: ReceiptData): string {
  return serializeReceipt(toWireReceipt(data));
}

export function toWireReceipt(data: ReceiptData): SolanaReceipt {
  if (data.scheme === 'solana-direct') {
    return {
      scheme: 'solana-direct',
      tx: b64urlEncode(data.tx),
      slot: data.slot.toString(),
      cluster: data.cluster,
      recipient: data.recipient,
      mint: data.mint,
      amount: data.amount.toString(),
      nonce: b64urlEncode(data.nonce),
    };
  }
  const result: SolanaReceipt = {
    scheme: 'solana-session',
    session: data.session,
    sequence: data.sequence.toString(),
    amount: data.amount.toString(),
    nonce: b64urlEncode(data.nonce),
  };
  if (data.settlementTx) {
    (result as { settlementTx?: string }).settlementTx = b64urlEncode(
      data.settlementTx,
    );
  }
  return result;
}

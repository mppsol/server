import type {
  Amount,
  Base58Pubkey,
  Cluster,
  Confirmation,
  Mint,
  Scheme,
  Session,
} from '@mppsol/core';

// Configuration for the MPP.sol server middleware.
export interface ServerConfig {
  realm: string;
  cluster: Cluster;
  recipient: Base58Pubkey;
  mint: Mint;
  amount: Amount;
  rpcUrl: string;
  schemes?: Scheme[];
  minConfirmations?: Confirmation;
  deadlineSecs?: number;
  nonces: NonceStore;
  sessions?: SessionStore;
}

// Server-issued nonce metadata.
export interface NonceRecord {
  nonce: Uint8Array;
  deadline: number;
  consumed: boolean;
  consumedAt?: number;
}

// Storage interface for issued challenge nonces. See spec/wire.md §6.
// Implementations MUST be durable enough to survive crashes within
// the deadline window.
export interface NonceStore {
  reserve(nonce: Uint8Array, deadline: number): Promise<void>;
  consume(nonce: Uint8Array): Promise<NonceRecord | null>;
  isFresh(nonce: Uint8Array): Promise<boolean>;
}

// Storage interface for session state. See spec/session.md.
export interface SessionStore {
  get(sessionPubkey: Base58Pubkey): Promise<Session | null>;
  recordSettle(
    sessionPubkey: Base58Pubkey,
    sequence: bigint,
    amount: bigint,
  ): Promise<boolean>;
}

// Result of verifying an Authorization: Payment header.
export type VerifyResult =
  | { ok: true; receipt: ReceiptData }
  | { ok: false; error: string };

// Internal receipt representation, before serialization to a header.
export type ReceiptData =
  | DirectReceiptData
  | SessionReceiptData;

export interface DirectReceiptData {
  scheme: 'solana-direct';
  tx: Uint8Array;
  slot: bigint;
  cluster: Cluster;
  recipient: Base58Pubkey;
  mint: Mint;
  amount: bigint;
  nonce: Uint8Array;
}

export interface SessionReceiptData {
  scheme: 'solana-session';
  session: Base58Pubkey;
  sequence: bigint;
  amount: bigint;
  nonce: Uint8Array;
  settlementTx?: Uint8Array;
}

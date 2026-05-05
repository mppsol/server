import type { Confirmation } from '@mppsol/core';

// Minimal Solana JSON-RPC client. Uses fetch — works in Node 20+,
// Bun, Deno, Cloudflare Workers, browsers. No SDK dependency.
//
// Only the subset of methods MPP.sol verification needs is implemented.

export interface RpcClient {
  getTransaction(
    signatureBase58: string,
    commitment: Confirmation,
  ): Promise<RpcTransaction | null>;
  getSlot(commitment: Confirmation): Promise<bigint>;
  getGenesisHash(): Promise<string>;
}

export interface RpcTransaction {
  slot: bigint;
  blockTime: bigint | null;
  meta: {
    err: unknown | null;
    preTokenBalances?: TokenBalance[];
    postTokenBalances?: TokenBalance[];
    preBalances?: bigint[];
    postBalances?: bigint[];
    logMessages?: string[];
  };
  transaction: {
    message: {
      accountKeys: string[];
      instructions: Instruction[];
    };
    signatures: string[];
  };
}

export interface TokenBalance {
  accountIndex: number;
  mint: string;
  owner?: string;
  uiTokenAmount: { amount: string; decimals: number };
}

export interface Instruction {
  programIdIndex: number;
  accounts: number[];
  data: string;
}

export function createRpcClient(rpcUrl: string): RpcClient {
  let nextId = 1;

  async function call<T>(method: string, params: unknown[]): Promise<T> {
    const res = await fetch(rpcUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: nextId++,
        method,
        params,
      }),
    });
    if (!res.ok) {
      throw new Error(`RPC HTTP ${res.status}: ${await res.text()}`);
    }
    const json = (await res.json()) as { result?: T; error?: { message: string } };
    if (json.error) throw new Error(`RPC error: ${json.error.message}`);
    return json.result as T;
  }

  return {
    async getTransaction(sig, commitment) {
      const raw = await call<RawTx | null>('getTransaction', [
        sig,
        {
          commitment,
          maxSupportedTransactionVersion: 0,
          encoding: 'json',
        },
      ]);
      if (!raw) return null;
      return normalizeTransaction(raw);
    },
    async getSlot(commitment) {
      const slot = await call<number>('getSlot', [{ commitment }]);
      return BigInt(slot);
    },
    async getGenesisHash() {
      return call<string>('getGenesisHash', []);
    },
  };
}

interface RawTx {
  slot: number;
  blockTime: number | null;
  meta: {
    err: unknown | null;
    preTokenBalances?: TokenBalance[];
    postTokenBalances?: TokenBalance[];
    preBalances?: number[];
    postBalances?: number[];
    logMessages?: string[];
  };
  transaction: {
    message: {
      accountKeys: string[];
      instructions: Instruction[];
    };
    signatures: string[];
  };
}

function normalizeTransaction(raw: RawTx): RpcTransaction {
  return {
    slot: BigInt(raw.slot),
    blockTime: raw.blockTime === null ? null : BigInt(raw.blockTime),
    meta: {
      err: raw.meta.err,
      preTokenBalances: raw.meta.preTokenBalances,
      postTokenBalances: raw.meta.postTokenBalances,
      preBalances: raw.meta.preBalances?.map(BigInt),
      postBalances: raw.meta.postBalances?.map(BigInt),
      logMessages: raw.meta.logMessages,
    },
    transaction: raw.transaction,
  };
}

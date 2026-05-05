import { base64urlnopad } from '@scure/base';
import type {
  Cluster,
  Confirmation,
  Scheme,
  SolanaAuthorization,
  SolanaChallenge,
  SolanaReceipt,
} from '@mppsol/core';

// MPP header parser. Conforms to the parameter envelope defined in
// upstream MPP and used by spec/wire.md. Values MUST be quoted.

interface ParsedHeader {
  scheme: string;
  params: Record<string, string>;
}

function parseHeader(raw: string): ParsedHeader {
  const trimmed = raw.trim();
  const spaceIdx = trimmed.indexOf(' ');
  if (spaceIdx === -1) {
    throw new Error('expected scheme followed by parameters');
  }
  const scheme = trimmed.slice(0, spaceIdx);
  if (scheme.toLowerCase() !== 'payment') {
    throw new Error(`unsupported HTTP auth scheme: ${scheme}`);
  }
  const params = parseParams(trimmed.slice(spaceIdx + 1));
  return { scheme, params };
}

function parseParams(s: string): Record<string, string> {
  const out: Record<string, string> = {};
  let i = 0;
  while (i < s.length) {
    while (i < s.length && /[\s,]/.test(s[i]!)) i++;
    if (i >= s.length) break;

    const keyStart = i;
    while (i < s.length && s[i] !== '=' && !/\s/.test(s[i]!)) i++;
    const key = s.slice(keyStart, i).trim().toLowerCase();
    while (i < s.length && /\s/.test(s[i]!)) i++;
    if (s[i] !== '=') {
      throw new Error(`expected '=' after parameter ${key}`);
    }
    i++;
    while (i < s.length && /\s/.test(s[i]!)) i++;

    let value: string;
    if (s[i] === '"') {
      i++;
      const valStart = i;
      while (i < s.length && s[i] !== '"') {
        if (s[i] === '\\' && i + 1 < s.length) i++;
        i++;
      }
      value = s.slice(valStart, i);
      i++;
    } else {
      const valStart = i;
      while (i < s.length && !/[\s,]/.test(s[i]!)) i++;
      value = s.slice(valStart, i);
    }
    out[key] = value;
  }
  return out;
}

function quote(value: string): string {
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

function paramRequired(
  params: Record<string, string>,
  name: string,
): string {
  const v = params[name];
  if (v === undefined) throw new Error(`missing required parameter: ${name}`);
  return v;
}

// === Challenge (server → client) ============================================

export function serializeChallenge(c: SolanaChallenge): string {
  const parts: string[] = [
    `realm=${quote(c.realm)}`,
    `methods=${quote(c.methods.join(', '))}`,
    `solana-cluster=${quote(c.cluster)}`,
    `solana-recipient=${quote(c.recipient)}`,
    `solana-mint=${quote(c.mint)}`,
    `solana-amount=${quote(c.amount)}`,
    `solana-nonce=${quote(c.nonce)}`,
    `solana-deadline=${quote(c.deadline)}`,
  ];
  if (c.minConfirmations) {
    parts.push(`solana-min-confirmations=${quote(c.minConfirmations)}`);
  }
  return `Payment ${parts.join(', ')}`;
}

export function parseChallenge(raw: string): SolanaChallenge {
  const { params } = parseHeader(raw);
  const methods = paramRequired(params, 'methods')
    .split(',')
    .map((m) => m.trim() as Scheme);
  const challenge: SolanaChallenge = {
    realm: paramRequired(params, 'realm'),
    methods,
    cluster: paramRequired(params, 'solana-cluster') as Cluster,
    recipient: paramRequired(params, 'solana-recipient'),
    mint: paramRequired(params, 'solana-mint'),
    amount: paramRequired(params, 'solana-amount'),
    nonce: paramRequired(params, 'solana-nonce'),
    deadline: paramRequired(params, 'solana-deadline'),
  };
  const minConf = params['solana-min-confirmations'];
  if (minConf) challenge.minConfirmations = minConf as Confirmation;
  return challenge;
}

// Optional error parameter on a 402 retry response. See spec/wire.md §9.
export function serializeChallengeError(error: string): string {
  return `Payment error=${quote(error)}`;
}

// === Authorization (client → server) ========================================

export function parseAuthorization(raw: string): SolanaAuthorization {
  const { params } = parseHeader(raw);
  const scheme = paramRequired(params, 'scheme') as Scheme;
  if (scheme === 'solana-direct') {
    return {
      scheme,
      signature: paramRequired(params, 'signature'),
      nonce: paramRequired(params, 'nonce'),
    };
  }
  if (scheme === 'solana-session') {
    return {
      scheme,
      session: paramRequired(params, 'session'),
      debit: paramRequired(params, 'debit'),
      signature: paramRequired(params, 'signature'),
    };
  }
  throw new Error(`unknown scheme: ${scheme}`);
}

export function serializeAuthorization(a: SolanaAuthorization): string {
  if (a.scheme === 'solana-direct') {
    return `Payment scheme=${quote(a.scheme)}, signature=${quote(a.signature)}, nonce=${quote(a.nonce)}`;
  }
  return `Payment scheme=${quote(a.scheme)}, session=${quote(a.session)}, debit=${quote(a.debit)}, signature=${quote(a.signature)}`;
}

// === Receipt (server → client) ==============================================

export function serializeReceipt(r: SolanaReceipt): string {
  if (r.scheme === 'solana-direct') {
    return [
      `Payment scheme=${quote(r.scheme)}`,
      `tx=${quote(r.tx)}`,
      `slot=${quote(r.slot)}`,
      `cluster=${quote(r.cluster)}`,
      `recipient=${quote(r.recipient)}`,
      `mint=${quote(r.mint)}`,
      `amount=${quote(r.amount)}`,
      `nonce=${quote(r.nonce)}`,
    ].join(', ');
  }
  const base = [
    `Payment scheme=${quote(r.scheme)}`,
    `session=${quote(r.session)}`,
    `sequence=${quote(r.sequence)}`,
    `amount=${quote(r.amount)}`,
    `nonce=${quote(r.nonce)}`,
  ];
  if (r.settlementTx) base.push(`settlement-tx=${quote(r.settlementTx)}`);
  return base.join(', ');
}

export function parseReceipt(raw: string): SolanaReceipt {
  const { params } = parseHeader(raw);
  const scheme = paramRequired(params, 'scheme') as Scheme;
  if (scheme === 'solana-direct') {
    return {
      scheme,
      tx: paramRequired(params, 'tx'),
      slot: paramRequired(params, 'slot'),
      cluster: paramRequired(params, 'cluster') as Cluster,
      recipient: paramRequired(params, 'recipient'),
      mint: paramRequired(params, 'mint'),
      amount: paramRequired(params, 'amount'),
      nonce: paramRequired(params, 'nonce'),
    };
  }
  if (scheme === 'solana-session') {
    const result: SolanaReceipt = {
      scheme,
      session: paramRequired(params, 'session'),
      sequence: paramRequired(params, 'sequence'),
      amount: paramRequired(params, 'amount'),
      nonce: paramRequired(params, 'nonce'),
    };
    const settlementTx = params['settlement-tx'];
    if (settlementTx) (result as { settlementTx?: string }).settlementTx = settlementTx;
    return result;
  }
  throw new Error(`unknown scheme: ${scheme}`);
}

// === Helpers ================================================================

export function b64urlEncode(bytes: Uint8Array): string {
  return base64urlnopad.encode(bytes);
}

export function b64urlDecode(s: string): Uint8Array {
  return base64urlnopad.decode(s);
}

import type { NonceRecord, NonceStore } from './types.js';

export function generateNonce(): Uint8Array {
  const bytes = new Uint8Array(32);
  globalThis.crypto.getRandomValues(bytes);
  return bytes;
}

// Simple in-memory nonce store. Suitable for development and single-process
// servers. Production deployments should implement NonceStore against a
// durable, cross-replica datastore (Postgres, Redis, etc.).
//
// Memory grows with active nonces; expired entries are pruned lazily on
// reserve/consume. Call sweep() periodically if reserve/consume is rare.
export class InMemoryNonceStore implements NonceStore {
  private readonly map = new Map<string, NonceRecord>();

  async reserve(nonce: Uint8Array, deadline: number): Promise<void> {
    this.sweep();
    const key = toKey(nonce);
    if (this.map.has(key)) {
      throw new Error('nonce already reserved');
    }
    this.map.set(key, { nonce, deadline, consumed: false });
  }

  async consume(nonce: Uint8Array): Promise<NonceRecord | null> {
    const key = toKey(nonce);
    const rec = this.map.get(key);
    if (!rec) return null;
    if (rec.consumed) return null;
    if (Date.now() / 1000 > rec.deadline) return null;
    rec.consumed = true;
    rec.consumedAt = Math.floor(Date.now() / 1000);
    return rec;
  }

  async isFresh(nonce: Uint8Array): Promise<boolean> {
    const key = toKey(nonce);
    const rec = this.map.get(key);
    if (!rec) return false;
    if (rec.consumed) return false;
    if (Date.now() / 1000 > rec.deadline) return false;
    return true;
  }

  // Removes expired entries. Safe to call any time.
  sweep(): number {
    const now = Date.now() / 1000;
    let removed = 0;
    for (const [key, rec] of this.map.entries()) {
      if (now > rec.deadline) {
        this.map.delete(key);
        removed++;
      }
    }
    return removed;
  }

  size(): number {
    return this.map.size;
  }
}

function toKey(nonce: Uint8Array): string {
  let s = '';
  for (let i = 0; i < nonce.length; i++) {
    s += nonce[i]!.toString(16).padStart(2, '0');
  }
  return s;
}

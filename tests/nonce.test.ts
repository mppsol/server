import { describe, it, expect, beforeEach, vi } from 'vitest';
import { generateNonce, InMemoryNonceStore } from '../src/index.js';

describe('generateNonce', () => {
  it('returns 32 random bytes', () => {
    const nonce = generateNonce();
    expect(nonce.length).toBe(32);
  });

  it('is unique across calls', () => {
    const nonces = new Set();
    for (let i = 0; i < 100; i++) {
      const n = generateNonce();
      const key = Array.from(n).join(',');
      expect(nonces.has(key)).toBe(false);
      nonces.add(key);
    }
  });
});

describe('InMemoryNonceStore', () => {
  let store: InMemoryNonceStore;
  const nowSecs = () => Math.floor(Date.now() / 1000);

  beforeEach(() => {
    store = new InMemoryNonceStore();
  });

  it('reserves a nonce that is initially fresh', async () => {
    const nonce = generateNonce();
    await store.reserve(nonce, nowSecs() + 60);
    expect(await store.isFresh(nonce)).toBe(true);
  });

  it('rejects double-reservation', async () => {
    const nonce = generateNonce();
    await store.reserve(nonce, nowSecs() + 60);
    await expect(store.reserve(nonce, nowSecs() + 60)).rejects.toThrow(
      /already reserved/,
    );
  });

  it('consume returns the record once and marks it consumed', async () => {
    const nonce = generateNonce();
    await store.reserve(nonce, nowSecs() + 60);
    const first = await store.consume(nonce);
    expect(first).not.toBeNull();
    expect(first!.consumed).toBe(true);
  });

  it('consume returns null for already-consumed nonces', async () => {
    const nonce = generateNonce();
    await store.reserve(nonce, nowSecs() + 60);
    await store.consume(nonce);
    expect(await store.consume(nonce)).toBeNull();
  });

  it('consume returns null for unknown nonces', async () => {
    const nonce = generateNonce();
    expect(await store.consume(nonce)).toBeNull();
  });

  it('isFresh returns false after consume', async () => {
    const nonce = generateNonce();
    await store.reserve(nonce, nowSecs() + 60);
    await store.consume(nonce);
    expect(await store.isFresh(nonce)).toBe(false);
  });

  it('treats expired nonces as not fresh', async () => {
    const nonce = generateNonce();
    await store.reserve(nonce, nowSecs() - 1);
    expect(await store.isFresh(nonce)).toBe(false);
    expect(await store.consume(nonce)).toBeNull();
  });

  it('sweep() removes expired entries', async () => {
    const a = generateNonce();
    await store.reserve(a, nowSecs() - 1);
    expect(store.size()).toBe(1);
    expect(store.sweep()).toBe(1);
    expect(store.size()).toBe(0);
  });
});

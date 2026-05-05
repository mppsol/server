import { describe, it, expect } from 'vitest';
import { parseChallenge, b64urlDecode } from '@mppsol/core';
import { issueChallenge, InMemoryNonceStore } from '../src/index.js';

const baseConfig = {
  realm: 'api.example.com',
  cluster: 'mainnet-beta' as const,
  recipient: '9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin',
  mint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
  amount: '1000',
  rpcUrl: 'https://api.mainnet-beta.solana.com',
  nonces: new InMemoryNonceStore(),
};

describe('issueChallenge', () => {
  it('creates a 32-byte nonce', () => {
    const issued = issueChallenge(baseConfig);
    expect(issued.nonce.length).toBe(32);
  });

  it('sets deadline at now + deadlineSecs (default 300)', () => {
    const before = Math.floor(Date.now() / 1000);
    const issued = issueChallenge(baseConfig);
    const after = Math.floor(Date.now() / 1000);
    expect(issued.deadline).toBeGreaterThanOrEqual(before + 300);
    expect(issued.deadline).toBeLessThanOrEqual(after + 300);
  });

  it('respects custom deadlineSecs', () => {
    const before = Math.floor(Date.now() / 1000);
    const issued = issueChallenge({ ...baseConfig, deadlineSecs: 60 });
    expect(issued.deadline).toBeGreaterThanOrEqual(before + 60);
    expect(issued.deadline).toBeLessThanOrEqual(before + 61);
  });

  it('defaults to both schemes when none specified', () => {
    const issued = issueChallenge(baseConfig);
    expect(issued.challenge.methods).toEqual(['solana-direct', 'solana-session']);
  });

  it('honors schemes override', () => {
    const issued = issueChallenge({ ...baseConfig, schemes: ['solana-session'] });
    expect(issued.challenge.methods).toEqual(['solana-session']);
  });

  it('produces a serialized header that round-trips through parseChallenge', () => {
    const issued = issueChallenge(baseConfig);
    const parsed = parseChallenge(issued.headerValue);
    expect(parsed.realm).toBe(baseConfig.realm);
    expect(parsed.recipient).toBe(baseConfig.recipient);
    expect(parsed.mint).toBe(baseConfig.mint);
    expect(parsed.amount).toBe(baseConfig.amount);
    expect(parsed.cluster).toBe(baseConfig.cluster);

    const decoded = b64urlDecode(parsed.nonce);
    expect(decoded.length).toBe(32);
    expect([...decoded]).toEqual([...issued.nonce]);
  });

  it('defaults minConfirmations to "confirmed"', () => {
    const issued = issueChallenge(baseConfig);
    expect(issued.challenge.minConfirmations).toBe('confirmed');
  });
});

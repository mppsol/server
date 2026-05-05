// Server-side configuration types
export type {
  ServerConfig,
  NonceStore,
  NonceRecord,
  SessionStore,
  VerifyResult,
  ReceiptData,
  DirectReceiptData,
  SessionReceiptData,
} from './types.js';

// Header parse / serialize (re-exported from @mppsol/core for convenience)
export {
  parseChallenge,
  serializeChallenge,
  parseAuthorization,
  serializeAuthorization,
  parseReceipt,
  serializeReceipt,
  serializeChallengeError,
  b64urlEncode,
  b64urlDecode,
} from '@mppsol/core';

// Nonce generation + in-memory store
export { generateNonce, InMemoryNonceStore } from './nonce.js';

// Challenge issuance
export { issueChallenge, type IssuedChallenge } from './challenge.js';

// Verification primitives
export { verifyDirect } from './verify-direct.js';
export { verifySession } from './verify-session.js';

// Receipt building
export { buildReceiptHeader, toWireReceipt } from './receipt.js';

// Solana RPC client
export { createRpcClient, type RpcClient, type RpcTransaction } from './rpc.js';

// Hono middleware (also re-exported from "@mppsol/server/hono")
export { mppMiddleware, type MppMiddlewareOptions } from './middleware.js';

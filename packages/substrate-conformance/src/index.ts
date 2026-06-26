// index.ts
export { runSubstrateConformance } from "./conformance.js";
export { createMemorySubstrate } from "./memory.js";
export { makeEd25519Key, type ConformanceKey, type MakeKeys } from "./keys.js";
export { buildLink, CONFORMANCE_TIME } from "./builder.js";
export type { KeyedSubstrate } from "./types.js";

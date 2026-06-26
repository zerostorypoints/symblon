// memory.ts
import { HeadConflictError, type Attestation, type Subject } from "@symblon/core";
import type { KeyedSubstrate } from "./types.js";

/** Compose a collision-free map key from a subject's scheme + id. */
function subjectKey(s: Subject): string {
  return `${s.scheme}\u0000${s.id}`; // NUL separator: scheme/id can't forge a collision
}

/**
 * In-memory reference `IntegritySubstrate` — the canonical implementation the
 * conformance suite is written against. Not for production (no persistence),
 * but the behavioural source of truth every real adapter must match. `append`
 * runs to completion synchronously (no internal await), so N concurrent appends
 * resolve deterministically: the first applied wins, the rest see the advanced
 * head and reject — exactly the contract a real DB enforces via constraints.
 */
export function createMemorySubstrate(): KeyedSubstrate {
  const chains = new Map<string, Attestation[]>();
  const keys = new Map<string, Uint8Array>();

  return {
    async append(attestation) {
      const k = subjectKey(attestation.subject);
      const chain = chains.get(k) ?? [];
      const currentHead = chain.length ? chain[chain.length - 1]!.payloadHash : null;
      if (attestation.prevHash !== currentHead) {
        throw new HeadConflictError(attestation.subject, attestation.prevHash, currentHead);
      }
      chains.set(k, [...chain, attestation]);
    },
    async readChain(subject) {
      return [...(chains.get(subjectKey(subject)) ?? [])];
    },
    async head(subject) {
      const chain = chains.get(subjectKey(subject)) ?? [];
      return chain.length ? chain[chain.length - 1]!.payloadHash : null;
    },
    resolver: async (keyId) => keys.get(keyId) ?? null,
    async registerKey(keyId, publicKey) {
      keys.set(keyId, publicKey);
    },
  };
}

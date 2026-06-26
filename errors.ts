// errors.ts
import type { Subject } from "./types/attestation.js";

/**
 * Thrown by `IntegritySubstrate.append` when `att.prevHash` does not equal the
 * subject's current head — an optimistic-concurrency (compare-and-set) failure.
 *
 * - `expected` is the head the attestation chained onto (`att.prevHash`).
 * - `actual` is the subject's true current head at append time
 *   (`null` = genesis / no records yet).
 *
 * This is the engine's one effectful-boundary error: the pure verifiers return
 * result objects (expected branches), but a head race on an append is
 * exceptional, so it throws. Every substrate adapter throws THIS class so
 * callers can reliably `instanceof` it.
 */
export class HeadConflictError extends Error {
  readonly subject: Subject;
  readonly expected: string | null;
  readonly actual: string | null;

  constructor(subject: Subject, expected: string | null, actual: string | null) {
    super(
      `head conflict for ${subject.scheme}:${subject.id} — ` +
        `attestation expected prevHash ${expected ?? "null (genesis)"}, ` +
        `but current head is ${actual ?? "null (genesis)"}`,
    );
    this.name = "HeadConflictError";
    this.subject = subject;
    this.expected = expected;
    this.actual = actual;
    // Keep `instanceof` working even if transpiled below ES2015.
    Object.setPrototypeOf(this, HeadConflictError.prototype);
  }
}

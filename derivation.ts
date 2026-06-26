// derivation.ts
import { attestationRef, parseRef, type AttestationRef } from "./attestation-ref.js";

// Re-exported for back-compat: existing importers expect these from "./derivation.js".
export { attestationRef, type AttestationRef };

/** Reserved event type the engine understands on an INPUT chain: this subject
 *  was (partially) consumed to produce another subject. The matching output
 *  side is the other chain's genesis claim carrying `derivedFrom`. */
export const TRANSFORMATION = "transformation" as const;

/**
 * Parse & validate a genesis claim's `derivedFrom` list (≥ 1 refs), or `null`
 * if absent/malformed. Domain fields may sit alongside `derivedFrom` in the
 * same claim — only the reserved key is engine-parsed (custody_change precedent).
 */
export function parseDerivedFrom(claim: unknown): AttestationRef[] | null {
  if (claim === null || typeof claim !== "object") return null;
  const df = (claim as Record<string, unknown>)["derivedFrom"];
  if (!Array.isArray(df) || df.length === 0) return null;
  const out: AttestationRef[] = [];
  for (const entry of df) {
    const ref = parseRef(entry);
    if (!ref) return null;
    out.push(ref);
  }
  return out;
}

/** Parse & validate a `transformation` claim's `consumedIn` ref, or `null`. */
export function parseConsumedIn(claim: unknown): AttestationRef | null {
  if (claim === null || typeof claim !== "object") return null;
  return parseRef((claim as Record<string, unknown>)["consumedIn"]);
}

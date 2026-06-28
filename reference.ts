// reference.ts
import type { Attestation } from "./types/attestation.js";
import { attestationRef, parseRef, type AttestationRef } from "./attestation-ref.js";

/** A typed, tamper-binding pointer from one chain at an attestation on another:
 *  `rel` is the domain-owned relationship (engine does not interpret it),
 *  `ref` pins the target attestation's exact content. */
export type Reference = { rel: string; ref: AttestationRef };

/** Reserved relationship: a counter-claim contesting the referenced attestation.
 *  The canonical agropass dispute (a party chain → a contested lot attestation). */
export const DISPUTES = "disputes" as const;

/** Build a reference of relationship `rel` pinning `target`. */
export function reference(rel: string, target: Attestation): Reference {
  return { rel, ref: attestationRef(target) };
}

/**
 * Parse & validate a claim's reserved `references` list (≥ 1 entry), or `null`
 * if absent/malformed. Each entry must be `{ rel: non-empty string, ref }` with
 * a well-formed, tamper-binding `ref`. Domain fields may sit alongside
 * `references` in the same claim — only the reserved key is engine-parsed
 * (custody_change / derivedFrom precedent).
 */
export function parseReferences(claim: unknown): Reference[] | null {
  if (claim === null || typeof claim !== "object") return null;
  const list = (claim as Record<string, unknown>)["references"];
  if (!Array.isArray(list) || list.length === 0) return null;
  const out: Reference[] = [];
  for (const entry of list) {
    if (entry === null || typeof entry !== "object") return null;
    const e = entry as Record<string, unknown>;
    const rel = typeof e["rel"] === "string" ? e["rel"] : null;
    if (!rel?.length) return null;
    const ref = parseRef(e["ref"]);
    if (!ref) return null;
    out.push({ rel, ref });
  }
  return out;
}

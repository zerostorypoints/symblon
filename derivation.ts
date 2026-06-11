// derivation.ts
import type { Attestation, Subject } from "./types/attestation.js";

const HEX64 = /^[0-9a-f]{64}$/;

/** Reserved event type the engine understands on an INPUT chain: this subject
 *  was (partially) consumed to produce another subject. The matching output
 *  side is the other chain's genesis claim carrying `derivedFrom`. */
export const TRANSFORMATION = "transformation" as const;

/** A tamper-binding pointer at one specific attestation on some chain:
 *  id locates it, payloadHash pins its exact content. */
export type AttestationRef = {
  subject: Subject;
  attestationId: string;
  payloadHash: string;
};

/** The ref that pins `a` — used for both `derivedFrom` entries (output genesis
 *  → consumed input state) and `consumedIn` (input chain → output genesis). */
export function attestationRef(a: Attestation): AttestationRef {
  return { subject: a.subject, attestationId: a.id, payloadHash: a.payloadHash };
}

function parseRef(v: unknown): AttestationRef | null {
  if (v === null || typeof v !== "object") return null;
  const r = v as Record<string, unknown>;
  const s = r["subject"];
  if (s === null || typeof s !== "object") return null;
  const subj = s as Record<string, unknown>;
  const scheme = typeof subj["scheme"] === "string" ? subj["scheme"] : null;
  const id = typeof subj["id"] === "string" ? subj["id"] : null;
  const attestationId = typeof r["attestationId"] === "string" ? r["attestationId"] : null;
  const payloadHash = typeof r["payloadHash"] === "string" ? r["payloadHash"] : null;
  if (!scheme?.length || !id?.length || !attestationId?.length) return null;
  if (!payloadHash || !HEX64.test(payloadHash)) return null;
  return { subject: { scheme, id }, attestationId, payloadHash };
}

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

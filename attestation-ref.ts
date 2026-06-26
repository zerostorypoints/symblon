// attestation-ref.ts
import type { Attestation, Subject } from "./types/attestation.js";

const HEX64 = /^[0-9a-f]{64}$/;

/** A tamper-binding pointer at one specific attestation on some chain:
 *  id locates it, payloadHash pins its exact content. */
export type AttestationRef = {
  subject: Subject;
  attestationId: string;
  payloadHash: string;
};

/** The ref that pins `a`. */
export function attestationRef(a: Attestation): AttestationRef {
  return { subject: a.subject, attestationId: a.id, payloadHash: a.payloadHash };
}

/** Parse & validate an unknown value into an AttestationRef, or `null`. */
export function parseRef(v: unknown): AttestationRef | null {
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

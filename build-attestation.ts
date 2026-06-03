// packages/passport-core/build-attestation.ts
import { canonicalize } from "./canonicalize.js";
import { sha256Hex } from "./hash.js";
import type { AttestationInput, UnsignedAttestation } from "./types/attestation.js";

/** The content that gets hashed: everything except payloadHash and proof. */
function content(a: AttestationInput): Record<string, unknown> {
  return {
    id: a.id,
    subject: a.subject,
    issuer: a.issuer,
    type: a.type,
    claim: a.claim,
    assurance: a.assurance,
    occurredAt: a.occurredAt,
    recordedAt: a.recordedAt,
    prevHash: a.prevHash,
  };
}

/** Hash of an attestation's content (proof and payloadHash excluded). */
export function computePayloadHash(a: AttestationInput): string {
  return sha256Hex(canonicalize(content(a)));
}

/** Assemble an unsigned attestation, computing its payloadHash. No signing. */
export function buildAttestation(input: AttestationInput): UnsignedAttestation {
  return { ...input, payloadHash: computePayloadHash(input) };
}

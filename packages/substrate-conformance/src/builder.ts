import {
  buildAttestation,
  signAttestation,
  type Attestation,
  type AttestationInput,
  type Subject,
} from "@symblon/core";
import type { ConformanceKey } from "./keys.js";

/** Fixed timestamp — the engine is pure, so all times are passed in. */
export const CONFORMANCE_TIME = "2026-06-05T00:00:00.000Z";

/** Build + sign one chain link off `prev` (`null` = genesis). */
export async function buildLink(
  key: ConformanceKey,
  subject: Subject,
  prev: Attestation | null,
  partial: Pick<AttestationInput, "id" | "type" | "claim"> &
    Partial<Pick<AttestationInput, "assurance" | "commitments">>,
): Promise<Attestation> {
  const input: AttestationInput = {
    ...partial,
    subject,
    issuer: { scheme: "conformance.issuer", id: "issuer", keyId: key.keyId },
    occurredAt: CONFORMANCE_TIME,
    recordedAt: CONFORMANCE_TIME,
    prevHash: prev ? prev.payloadHash : null,
  };
  return signAttestation(buildAttestation(input), key.signer, CONFORMANCE_TIME);
}

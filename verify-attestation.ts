// verify-attestation.ts
import { ed25519 } from "@noble/curves/ed25519";
import { hexToBytes, utf8ToBytes } from "@noble/hashes/utils";
import { computePayloadHash } from "./build-attestation.js";
import type { Attestation } from "./types/attestation.js";
import type { PublicKeyResolver } from "./types/seams.js";

export type VerifyFailureReason =
  | "payload-hash-mismatch"
  | "bad-signature"
  | "unverifiable";

export type VerifyResult = { ok: true } | { ok: false; reason: VerifyFailureReason };

/** Verify one attestation in isolation: payloadHash integrity + signature. */
export async function verifyAttestation(
  a: Attestation,
  resolvePublicKey: PublicKeyResolver,
): Promise<VerifyResult> {
  if (computePayloadHash(a) !== a.payloadHash) {
    return { ok: false, reason: "payload-hash-mismatch" };
  }
  const pub = await resolvePublicKey(a.proof.keyId);
  if (pub === null) return { ok: false, reason: "unverifiable" };

  const valid = ed25519.verify(hexToBytes(a.proof.signature), utf8ToBytes(a.payloadHash), pub);
  if (!valid) return { ok: false, reason: "bad-signature" };

  return { ok: true };
}

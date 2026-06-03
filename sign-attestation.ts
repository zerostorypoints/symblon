// packages/passport-core/sign-attestation.ts
import type { Attestation, UnsignedAttestation } from "./types/attestation.js";
import type { Signer } from "./types/seams.js";

/** Sign an unsigned attestation, producing a complete Attestation.
 *  `created` (ISO time) is passed in — purity rule. */
export async function signAttestation(
  unsigned: UnsignedAttestation,
  signer: Signer,
  created: string,
): Promise<Attestation> {
  const signature = await signer.sign(unsigned.payloadHash);
  return {
    ...unsigned,
    proof: { type: "ed25519-jcs-2022", keyId: signer.keyId, created, signature },
  };
}

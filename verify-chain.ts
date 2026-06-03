// verify-chain.ts
import { bytesToHex } from "@noble/hashes/utils";
import { verifyAttestation } from "./verify-attestation.js";
import { CUSTODY_CHANGE, type Attestation } from "./types/attestation.js";
import type { PublicKeyResolver } from "./types/seams.js";
import { parseNewController } from "./custody.js";

export type ChainFailureReason =
  | "payload-hash-mismatch"
  | "bad-signature"
  | "unverifiable"
  | "prev-hash-mismatch"
  | "wrong-signer"
  | "malformed-custody-claim"
  | "controller-key-mismatch";

export type ChainVerification =
  | { ok: true }
  | { ok: false; brokenIndex: number; reason: ChainFailureReason };

/**
 * Verify an ordered chain end-to-end. Tracks the active controller key —
 * the only key allowed to sign the next link — and switches it at each
 * `custody_change` (which must itself be signed by the OUTGOING controller).
 * Returns the first broken link's index and reason, or { ok: true }.
 * An empty chain is vacuously valid.
 */
export async function verifyChain(
  atts: Attestation[],
  resolvePublicKey: PublicKeyResolver,
): Promise<ChainVerification> {
  let activeKeyId: string | null = null;

  for (let i = 0; i < atts.length; i++) {
    const a = atts[i]!;
    const prev = i === 0 ? null : atts[i - 1]!;

    // 1. Link integrity (prevHash chains to the previous payloadHash).
    const expectedPrev = prev ? prev.payloadHash : null;
    if (a.prevHash !== expectedPrev) {
      return { ok: false, brokenIndex: i, reason: "prev-hash-mismatch" };
    }

    // 2. Genesis establishes the initial controller = its signer.
    if (activeKeyId === null) activeKeyId = a.proof.keyId;

    // 3. Only the active controller may sign this link.
    if (a.proof.keyId !== activeKeyId) {
      return { ok: false, brokenIndex: i, reason: "wrong-signer" };
    }

    // 4. Cryptographic + payload verification.
    const v = await verifyAttestation(a, resolvePublicKey);
    if (!v.ok) return { ok: false, brokenIndex: i, reason: v.reason };

    // 5. A custody_change (signed by the outgoing controller, just verified)
    //    hands control to the new key for all subsequent links.
    if (a.type === CUSTODY_CHANGE) {
      // 5a. Validate the claim shape before trusting any field.
      const nc = parseNewController(a.claim);
      if (!nc) {
        return { ok: false, brokenIndex: i, reason: "malformed-custody-claim" };
      }
      // 5b. Bind: if the resolver knows the new key, it must match the signed claim.
      const newPub = await resolvePublicKey(nc.keyId);
      if (newPub !== null && bytesToHex(newPub) !== nc.publicKey) {
        return { ok: false, brokenIndex: i, reason: "controller-key-mismatch" };
      }
      activeKeyId = nc.keyId;
    }
  }

  return { ok: true };
}

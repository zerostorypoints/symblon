// verify-reference.ts
import { verifyChain } from "./verify-chain.js";
import { parseReferences } from "./reference.js";
import type { Attestation } from "./types/attestation.js";
import type { PublicKeyResolver } from "./types/seams.js";

export type ReferenceFailureReason =
  | "referencing-chain-invalid"
  | "target-chain-invalid"
  | "no-reference"
  | "reference-mismatch";

export type ReferenceVerification =
  | { ok: true }
  | { ok: false; reason: ReferenceFailureReason };

/**
 * Verify a cross-chain reference end-to-end. Both chains must verify; the
 * `referencing` chain must carry at least one `references` entry whose pinned
 * `ref` exists hash-exact (id + payloadHash) on the `target` chain.
 *
 * Pure: both chains are passed in (the registry serves them; this checks them).
 * The `rel` is NOT interpreted here — relationship meaning is a domain concern
 * (engine validates structure + tamper-binding only; spec §5).
 */
export async function verifyReference(
  referencing: Attestation[],
  target: Attestation[],
  resolvePublicKey: PublicKeyResolver,
): Promise<ReferenceVerification> {
  // 1. The referencing chain must be non-empty and verify end-to-end.
  if (referencing.length === 0) return { ok: false, reason: "referencing-chain-invalid" };
  const rv = await verifyChain(referencing, resolvePublicKey);
  if (!rv.ok) return { ok: false, reason: "referencing-chain-invalid" };

  // 2. The target chain must be non-empty and verify end-to-end.
  if (target.length === 0) return { ok: false, reason: "target-chain-invalid" };
  const tv = await verifyChain(target, resolvePublicKey);
  if (!tv.ok) return { ok: false, reason: "target-chain-invalid" };

  // 3. Collect every well-formed reference across the referencing chain.
  const refs = referencing.flatMap((a) => parseReferences(a.claim) ?? []);
  if (refs.length === 0) return { ok: false, reason: "no-reference" };

  // 4. At least one reference must pin an attestation present on the target
  //    chain, hash-exact (id + payloadHash both match).
  const hit = refs.some((r) =>
    target.some((a) => a.id === r.ref.attestationId && a.payloadHash === r.ref.payloadHash),
  );
  if (!hit) return { ok: false, reason: "reference-mismatch" };

  return { ok: true };
}

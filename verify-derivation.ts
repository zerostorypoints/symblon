// verify-derivation.ts
import { verifyChain } from "./verify-chain.js";
import { parseConsumedIn, parseDerivedFrom, TRANSFORMATION } from "./derivation.js";
import type { Attestation } from "./types/attestation.js";
import type { PublicKeyResolver } from "./types/seams.js";

export type DerivationFailureReason =
  | "output-chain-invalid"
  | "missing-derivation"
  | "input-chain-mismatch"
  | "input-chain-invalid"
  | "reference-mismatch"
  | "consumption-missing";

export type DerivationVerification =
  | { ok: true }
  | { ok: false; reason: DerivationFailureReason; inputSubjectId?: string };

function subjectKey(s: { scheme: string; id: string }): string {
  return `${s.scheme} ${s.id}`;
}

/**
 * Verify a transformation end-to-end: the output chain's genesis declares
 * `derivedFrom` refs pinning the consumed input states; every input chain
 * must (a) itself verify, (b) actually contain the pinned state, and
 * (c) record the consumption — a `transformation` attestation appended AFTER
 * the pinned state whose `consumedIn` pins this exact output genesis.
 *
 * Pure: all chains are passed in (the registry serves the cone; this checks
 * it). One ref per input subject in v1. Quantity conservation is NOT checked
 * here — mass balance is registry-layer analytics (agriculture backbone spec §7).
 */
export async function verifyDerivation(
  output: Attestation[],
  inputs: Attestation[][],
  resolvePublicKey: PublicKeyResolver,
): Promise<DerivationVerification> {
  // 1. The output chain must be non-empty and verify end-to-end.
  if (output.length === 0) return { ok: false, reason: "output-chain-invalid" };
  const ov = await verifyChain(output, resolvePublicKey);
  if (!ov.ok) return { ok: false, reason: "output-chain-invalid" };

  // 2. The output genesis must carry a valid derivedFrom list.
  const genesis = output[0]!;
  const refs = parseDerivedFrom(genesis.claim);
  if (!refs) return { ok: false, reason: "missing-derivation" };

  // 3. Provided input chains must match the refs 1:1 by subject.
  const bySubject = new Map<string, Attestation[]>();
  for (const chain of inputs) {
    if (chain.length === 0) return { ok: false, reason: "input-chain-mismatch" };
    bySubject.set(subjectKey(chain[0]!.subject), chain);
  }
  if (bySubject.size !== refs.length || inputs.length !== refs.length) {
    return { ok: false, reason: "input-chain-mismatch" };
  }

  for (const ref of refs) {
    const chain = bySubject.get(subjectKey(ref.subject));
    if (!chain) {
      return { ok: false, reason: "input-chain-mismatch", inputSubjectId: ref.subject.id };
    }

    // 4. Each input chain must itself verify.
    const iv = await verifyChain(chain, resolvePublicKey);
    if (!iv.ok) {
      return { ok: false, reason: "input-chain-invalid", inputSubjectId: ref.subject.id };
    }

    // 5. The pinned consumed state must exist on the input chain, hash-exact.
    const refIndex = chain.findIndex(
      (a) => a.id === ref.attestationId && a.payloadHash === ref.payloadHash,
    );
    if (refIndex === -1) {
      return { ok: false, reason: "reference-mismatch", inputSubjectId: ref.subject.id };
    }

    // 6. The input chain must record the consumption AFTER the pinned state,
    //    pointing back at this exact output genesis.
    const consumed = chain.some((a, i) => {
      if (i <= refIndex || a.type !== TRANSFORMATION) return false;
      const c = parseConsumedIn(a.claim);
      return (
        c !== null &&
        c.subject.scheme === genesis.subject.scheme &&
        c.subject.id === genesis.subject.id &&
        c.attestationId === genesis.id &&
        c.payloadHash === genesis.payloadHash
      );
    });
    if (!consumed) {
      return { ok: false, reason: "consumption-missing", inputSubjectId: ref.subject.id };
    }
  }

  return { ok: true };
}

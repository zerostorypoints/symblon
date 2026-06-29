// verify-dispute.ts
import {
  verifyReference,
  parseReferences,
  DISPUTES,
  type Attestation,
  type PublicKeyResolver,
} from "@symblon/core";
import { LOT_SCHEME, PARTY_SCHEME } from "./subjects.js";

export type DisputeFailureReason =
  | "not-a-party-chain"
  | "not-a-lot-chain"
  | "no-dispute"
  | "reference-invalid";

export type DisputeVerification =
  | { ok: true }
  | { ok: false; reason: DisputeFailureReason };

/**
 * Verify an agricultural-traceability dispute: a party chain (`agriculture.party`)
 * carrying a `disputes` counter-claim that tamper-bindingly pins an attestation on a lot
 * chain (`agriculture.lot`). Wraps the engine's `verifyReference` and adds the
 * agriculture domain semantics the engine deliberately omits — the scheme roles and the
 * `disputes` relationship (the engine carries `rel` but never interprets it).
 *
 * Pure: both chains are passed in (the registry serves them; this checks them).
 */
export async function verifyDispute(
  partyChain: Attestation[],
  lotChain: Attestation[],
  resolvePublicKey: PublicKeyResolver,
): Promise<DisputeVerification> {
  // 1. Scheme roles: the referencing chain must be a party chain, the target a
  //    lot chain. Checked on every link so a mid-chain scheme switch can't slip.
  if (partyChain.length === 0 || !partyChain.every((a) => a.subject.scheme === PARTY_SCHEME)) {
    return { ok: false, reason: "not-a-party-chain" };
  }
  if (lotChain.length === 0 || !lotChain.every((a) => a.subject.scheme === LOT_SCHEME)) {
    return { ok: false, reason: "not-a-lot-chain" };
  }

  // 2. The party chain must carry at least one `disputes`-relationship reference.
  const hasDispute = partyChain.some((a) => {
    const refs = parseReferences(a.claim);
    return refs !== null && refs.some((r) => r.rel === DISPUTES);
  });
  if (!hasDispute) return { ok: false, reason: "no-dispute" };

  // 3. The tamper-binding cross-chain link must verify: both chains valid, and
  //    a reference pins an attestation present hash-exact on the lot chain. A v1
  //    counter-claim's only reference is its `disputes` ref, so this confirms
  //    that exact ref resolves.
  const v = await verifyReference(partyChain, lotChain, resolvePublicKey);
  if (!v.ok) return { ok: false, reason: "reference-invalid" };

  return { ok: true };
}

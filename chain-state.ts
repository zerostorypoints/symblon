// chain-state.ts
import { parseNewController } from "./custody.js";
import { CUSTODY_CHANGE, type Attestation } from "./types/attestation.js";

/**
 * The current controller keyId of a (structurally valid) chain: the genesis
 * signer, switched at each `custody_change`. Returns `null` for an empty chain.
 * Assumes the chain has already passed `verifyChain` — this is a pure read,
 * not a verification.
 */
export function currentController(atts: Attestation[]): string | null {
  let controller: string | null = null;
  for (const a of atts) {
    if (controller === null) controller = a.proof.keyId;
    if (a.type === CUSTODY_CHANGE) {
      const nc = parseNewController(a.claim);
      if (nc) controller = nc.keyId;
    }
  }
  return controller;
}

/**
 * The effective commitment map of a chain: each attestation's `commitments`
 * merged in order, later entries overriding earlier ones. Pure read.
 */
export function currentCommitments(atts: Attestation[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const a of atts) {
    if (a.commitments) {
      for (const k of Object.keys(a.commitments)) out[k] = a.commitments[k]!;
    }
  }
  return out;
}

// presentation.ts
import { ed25519 } from "@noble/curves/ed25519";
import { hexToBytes, utf8ToBytes } from "@noble/hashes/utils";
import { canonicalize } from "./canonicalize.js";
import { sha256Hex } from "./hash.js";
import { verifyOpening } from "./commitments.js";
import { verifyChain } from "./verify-chain.js";
import { currentController, currentCommitments } from "./chain-state.js";
import type { Attestation, Proof, Subject } from "./types/attestation.js";
import type { PublicKeyResolver, Signer } from "./types/seams.js";

/** One revealed field: its name, value, and the salt that opens its commitment. */
export type DisclosedField = { name: string; value: unknown; salt: string };

/** Caller input to `buildPresentation` (controllerKeyId comes from the signer). */
export type PresentationInput = {
  subject: Subject;
  /** Freshness, caller-supplied (purity rule). */
  nonce: string;
  /** ISO-8601 expiry, caller-supplied. */
  expiresAt: string;
  disclosed: DisclosedField[];
};

/** A signed, short-lived proof of current ownership + selective disclosure. */
export type Presentation = {
  subject: Subject;
  controllerKeyId: string;
  nonce: string;
  expiresAt: string;
  disclosed: DisclosedField[];
  proof: Proof;
};

export type PresentationFailureReason =
  | "expired"
  | "subject-mismatch"
  | "chain-invalid"
  | "not-current-controller"
  | "unverifiable"
  | "bad-signature"
  | "unknown-field"
  | "opening-mismatch";

export type PresentationVerification =
  | { ok: true }
  | { ok: false; reason: PresentationFailureReason };

/** The bytes a presentation's proof signs: canonicalize of its content (sans proof). */
function presentationHash(p: Omit<Presentation, "proof">): string {
  return sha256Hex(
    canonicalize({
      subject: p.subject,
      controllerKeyId: p.controllerKeyId,
      nonce: p.nonce,
      expiresAt: p.expiresAt,
      disclosed: p.disclosed,
    }),
  );
}

/**
 * Build + sign a presentation. The signer IS the claimed current controller;
 * `created` (ISO time) is passed in — purity rule.
 */
export async function buildPresentation(
  input: PresentationInput,
  signer: Signer,
  created: string,
): Promise<Presentation> {
  const unsigned = { ...input, controllerKeyId: signer.keyId };
  const signature = await signer.sign(presentationHash(unsigned));
  return {
    ...unsigned,
    proof: { type: "ed25519-jcs-2022", keyId: signer.keyId, created, signature },
  };
}

/**
 * Verify a presentation against the subject's chain, with zero trust in the
 * presenter:
 *   1. not expired (vs the passed-in `now`),
 *   2. the chain is about this subject and itself verifies,
 *   3. the signer is the chain's CURRENT controller,
 *   4. the signature over the presentation content is valid,
 *   5. every disclosed field opens to the chain's current commitment for it.
 * `now` (ISO time) is passed in — purity rule.
 */
export async function verifyPresentation(
  p: Presentation,
  chain: Attestation[],
  resolvePublicKey: PublicKeyResolver,
  now: string,
): Promise<PresentationVerification> {
  // 1. Freshness.
  if (Date.parse(now) > Date.parse(p.expiresAt)) {
    return { ok: false, reason: "expired" };
  }

  // 2. The chain must be about this subject and verify end-to-end.
  if (
    chain.length === 0 ||
    chain[0]!.subject.scheme !== p.subject.scheme ||
    chain[0]!.subject.id !== p.subject.id
  ) {
    return { ok: false, reason: "subject-mismatch" };
  }
  const cv = await verifyChain(chain, resolvePublicKey);
  if (!cv.ok) return { ok: false, reason: "chain-invalid" };

  // 3. The signer must be the chain's current controller.
  if (p.controllerKeyId !== currentController(chain) || p.proof.keyId !== p.controllerKeyId) {
    return { ok: false, reason: "not-current-controller" };
  }

  // 4. Signature over the presentation content.
  const pub = await resolvePublicKey(p.controllerKeyId);
  if (pub === null) return { ok: false, reason: "unverifiable" };
  const valid = ed25519.verify(hexToBytes(p.proof.signature), utf8ToBytes(presentationHash(p)), pub);
  if (!valid) return { ok: false, reason: "bad-signature" };

  // 5. Every disclosed field opens to the chain's current commitment.
  const commits = currentCommitments(chain);
  for (const d of p.disclosed) {
    const c = commits[d.name];
    if (c === undefined) return { ok: false, reason: "unknown-field" };
    if (!verifyOpening(c, d.value, d.salt)) return { ok: false, reason: "opening-mismatch" };
  }

  return { ok: true };
}

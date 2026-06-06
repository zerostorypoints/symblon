// types/seams.ts
import type { Attestation, Subject } from "./attestation.js";
import type { HeadConflictError } from "../errors.js";

/** Produces a signature. Implementations climb the custody ladder:
 *  platform KMS -> secure enclave -> owned key. Never exposes the private key. */
export type Signer = {
  keyId: string;
  /** Sign the UTF-8 bytes of `message`; return a lowercase hex signature. */
  sign(message: string): Promise<string>;
};

/** Append-only persistence. Implementations span the trust axis:
 *  Supabase-chain (operator-trusted) -> Hypercore/Autobase (trustless P2P). */
export type IntegritySubstrate = {
  /**
   * Atomically append one attestation to its subject's chain (compare-and-set
   * on the head). MUST persist `attestation` iff `attestation.prevHash` equals
   * the subject's current head — the `payloadHash` returned by `head(subject)`,
   * or `null` at genesis (accepted iff the subject has no records yet).
   *
   * On mismatch (a stale or racing writer) MUST reject with
   * {@link HeadConflictError} and persist nothing. This is the engine's
   * accidental-fork guard: two writers reading the same head cannot both
   * append. Adversarial forks are already prevented by the "only the current
   * controller signs" rule enforced in `verifyChain`.
   */
  append(attestation: Attestation): Promise<void>;
  /** Read a subject's full chain in genesis→head order. Empty if unknown. */
  readChain(subject: Subject): Promise<Attestation[]>;
  /** The subject's head `payloadHash`, or `null` before genesis. */
  head(subject: Subject): Promise<string | null>;
};

/** Resolves a keyId to its Ed25519 public key bytes, or null if unknown.
 *  Injected so the pure engine stays I/O-free during verification. */
export type PublicKeyResolver = (keyId: string) => Promise<Uint8Array | null>;

// packages/passport-core/types/seams.ts
import type { Attestation, Subject } from "./attestation.js";

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
  append(attestation: Attestation): Promise<void>;
  readChain(subject: Subject): Promise<Attestation[]>;
  head(subject: Subject): Promise<string | null>;
};

/** Resolves a keyId to its Ed25519 public key bytes, or null if unknown.
 *  Injected so the pure engine stays I/O-free during verification. */
export type PublicKeyResolver = (keyId: string) => Promise<Uint8Array | null>;

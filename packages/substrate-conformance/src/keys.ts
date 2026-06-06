import { ed25519 } from "@noble/curves/ed25519";
import { bytesToHex, utf8ToBytes } from "@noble/hashes/utils";
import type { Signer } from "@symblon/core";

/** A test keypair plus a `Signer` over it. */
export type ConformanceKey = {
  keyId: string;
  publicKey: Uint8Array;
  signer: Signer;
};

/** Factory the suite uses to mint signing keys. Overridable per adapter. */
export type MakeKeys = (keyId: string) => ConformanceKey;

/** Default Ed25519 key factory (matches the engine's curve). */
export const makeEd25519Key: MakeKeys = (keyId) => {
  const priv = ed25519.utils.randomPrivateKey();
  const publicKey = ed25519.getPublicKey(priv);
  const signer: Signer = {
    keyId,
    sign: async (message) => bytesToHex(ed25519.sign(utf8ToBytes(message), priv)),
  };
  return { keyId, publicKey, signer };
};

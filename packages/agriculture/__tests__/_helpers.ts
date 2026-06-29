// __tests__/_helpers.ts — local Ed25519 test helpers (mirror @symblon/core's).
import { ed25519 } from "@noble/curves/ed25519";
import { bytesToHex, utf8ToBytes } from "@noble/hashes/utils";
import type { PublicKeyResolver, Signer } from "@symblon/core";

export type TestKey = { keyId: string; priv: Uint8Array; pub: Uint8Array };

export function makeKey(keyId: string): TestKey {
  const priv = ed25519.utils.randomPrivateKey();
  return { keyId, priv, pub: ed25519.getPublicKey(priv) };
}

/** A Signer that signs the UTF-8 bytes of the message with the key's private key. */
export function signerFor(key: TestKey): Signer {
  return {
    keyId: key.keyId,
    sign: async (message) => bytesToHex(ed25519.sign(utf8ToBytes(message), key.priv)),
  };
}

/** A resolver backed by a fixed set of keys. */
export function resolverFor(...keys: TestKey[]): PublicKeyResolver {
  const map = new Map(keys.map((k) => [k.keyId, k.pub]));
  return async (keyId) => map.get(keyId) ?? null;
}

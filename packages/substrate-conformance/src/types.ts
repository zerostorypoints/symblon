// types.ts
import type { IntegritySubstrate, PublicKeyResolver } from "@symblon/core";

/**
 * The full shape a substrate adapter exposes: the `IntegritySubstrate` seam
 * plus the companion key registry (`PublicKeyResolver` + `registerKey`). The
 * conformance suite is written against this shape; adapters satisfy it
 * structurally (no nominal import required in adapter production code).
 */
export type KeyedSubstrate = IntegritySubstrate & {
  resolver: PublicKeyResolver;
  registerKey(keyId: string, publicKey: Uint8Array): Promise<void>;
};

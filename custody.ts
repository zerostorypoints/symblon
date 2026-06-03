// custody.ts
const HEX64 = /^[0-9a-f]{64}$/;

/** The validated payload a custody_change hands control to. */
export type NewController = { keyId: string; publicKey: string };

/**
 * Parse & validate a `custody_change` claim's `newController`, or `null` if the
 * claim is malformed. `publicKey` must be 64-char lowercase hex; `keyId` must be
 * a non-empty string.
 */
export function parseNewController(claim: unknown): NewController | null {
  if (claim === null || typeof claim !== "object") return null;
  const nc = (claim as Record<string, unknown>)["newController"];
  if (nc === null || typeof nc !== "object") return null;
  const r = nc as Record<string, unknown>;
  const keyId = typeof r["keyId"] === "string" ? r["keyId"] : null;
  const publicKey = typeof r["publicKey"] === "string" ? r["publicKey"] : null;
  if (!keyId || !keyId.length || !publicKey || !HEX64.test(publicKey)) return null;
  return { keyId, publicKey };
}

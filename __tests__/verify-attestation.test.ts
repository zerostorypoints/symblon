// packages/passport-core/__tests__/verify-attestation.test.ts
import { describe, it, expect } from "vitest";
import { buildAttestation } from "../build-attestation.js";
import { signAttestation } from "../sign-attestation.js";
import { verifyAttestation } from "../verify-attestation.js";
import type { AttestationInput } from "../types/attestation.js";
import { makeKey, resolverFor, signerFor } from "./_helpers.js";

const input: AttestationInput = {
  id: "att-1",
  subject: { scheme: "test.subject", id: "s-1" },
  issuer: { scheme: "test.issuer", id: "i-1", keyId: "key-1" },
  type: "mint",
  claim: { owner: "alice" },
  occurredAt: "2026-06-03T00:00:00.000Z",
  recordedAt: "2026-06-03T00:00:00.000Z",
  prevHash: null,
};

async function signed() {
  const key = makeKey("key-1");
  const att = await signAttestation(buildAttestation(input), signerFor(key), input.recordedAt);
  return { key, att };
}

describe("verifyAttestation", () => {
  it("accepts a faithfully signed attestation", async () => {
    const { key, att } = await signed();
    expect(await verifyAttestation(att, resolverFor(key))).toEqual({ ok: true });
  });

  it("reports payload-hash-mismatch when the claim was altered post-hash", async () => {
    const { key, att } = await signed();
    const tampered = { ...att, claim: { owner: "mallory" } };
    expect(await verifyAttestation(tampered, resolverFor(key))).toEqual({
      ok: false,
      reason: "payload-hash-mismatch",
    });
  });

  it("reports bad-signature when signed by a different key", async () => {
    const { att } = await signed();
    const wrongKey = makeKey("key-1"); // same id, different secret
    expect(await verifyAttestation(att, resolverFor(wrongKey))).toEqual({
      ok: false,
      reason: "bad-signature",
    });
  });

  it("reports unverifiable when the key cannot be resolved", async () => {
    const { att } = await signed();
    expect(await verifyAttestation(att, resolverFor())).toEqual({
      ok: false,
      reason: "unverifiable",
    });
  });
});

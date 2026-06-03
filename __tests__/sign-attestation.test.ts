// packages/passport-core/__tests__/sign-attestation.test.ts
import { describe, it, expect } from "vitest";
import { buildAttestation } from "../build-attestation.js";
import { signAttestation } from "../sign-attestation.js";
import type { AttestationInput } from "../types/attestation.js";
import { makeKey, signerFor } from "./_helpers.js";

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

describe("signAttestation", () => {
  it("attaches a hex proof signed by the signer's keyId over payloadHash", async () => {
    const key = makeKey("key-1");
    const unsigned = buildAttestation(input);
    const signed = await signAttestation(unsigned, signerFor(key), "2026-06-03T00:00:01.000Z");
    expect(signed.proof.keyId).toBe("key-1");
    expect(signed.proof.created).toBe("2026-06-03T00:00:01.000Z");
    expect(signed.proof.signature).toMatch(/^[0-9a-f]+$/);
    expect(signed.payloadHash).toBe(unsigned.payloadHash);
  });
});

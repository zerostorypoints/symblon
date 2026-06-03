// __tests__/attestation-schema.test.ts
import { describe, it, expect } from "vitest";
import { AttestationSchema } from "../schemas/attestation.js";
import { sha256Hex } from "../hash.js";
import type { Attestation } from "../types/attestation.js";

const valid: Attestation = {
  id: "att-1",
  subject: { scheme: "test.subject", id: "s-1" },
  issuer: { scheme: "test.issuer", id: "i-1", keyId: "key-1" },
  type: "mint",
  claim: { hello: "world" },
  occurredAt: "2026-06-03T00:00:00.000Z",
  recordedAt: "2026-06-03T00:00:00.000Z",
  prevHash: null,
  payloadHash: sha256Hex("fixture"),
  proof: {
    type: "ed25519-jcs-2022",
    keyId: "key-1",
    created: "2026-06-03T00:00:00.000Z",
    signature: "deadbeef",
  },
};

describe("AttestationSchema", () => {
  it("accepts a well-formed attestation", () => {
    expect(AttestationSchema.safeParse(valid).success).toBe(true);
  });

  it("rejects a missing payloadHash", () => {
    const { payloadHash, ...bad } = valid;
    void payloadHash;
    expect(AttestationSchema.safeParse(bad).success).toBe(false);
  });

  it("rejects a wrong proof.type", () => {
    const bad = { ...valid, proof: { ...valid.proof, type: "rsa" } };
    expect(AttestationSchema.safeParse(bad).success).toBe(false);
  });
});

// packages/passport-core/__tests__/build-attestation.test.ts
import { describe, it, expect } from "vitest";
import { buildAttestation, computePayloadHash } from "../build-attestation.js";
import type { AttestationInput } from "../types/attestation.js";

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

describe("buildAttestation", () => {
  it("returns an unsigned attestation with a 64-hex payloadHash", () => {
    const unsigned = buildAttestation(input);
    expect(unsigned.payloadHash).toMatch(/^[0-9a-f]{64}$/);
    expect("proof" in unsigned).toBe(false);
  });

  it("is deterministic — same input yields the same payloadHash", () => {
    expect(buildAttestation(input).payloadHash).toBe(buildAttestation(input).payloadHash);
  });

  it("changes the payloadHash when the claim changes (tamper-evidence at the leaf)", () => {
    const other = buildAttestation({ ...input, claim: { owner: "bob" } });
    expect(other.payloadHash).not.toBe(buildAttestation(input).payloadHash);
  });

  it("computePayloadHash ignores any existing proof/payloadHash fields", () => {
    const unsigned = buildAttestation(input);
    const rehashed = computePayloadHash(unsigned);
    expect(rehashed).toBe(unsigned.payloadHash);
  });
});

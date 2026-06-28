import { describe, it, expect } from "vitest";
import { attestationRef, parseRef } from "../attestation-ref.js";
import type { Attestation } from "../types/attestation.js";

const HASH = "a".repeat(64);

const att = {
  id: "x1",
  subject: { scheme: "agro.lot", id: "BB-123" },
  payloadHash: HASH,
} as unknown as Attestation;

describe("attestationRef", () => {
  it("pins subject, id, and payloadHash", () => {
    expect(attestationRef(att)).toEqual({
      subject: { scheme: "agro.lot", id: "BB-123" },
      attestationId: "x1",
      payloadHash: HASH,
    });
  });
});

describe("parseRef", () => {
  it("round-trips a built ref", () => {
    expect(parseRef(attestationRef(att))).toEqual(attestationRef(att));
  });
  it("rejects a non-hex payloadHash", () => {
    expect(parseRef({ subject: { scheme: "s", id: "i" }, attestationId: "a", payloadHash: "nope" })).toBeNull();
  });
  it("rejects a missing subject", () => {
    expect(parseRef({ attestationId: "a", payloadHash: HASH })).toBeNull();
  });
  it("rejects null", () => {
    expect(parseRef(null)).toBeNull();
  });
});

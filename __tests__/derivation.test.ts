// __tests__/derivation.test.ts
import { describe, it, expect } from "vitest";
import { attestationRef, parseDerivedFrom, parseConsumedIn } from "../derivation.js";
import { buildAttestation } from "../build-attestation.js";
import { signAttestation } from "../sign-attestation.js";
import { makeKey, signerFor } from "./_helpers.js";

const T = "2026-06-11T00:00:00.000Z";
const HEX64 = "0".repeat(64);

async function someAttestation() {
  const key = makeKey("k1");
  const input = {
    id: "a1",
    subject: { scheme: "agro.batch", id: "raw-1" },
    issuer: { scheme: "agro.producer", id: "szulc", keyId: key.keyId },
    type: "delivery_received",
    claim: { species: "blueberry" },
    occurredAt: T,
    recordedAt: T,
    prevHash: null,
  };
  return signAttestation(buildAttestation(input), signerFor(key), T);
}

describe("attestationRef", () => {
  it("pins the attestation's subject, id, and payloadHash", async () => {
    const a = await someAttestation();
    expect(attestationRef(a)).toEqual({
      subject: { scheme: "agro.batch", id: "raw-1" },
      attestationId: "a1",
      payloadHash: a.payloadHash,
    });
  });
});

describe("parseDerivedFrom", () => {
  const ref = {
    subject: { scheme: "agro.batch", id: "raw-1" },
    attestationId: "a1",
    payloadHash: HEX64,
  };

  it("accepts a claim with valid refs alongside domain fields", () => {
    expect(parseDerivedFrom({ product: "Borówka 250g", derivedFrom: [ref] })).toEqual([ref]);
  });

  it("rejects an empty derivedFrom list", () => {
    expect(parseDerivedFrom({ derivedFrom: [] })).toBeNull();
  });

  it("rejects a ref with a non-hex payloadHash", () => {
    expect(parseDerivedFrom({ derivedFrom: [{ ...ref, payloadHash: "nope" }] })).toBeNull();
  });

  it("rejects a ref with a missing subject field", () => {
    expect(parseDerivedFrom({ derivedFrom: [{ ...ref, subject: { scheme: "agro.batch" } }] })).toBeNull();
  });

  it("rejects a claim without derivedFrom", () => {
    expect(parseDerivedFrom({ other: 1 })).toBeNull();
  });

  it("rejects non-object claims", () => {
    expect(parseDerivedFrom("nope")).toBeNull();
    expect(parseDerivedFrom(null)).toBeNull();
  });
});

describe("parseConsumedIn", () => {
  const ref = {
    subject: { scheme: "agro.batch", id: "fg-1" },
    attestationId: "g1",
    payloadHash: HEX64,
  };

  it("accepts a claim with a valid consumedIn ref alongside domain fields", () => {
    expect(parseConsumedIn({ consumedIn: ref, note: "ZP-77" })).toEqual(ref);
  });

  it("rejects a missing or malformed consumedIn", () => {
    expect(parseConsumedIn({})).toBeNull();
    expect(parseConsumedIn({ consumedIn: { attestationId: "g1" } })).toBeNull();
    expect(parseConsumedIn(null)).toBeNull();
  });
});

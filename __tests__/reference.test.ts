import { describe, it, expect } from "vitest";
import { reference, parseReferences, DISPUTES } from "../reference.js";
import { attestationRef } from "../attestation-ref.js";
import type { Attestation } from "../types/attestation.js";

const HASH = "b".repeat(64);
const target = {
  id: "w2",
  subject: { scheme: "agro.lot", id: "BB-123" },
  payloadHash: HASH,
} as unknown as Attestation;

describe("reference / parseReferences", () => {
  it("builds a disputes reference and round-trips it through a claim", () => {
    const claim = { note: "I contest the mold finding", references: [reference(DISPUTES, target)] };
    expect(parseReferences(claim)).toEqual([
      { rel: "disputes", ref: attestationRef(target) },
    ]);
  });

  it("ignores non-reserved domain fields in the same claim", () => {
    const claim = { species: "blueberry", references: [reference("relatedTo", target)] };
    const parsed = parseReferences(claim);
    expect(parsed).not.toBeNull();
    expect(parsed![0]!.rel).toBe("relatedTo");
  });

  it("returns null when the references key is absent", () => {
    expect(parseReferences({ species: "blueberry" })).toBeNull();
  });

  it("returns null for an empty references array", () => {
    expect(parseReferences({ references: [] })).toBeNull();
  });

  it("returns null when an entry has a non-string rel", () => {
    expect(parseReferences({ references: [{ rel: 5, ref: attestationRef(target) }] })).toBeNull();
  });

  it("returns null when an entry's ref is malformed", () => {
    expect(parseReferences({ references: [{ rel: "disputes", ref: { nope: true } }] })).toBeNull();
  });
});

// dispute.test.ts
import { describe, it, expect } from "vitest";
import { DISPUTES } from "@symblon/core";
import type { Attestation } from "@symblon/core";
import {
  COUNTER_CLAIM,
  disputeClaim,
  disputedRefs,
  CounterClaimClaimSchema,
} from "../src/dispute.js";

const HASH = "a".repeat(64);
const contested = {
  id: "w2",
  subject: { scheme: "agropass.lot", id: "BB-123" },
  payloadHash: HASH,
} as unknown as Attestation;

describe("COUNTER_CLAIM", () => {
  it("is the agropass counter-claim event type", () => {
    expect(COUNTER_CLAIM).toBe("counter_claim");
  });
});

describe("disputeClaim", () => {
  it("builds a disputes reference pinning the contested attestation by payloadHash", () => {
    const claim = disputeClaim(contested);
    expect(claim).toEqual({
      references: [
        { rel: DISPUTES, ref: { subject: contested.subject, attestationId: "w2", payloadHash: HASH } },
      ],
    });
  });

  it("omits note when absent (exactOptionalPropertyTypes) and includes it when given", () => {
    expect("note" in disputeClaim(contested)).toBe(false);
    expect(disputeClaim(contested, "moldy on arrival").note).toBe("moldy on arrival");
  });
});

describe("CounterClaimClaimSchema", () => {
  it("accepts a well-formed counter-claim", () => {
    expect(CounterClaimClaimSchema.safeParse(disputeClaim(contested, "note")).success).toBe(true);
  });

  it("rejects a claim whose references carry no `disputes` relationship", () => {
    const claim = { references: [{ rel: "relatedTo", ref: { subject: contested.subject, attestationId: "w2", payloadHash: HASH } }] };
    const res = CounterClaimClaimSchema.safeParse(claim);
    expect(res.success).toBe(false);
  });

  it("rejects an empty references list", () => {
    expect(CounterClaimClaimSchema.safeParse({ references: [] }).success).toBe(false);
  });

  it("rejects a malformed payloadHash", () => {
    const claim = { references: [{ rel: DISPUTES, ref: { subject: contested.subject, attestationId: "w2", payloadHash: "nope" } }] };
    expect(CounterClaimClaimSchema.safeParse(claim).success).toBe(false);
  });
});

describe("disputedRefs", () => {
  it("extracts the disputed refs from a counter-claim claim", () => {
    expect(disputedRefs(disputeClaim(contested))).toEqual([
      { subject: contested.subject, attestationId: "w2", payloadHash: HASH },
    ]);
  });

  it("ignores non-disputes references and returns null when none are disputes", () => {
    const claim = { references: [{ rel: "relatedTo", ref: { subject: contested.subject, attestationId: "w2", payloadHash: HASH } }] };
    expect(disputedRefs(claim)).toBeNull();
  });

  it("returns null for a claim with no references", () => {
    expect(disputedRefs({ note: "hi" })).toBeNull();
  });
});

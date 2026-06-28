// __tests__/verify-reference.test.ts
import { describe, it, expect } from "vitest";
import { buildAttestation } from "../build-attestation.js";
import { signAttestation } from "../sign-attestation.js";
import { verifyReference } from "../verify-reference.js";
import { reference, DISPUTES } from "../reference.js";
import type { Attestation, AttestationInput, Subject } from "../types/attestation.js";
import { makeKey, resolverFor, signerFor, type TestKey } from "./_helpers.js";

const T = "2026-06-26T00:00:00.000Z";

async function link(
  key: TestKey,
  subject: Subject,
  prev: Attestation | null,
  partial: Pick<AttestationInput, "id" | "type" | "claim">,
): Promise<Attestation> {
  const input: AttestationInput = {
    ...partial,
    subject,
    issuer: { scheme: "agropass.party", id: "actor", keyId: key.keyId },
    occurredAt: T,
    recordedAt: T,
    prevHash: prev ? prev.payloadHash : null,
  };
  return signAttestation(buildAttestation(input), signerFor(key), T);
}

const lot: Subject = { scheme: "agropass.lot", id: "BB-123" };
const growerChain: Subject = { scheme: "agropass.party", id: "grower-7" };

/** Lot chain: grower harvest → custody passes → wholesaler records a rejection.
 *  (Custody mechanics are exercised elsewhere; here both lot links are signed by
 *  one key for brevity — verifyReference only cares the chain verifies + the
 *  pinned attestation exists.) */
async function lotChain(key: TestKey): Promise<Attestation[]> {
  const g1 = await link(key, lot, null, { id: "g1", type: "harvest", claim: { species: "blueberry" } });
  const w2 = await link(key, lot, g1, {
    id: "w2",
    type: "quality_rejection",
    claim: { grade: "C", reason: "mold" },
  });
  return [g1, w2];
}

describe("verifyReference", () => {
  it("accepts a party chain that disputes a real lot attestation", async () => {
    const lotKey = makeKey("lot-signer");
    const growerKey = makeKey("grower-7");
    const resolver = resolverFor(lotKey, growerKey);

    const lc = await lotChain(lotKey);
    const rejection = lc[1]!;

    const d1 = await link(growerKey, growerChain, null, {
      id: "d1",
      type: "counter_claim",
      claim: { note: "I dispute the mold finding", references: [reference(DISPUTES, rejection)] },
    });

    expect(await verifyReference([d1], lc, resolver)).toEqual({ ok: true });
  });

  it("rejects when the referencing chain carries no references", async () => {
    const lotKey = makeKey("lot-signer");
    const growerKey = makeKey("grower-7");
    const resolver = resolverFor(lotKey, growerKey);
    const lc = await lotChain(lotKey);
    const d1 = await link(growerKey, growerChain, null, { id: "d1", type: "note", claim: { note: "hi" } });

    expect(await verifyReference([d1], lc, resolver)).toEqual({ ok: false, reason: "no-reference" });
  });

  it("rejects when the pinned attestation is not on the target chain", async () => {
    const lotKey = makeKey("lot-signer");
    const growerKey = makeKey("grower-7");
    const resolver = resolverFor(lotKey, growerKey);
    const lc = await lotChain(lotKey);
    const rejection = lc[1]!;

    // Tamper: dispute references a forged copy with a different payloadHash.
    const forged = { ...rejection, payloadHash: "f".repeat(64) } as Attestation;
    const d1 = await link(growerKey, growerChain, null, {
      id: "d1",
      type: "counter_claim",
      claim: { references: [reference(DISPUTES, forged)] },
    });

    expect(await verifyReference([d1], lc, resolver)).toEqual({ ok: false, reason: "reference-mismatch" });
  });

  it("rejects when the target chain does not verify", async () => {
    const lotKey = makeKey("lot-signer");
    const growerKey = makeKey("grower-7");
    const resolver = resolverFor(lotKey, growerKey);
    const lc = await lotChain(lotKey);
    const rejection = lc[1]!;
    const d1 = await link(growerKey, growerChain, null, {
      id: "d1",
      type: "counter_claim",
      claim: { references: [reference(DISPUTES, rejection)] },
    });

    // Break the target chain's genesis link.
    const brokenTarget = [{ ...lc[0]!, payloadHash: "0".repeat(64) } as Attestation, lc[1]!];
    expect(await verifyReference([d1], brokenTarget, resolver)).toEqual({
      ok: false,
      reason: "target-chain-invalid",
    });
  });

  it("rejects when the referencing chain does not verify", async () => {
    const lotKey = makeKey("lot-signer");
    const growerKey = makeKey("grower-7");
    const resolver = resolverFor(lotKey, growerKey);
    const lc = await lotChain(lotKey);
    const rejection = lc[1]!;
    const d1 = await link(growerKey, growerChain, null, {
      id: "d1",
      type: "counter_claim",
      claim: { references: [reference(DISPUTES, rejection)] },
    });

    const broken = [{ ...d1, payloadHash: "0".repeat(64) } as Attestation];
    expect(await verifyReference(broken, lc, resolver)).toEqual({
      ok: false,
      reason: "referencing-chain-invalid",
    });
  });
});

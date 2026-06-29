// verify-dispute.test.ts
//
// End-to-end agricultural-traceability dispute scenario (the runnable narrative):
// a grower harvests a lot of blueberries and hands custody to a wholesaler
// (real custody_change baton-pass); the wholesaler — now sole controller —
// records a quality rejection on the lot chain. The grower, no longer able to
// touch the lot chain, records a counter-claim on its OWN party chain that
// tamper-bindingly references the rejection. verifyDispute confirms the link.
import { describe, it, expect } from "vitest";
import { bytesToHex } from "@noble/hashes/utils";
import { buildAttestation, signAttestation, CUSTODY_CHANGE } from "@symblon/core";
import type { Attestation, AttestationInput, Subject } from "@symblon/core";
import { lotSubject, partySubject } from "../src/subjects.js";
import { COUNTER_CLAIM, disputeClaim } from "../src/dispute.js";
import { verifyDispute } from "../src/verify-dispute.js";
import { makeKey, resolverFor, signerFor, type TestKey } from "./_helpers.js";

const T = "2026-06-28T00:00:00.000Z";

async function link(
  key: TestKey,
  subject: Subject,
  prev: Attestation | null,
  partial: Pick<AttestationInput, "id" | "type" | "claim">,
): Promise<Attestation> {
  const input: AttestationInput = {
    ...partial,
    subject,
    issuer: { scheme: subject.scheme, id: "demo", keyId: key.keyId },
    occurredAt: T,
    recordedAt: T,
    prevHash: prev ? prev.payloadHash : null,
  };
  return signAttestation(buildAttestation(input), signerFor(key), T);
}

const lot: Subject = lotSubject("BB-123");
const growerParty: Subject = partySubject("grower-7");

/** Lot chain with a real custody handoff grower → wholesaler, ending in a
 *  wholesaler-signed rejection. Returns the chain and the rejection link. */
async function lotChainWithRejection(grower: TestKey, wholesaler: TestKey) {
  const g1 = await link(grower, lot, null, { id: "g1", type: "harvest", claim: { species: "blueberry" } });
  const handoff = await link(grower, lot, g1, {
    id: "g2",
    type: CUSTODY_CHANGE,
    claim: { newController: { keyId: wholesaler.keyId, publicKey: bytesToHex(wholesaler.pub) } },
  });
  const received = await link(wholesaler, lot, handoff, { id: "w1", type: "received", claim: {} });
  const rejection = await link(wholesaler, lot, received, {
    id: "w2",
    type: "quality_rejection",
    claim: { grade: "C", reason: "mold" },
  });
  return { chain: [g1, handoff, received, rejection], rejection };
}

describe("verifyDispute", () => {
  it("accepts a grower's counter-claim against a wholesaler's rejection across the custody handoff", async () => {
    const grower = makeKey("grower-key");
    const wholesaler = makeKey("wholesaler-key");
    const resolver = resolverFor(grower, wholesaler);

    const { chain, rejection } = await lotChainWithRejection(grower, wholesaler);
    const dispute = await link(grower, growerParty, null, {
      id: "d1",
      type: COUNTER_CLAIM,
      claim: disputeClaim(rejection, "Lot was sound at dispatch; dispute the mold finding"),
    });

    expect(await verifyDispute([dispute], chain, resolver)).toEqual({ ok: true });
  });

  it("rejects a tampered reference (rejection's payloadHash changed)", async () => {
    const grower = makeKey("grower-key");
    const wholesaler = makeKey("wholesaler-key");
    const resolver = resolverFor(grower, wholesaler);

    const { chain, rejection } = await lotChainWithRejection(grower, wholesaler);
    const forged = { ...rejection, payloadHash: "f".repeat(64) } as Attestation;
    const dispute = await link(grower, growerParty, null, {
      id: "d1",
      type: COUNTER_CLAIM,
      claim: disputeClaim(forged),
    });

    expect(await verifyDispute([dispute], chain, resolver)).toEqual({ ok: false, reason: "reference-invalid" });
  });

  it("rejects when the referencing chain is not a party chain", async () => {
    const grower = makeKey("grower-key");
    const wholesaler = makeKey("wholesaler-key");
    const resolver = resolverFor(grower, wholesaler);

    const { chain, rejection } = await lotChainWithRejection(grower, wholesaler);
    // Put the counter-claim on a LOT-scheme subject instead of a party chain.
    const dispute = await link(grower, lotSubject("WRONG"), null, {
      id: "d1",
      type: COUNTER_CLAIM,
      claim: disputeClaim(rejection),
    });

    expect(await verifyDispute([dispute], chain, resolver)).toEqual({ ok: false, reason: "not-a-party-chain" });
  });

  it("rejects when the target chain is not a lot chain", async () => {
    const grower = makeKey("grower-key");
    const wholesaler = makeKey("wholesaler-key");
    const resolver = resolverFor(grower, wholesaler);

    const { rejection } = await lotChainWithRejection(grower, wholesaler);
    // A party-scheme "target" is not a lot chain.
    const notALot = await link(grower, partySubject("x"), null, { id: "n1", type: "note", claim: {} });
    const dispute = await link(grower, growerParty, null, {
      id: "d1",
      type: COUNTER_CLAIM,
      claim: disputeClaim(rejection),
    });

    expect(await verifyDispute([dispute], [notALot], resolver)).toEqual({ ok: false, reason: "not-a-lot-chain" });
  });

  it("rejects a party chain carrying no disputes reference", async () => {
    const grower = makeKey("grower-key");
    const wholesaler = makeKey("wholesaler-key");
    const resolver = resolverFor(grower, wholesaler);

    const { chain } = await lotChainWithRejection(grower, wholesaler);
    const note = await link(grower, growerParty, null, { id: "d1", type: "note", claim: { note: "hello" } });

    expect(await verifyDispute([note], chain, resolver)).toEqual({ ok: false, reason: "no-dispute" });
  });
});

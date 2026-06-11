// __tests__/verify-derivation.test.ts
import { describe, it, expect } from "vitest";
import { buildAttestation } from "../build-attestation.js";
import { signAttestation } from "../sign-attestation.js";
import { verifyDerivation } from "../verify-derivation.js";
import { attestationRef, TRANSFORMATION } from "../derivation.js";
import type { Attestation, AttestationInput, Subject } from "../types/attestation.js";
import { makeKey, resolverFor, signerFor, type TestKey } from "./_helpers.js";

const T = "2026-06-11T00:00:00.000Z";

async function link(
  key: TestKey,
  subject: Subject,
  prev: Attestation | null,
  partial: Pick<AttestationInput, "id" | "type" | "claim">,
): Promise<Attestation> {
  const input: AttestationInput = {
    ...partial,
    subject,
    issuer: { scheme: "agro.producer", id: "szulc", keyId: key.keyId },
    occurredAt: T,
    recordedAt: T,
    prevHash: prev ? prev.payloadHash : null,
  };
  return signAttestation(buildAttestation(input), signerFor(key), T);
}

const rawA: Subject = { scheme: "agro.batch", id: "raw-blueberry-101" };
const rawB: Subject = { scheme: "agro.batch", id: "raw-blueberry-102" };
const fg: Subject = { scheme: "agro.batch", id: "fg-blueberry-250g" };

/** Canonical scenario: two raw batches → one finished-good batch.
 *  Output genesis is created FIRST (pins the consumed input states);
 *  consumption records are appended to the input chains AFTER (pin the genesis). */
async function scenario(key: TestKey) {
  const a1 = await link(key, rawA, null, {
    id: "a1",
    type: "delivery_received",
    claim: { species: "blueberry" },
  });
  const b1 = await link(key, rawB, null, {
    id: "b1",
    type: "delivery_received",
    claim: { species: "blueberry" },
  });

  const genesis = await link(key, fg, null, {
    id: "g1",
    type: "transformation",
    claim: { product: "Borówka 250g", derivedFrom: [attestationRef(a1), attestationRef(b1)] },
  });

  const a2 = await link(key, rawA, a1, {
    id: "a2",
    type: TRANSFORMATION,
    claim: { consumedIn: attestationRef(genesis) },
  });
  const b2 = await link(key, rawB, b1, {
    id: "b2",
    type: TRANSFORMATION,
    claim: { consumedIn: attestationRef(genesis) },
  });

  return { genesis, a1, a2, b1, b2, output: [genesis], inputA: [a1, a2], inputB: [b1, b2] };
}

describe("verifyDerivation", () => {
  it("accepts a faithful two-input transformation", async () => {
    const key = makeKey("producer-1");
    const s = await scenario(key);
    const res = await verifyDerivation(s.output, [s.inputA, s.inputB], resolverFor(key));
    expect(res).toEqual({ ok: true });
  });

  it("accepts one raw batch feeding two different outputs (DAG fan-out)", async () => {
    const key = makeKey("producer-1");
    const a1 = await link(key, rawA, null, {
      id: "a1",
      type: "delivery_received",
      claim: { species: "blueberry" },
    });
    const fg2: Subject = { scheme: "agro.batch", id: "fg-blueberry-500g" };

    const g1 = await link(key, fg, null, {
      id: "g1",
      type: "transformation",
      claim: { derivedFrom: [attestationRef(a1)] },
    });
    const a2 = await link(key, rawA, a1, {
      id: "a2",
      type: TRANSFORMATION,
      claim: { consumedIn: attestationRef(g1) },
    });
    const g2 = await link(key, fg2, null, {
      id: "g2",
      type: "transformation",
      claim: { derivedFrom: [attestationRef(a2)] },
    });
    const a3 = await link(key, rawA, a2, {
      id: "a3",
      type: TRANSFORMATION,
      claim: { consumedIn: attestationRef(g2) },
    });

    const chainA = [a1, a2, a3];
    expect(await verifyDerivation([g1], [chainA], resolverFor(key))).toEqual({ ok: true });
    expect(await verifyDerivation([g2], [chainA], resolverFor(key))).toEqual({ ok: true });
  });

  it("rejects an empty or tampered output chain (output-chain-invalid)", async () => {
    const key = makeKey("producer-1");
    const s = await scenario(key);
    expect(await verifyDerivation([], [s.inputA, s.inputB], resolverFor(key))).toEqual({
      ok: false,
      reason: "output-chain-invalid",
    });
    const tampered = { ...s.genesis, claim: { product: "Malina 250g", derivedFrom: [] } };
    const res = await verifyDerivation([tampered], [s.inputA, s.inputB], resolverFor(key));
    expect(res).toEqual({ ok: false, reason: "output-chain-invalid" });
  });

  it("rejects a genesis without derivedFrom (missing-derivation)", async () => {
    const key = makeKey("producer-1");
    const plain = await link(key, fg, null, {
      id: "g1",
      type: "mint",
      claim: { product: "Borówka 250g" },
    });
    expect(await verifyDerivation([plain], [], resolverFor(key))).toEqual({
      ok: false,
      reason: "missing-derivation",
    });
  });

  it("rejects missing or extra input chains (input-chain-mismatch)", async () => {
    const key = makeKey("producer-1");
    const s = await scenario(key);
    const missing = await verifyDerivation(s.output, [s.inputA], resolverFor(key));
    expect(missing).toEqual({ ok: false, reason: "input-chain-mismatch" });
  });

  it("rejects a tampered input chain (input-chain-invalid, names the input)", async () => {
    const key = makeKey("producer-1");
    const s = await scenario(key);
    const tamperedA1 = { ...s.a1, claim: { species: "raspberry" } };
    const res = await verifyDerivation(s.output, [[tamperedA1, s.a2], s.inputB], resolverFor(key));
    expect(res).toEqual({
      ok: false,
      reason: "input-chain-invalid",
      inputSubjectId: rawA.id,
    });
  });

  it("rejects a ref that does not pin a real input state (reference-mismatch)", async () => {
    const key = makeKey("producer-1");
    const s = await scenario(key);
    // A parallel-universe raw-A chain: same subject and ids, different content
    // → valid chain, but the genesis ref pins the ORIGINAL a1's payloadHash.
    const altA1 = await link(key, rawA, null, {
      id: "a1",
      type: "delivery_received",
      claim: { species: "blueberry", lot: "other" },
    });
    const altA2 = await link(key, rawA, altA1, {
      id: "a2",
      type: TRANSFORMATION,
      claim: { consumedIn: attestationRef(s.genesis) },
    });
    const res = await verifyDerivation(s.output, [[altA1, altA2], s.inputB], resolverFor(key));
    expect(res).toEqual({
      ok: false,
      reason: "reference-mismatch",
      inputSubjectId: rawA.id,
    });
  });

  it("rejects an input chain that never records the consumption (consumption-missing)", async () => {
    const key = makeKey("producer-1");
    const s = await scenario(key);
    const res = await verifyDerivation(s.output, [[s.a1], s.inputB], resolverFor(key));
    expect(res).toEqual({
      ok: false,
      reason: "consumption-missing",
      inputSubjectId: rawA.id,
    });
  });

  it("rejects a consumption pointing at a different output genesis (consumption-missing)", async () => {
    const key = makeKey("producer-1");
    const s = await scenario(key);
    // Rebuild raw-A's consumption to point at a forged genesis ref.
    const forgedRef = { ...attestationRef(s.genesis), payloadHash: "f".repeat(64) };
    const badA2 = await link(key, rawA, s.a1, {
      id: "a2",
      type: TRANSFORMATION,
      claim: { consumedIn: forgedRef },
    });
    const res = await verifyDerivation(s.output, [[s.a1, badA2], s.inputB], resolverFor(key));
    expect(res).toEqual({
      ok: false,
      reason: "consumption-missing",
      inputSubjectId: rawA.id,
    });
  });
});

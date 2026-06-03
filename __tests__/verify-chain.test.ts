// __tests__/verify-chain.test.ts
import { describe, it, expect } from "vitest";
import { buildAttestation } from "../build-attestation.js";
import { signAttestation } from "../sign-attestation.js";
import { verifyChain } from "../verify-chain.js";
import { CUSTODY_CHANGE } from "../types/attestation.js";
import type { Attestation, AttestationInput, Subject } from "../types/attestation.js";
import { bytesToHex } from "@noble/hashes/utils";
import { makeKey, resolverFor, signerFor, type TestKey } from "./_helpers.js";

const subject: Subject = { scheme: "hifisync.unit", id: "amp-42:hashedserial" };

/** Build+sign a chain link whose prevHash points at the previous link. */
async function link(
  key: TestKey,
  prev: Attestation | null,
  partial: Pick<AttestationInput, "id" | "type" | "claim">,
): Promise<Attestation> {
  const input: AttestationInput = {
    ...partial,
    subject,
    issuer: { scheme: "hifisync.platform", id: "platform", keyId: key.keyId },
    occurredAt: "2026-06-03T00:00:00.000Z",
    recordedAt: "2026-06-03T00:00:00.000Z",
    prevHash: prev ? prev.payloadHash : null,
  };
  return signAttestation(buildAttestation(input), signerFor(key), input.recordedAt);
}

describe("verifyChain", () => {
  it("accepts a faithful mint -> transfer chain", async () => {
    const platform = makeKey("platform-1");
    const mint = await link(platform, null, { id: "a1", type: "mint", claim: { owner: "alice" } });
    const xfer = await link(platform, mint, { id: "a2", type: "transfer", claim: { to: "bob" } });
    expect(await verifyChain([mint, xfer], resolverFor(platform))).toEqual({ ok: true });
  });

  it("pinpoints the exact link when a middle attestation is rewritten (the core promise)", async () => {
    const platform = makeKey("platform-1");
    const a1 = await link(platform, null, { id: "a1", type: "mint", claim: { owner: "alice" } });
    const a2 = await link(platform, a1, { id: "a2", type: "transfer", claim: { to: "bob" } });
    const a3 = await link(platform, a2, { id: "a3", type: "transfer", claim: { to: "carol" } });
    const tampered = { ...a2, claim: { to: "mallory" } }; // rewrite history
    const res = await verifyChain([a1, tampered, a3], resolverFor(platform));
    expect(res).toEqual({ ok: false, brokenIndex: 1, reason: "payload-hash-mismatch" });
  });

  it("reports prev-hash-mismatch when a link is reordered/removed", async () => {
    const platform = makeKey("platform-1");
    const a1 = await link(platform, null, { id: "a1", type: "mint", claim: { owner: "alice" } });
    const a2 = await link(platform, a1, { id: "a2", type: "transfer", claim: { to: "bob" } });
    const orphan = await link(platform, a2, { id: "a3", type: "transfer", claim: { to: "carol" } });
    // [a1, orphan] — orphan.prevHash points at a2 (absent), not a1
    const res = await verifyChain([a1, orphan], resolverFor(platform));
    expect(res).toEqual({ ok: false, brokenIndex: 1, reason: "prev-hash-mismatch" });
  });

  it("reports wrong-signer when a non-controller key signs a link", async () => {
    const platform = makeKey("platform-1");
    const stranger = makeKey("stranger-1");
    const a1 = await link(platform, null, { id: "a1", type: "mint", claim: { owner: "alice" } });
    const a2 = await link(stranger, a1, { id: "a2", type: "transfer", claim: { to: "bob" } });
    const res = await verifyChain([a1, a2], resolverFor(platform, stranger));
    expect(res).toEqual({ ok: false, brokenIndex: 1, reason: "wrong-signer" });
  });

  it("switches the controller at custody_change: new key signs after, old key no longer can", async () => {
    const platform = makeKey("platform-1");
    const device = makeKey("device-1");
    const a1 = await link(platform, null, { id: "a1", type: "mint", claim: { owner: "alice" } });
    // platform (outgoing controller) authorizes the device key as new controller
    const handover = await link(platform, a1, {
      id: "a2",
      type: CUSTODY_CHANGE,
      claim: { newController: { keyId: "device-1", publicKey: bytesToHex(device.pub) } },
    });
    // subsequent link MUST be signed by device, not platform
    const a3 = await link(device, handover, { id: "a3", type: "transfer", claim: { to: "bob" } });
    expect(await verifyChain([a1, handover, a3], resolverFor(platform, device))).toEqual({ ok: true });

    // if platform tries to keep signing after handover -> wrong-signer
    const usurp = await link(platform, handover, { id: "a3b", type: "transfer", claim: { to: "eve" } });
    const res = await verifyChain([a1, handover, usurp], resolverFor(platform, device));
    expect(res).toEqual({ ok: false, brokenIndex: 2, reason: "wrong-signer" });
  });

  // Fix 4: edge-case chain shapes
  it("accepts an empty chain (vacuous validity)", async () => {
    const platform = makeKey("platform-1");
    expect(await verifyChain([], resolverFor(platform))).toEqual({ ok: true });
  });

  it("accepts a single-link (genesis-only) chain", async () => {
    const platform = makeKey("platform-1");
    const genesis = await link(platform, null, { id: "a1", type: "mint", claim: { owner: "alice" } });
    expect(await verifyChain([genesis], resolverFor(platform))).toEqual({ ok: true });
  });

  it("rejects a genesis link whose prevHash is non-null", async () => {
    const platform = makeKey("platform-1");
    // Build a second link so we have a real payloadHash to use as a non-null prevHash.
    // The check at index 0 expects prevHash === null; anything else fires prev-hash-mismatch
    // before the signature is ever verified.
    const fakeGenesis: Attestation = {
      id: "a0",
      subject,
      issuer: { scheme: "hifisync.platform", id: "platform", keyId: platform.keyId },
      type: "mint",
      claim: { owner: "alice" },
      occurredAt: "2026-06-03T00:00:00.000Z",
      recordedAt: "2026-06-03T00:00:00.000Z",
      prevHash: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", // non-null
      payloadHash: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      proof: { type: "ed25519-jcs-2022", keyId: platform.keyId, created: "2026-06-03T00:00:00.000Z", signature: "cccc" },
    };
    const res = await verifyChain([fakeGenesis], resolverFor(platform));
    expect(res).toEqual({ ok: false, brokenIndex: 0, reason: "prev-hash-mismatch" });
  });

  // Fix 1: custody_change robustness
  it("resolves (does not throw) with malformed-custody-claim when claim has no newController", async () => {
    const platform = makeKey("platform-1");
    const a1 = await link(platform, null, { id: "a1", type: "mint", claim: { owner: "alice" } });
    const badHandover = await link(platform, a1, {
      id: "a2",
      type: CUSTODY_CHANGE,
      claim: {}, // missing newController entirely
    });
    const res = await verifyChain([a1, badHandover], resolverFor(platform));
    expect(res).toEqual({ ok: false, brokenIndex: 1, reason: "malformed-custody-claim" });
  });

  it("returns controller-key-mismatch when the claim publicKey does not match the resolved key", async () => {
    const platform = makeKey("platform-1");
    const device = makeKey("device-1");
    const other = makeKey("other-key");
    const a1 = await link(platform, null, { id: "a1", type: "mint", claim: { owner: "alice" } });
    // Claim says device-1 has 'other' pubkey, but resolver maps device-1 → device.pub
    const badHandover = await link(platform, a1, {
      id: "a2",
      type: CUSTODY_CHANGE,
      claim: { newController: { keyId: "device-1", publicKey: bytesToHex(other.pub) } },
    });
    const res = await verifyChain([a1, badHandover], resolverFor(platform, device));
    expect(res).toEqual({ ok: false, brokenIndex: 1, reason: "controller-key-mismatch" });
  });

  it("verifies a fruit-shaped chain with the same engine (domain neutrality)", async () => {
    const grower = makeKey("grower-1");
    const fruitSubject: Subject = { scheme: "gs1.gtin-lot", id: "0614141000012:LOT-7" };
    async function fruitLink(prev: Attestation | null, p: Pick<AttestationInput, "id" | "type" | "claim">) {
      const input: AttestationInput = {
        ...p,
        subject: fruitSubject,
        issuer: { scheme: "gs1.party", id: "farm-7", keyId: grower.keyId },
        occurredAt: "2026-06-03T00:00:00.000Z",
        recordedAt: "2026-06-03T00:00:00.000Z",
        prevHash: prev ? prev.payloadHash : null,
      };
      return signAttestation(buildAttestation(input), signerFor(grower), input.recordedAt);
    }
    const harvest = await fruitLink(null, { id: "f1", type: "harvest", claim: { kg: 120 } });
    const pack = await fruitLink(harvest, { id: "f2", type: "pack", claim: { cartons: 10 } });
    expect(await verifyChain([harvest, pack], resolverFor(grower))).toEqual({ ok: true });
  });
});

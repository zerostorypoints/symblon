import { describe, it, expect } from "vitest";
import { bytesToHex } from "@noble/hashes/utils";
import { buildAttestation } from "../build-attestation.js";
import { signAttestation } from "../sign-attestation.js";
import { commitField } from "../commitments.js";
import { buildPresentation, verifyPresentation } from "../presentation.js";
import { CUSTODY_CHANGE } from "../types/attestation.js";
import type { Attestation, AttestationInput, Subject } from "../types/attestation.js";
import { makeKey, resolverFor, signerFor, type TestKey } from "./_helpers.js";

const subject: Subject = { scheme: "hifisync.unit", id: "amp-42:hashed" };
const SALT = "salt-abc";
const SERIAL = "SN-12345";

async function link(
  key: TestKey,
  prev: Attestation | null,
  partial: Pick<AttestationInput, "id" | "type" | "claim"> & { commitments?: Record<string, string> },
): Promise<Attestation> {
  const input: AttestationInput = {
    id: partial.id,
    type: partial.type,
    claim: partial.claim,
    subject,
    issuer: { scheme: "hifisync.platform", id: "platform", keyId: key.keyId },
    occurredAt: "2026-06-03T00:00:00.000Z",
    recordedAt: "2026-06-03T00:00:00.000Z",
    prevHash: prev ? prev.payloadHash : null,
    ...(partial.commitments ? { commitments: partial.commitments } : {}),
  };
  return signAttestation(buildAttestation(input), signerFor(key), input.recordedAt);
}

async function mintWithSerial(owner: TestKey): Promise<Attestation> {
  return link(owner, null, {
    id: "a1",
    type: "mint",
    claim: { owner: "alice" },
    commitments: { serial: commitField(SERIAL, SALT) },
  });
}

const FUTURE = "2026-06-04T00:00:00.000Z";
const PAST = "2026-06-02T00:00:00.000Z";
const NOW = "2026-06-03T12:00:00.000Z";

describe("verifyPresentation", () => {
  it("accepts a fresh presentation by the current owner disclosing a committed field", async () => {
    const owner = makeKey("owner-1");
    const mint = await mintWithSerial(owner);
    const pres = await buildPresentation(
      { subject, nonce: "n1", expiresAt: FUTURE, disclosed: [{ name: "serial", value: SERIAL, salt: SALT }] },
      signerFor(owner),
      NOW,
    );
    expect(await verifyPresentation(pres, [mint], resolverFor(owner), NOW)).toEqual({ ok: true });
  });

  it("rejects an expired presentation", async () => {
    const owner = makeKey("owner-1");
    const mint = await mintWithSerial(owner);
    const pres = await buildPresentation(
      { subject, nonce: "n1", expiresAt: PAST, disclosed: [] },
      signerFor(owner),
      PAST,
    );
    expect(await verifyPresentation(pres, [mint], resolverFor(owner), NOW)).toEqual({ ok: false, reason: "expired" });
  });

  it("rejects a subject mismatch", async () => {
    const owner = makeKey("owner-1");
    const mint = await mintWithSerial(owner);
    const pres = await buildPresentation(
      { subject: { scheme: "hifisync.unit", id: "other:thing" }, nonce: "n1", expiresAt: FUTURE, disclosed: [] },
      signerFor(owner),
      NOW,
    );
    expect(await verifyPresentation(pres, [mint], resolverFor(owner), NOW)).toEqual({ ok: false, reason: "subject-mismatch" });
  });

  it("rejects a presentation by a non-current controller (a past owner after custody_change)", async () => {
    const owner = makeKey("owner-1");
    const buyer = makeKey("buyer-1");
    const mint = await mintWithSerial(owner);
    const handover = await link(owner, mint, {
      id: "a2",
      type: CUSTODY_CHANGE,
      claim: { newController: { keyId: "buyer-1", publicKey: bytesToHex(buyer.pub) } },
    });
    const chain = [mint, handover];
    const resolve = resolverFor(owner, buyer);

    const stale = await buildPresentation(
      { subject, nonce: "n1", expiresAt: FUTURE, disclosed: [] },
      signerFor(owner),
      NOW,
    );
    expect(await verifyPresentation(stale, chain, resolve, NOW)).toEqual({ ok: false, reason: "not-current-controller" });

    const fresh = await buildPresentation(
      { subject, nonce: "n2", expiresAt: FUTURE, disclosed: [{ name: "serial", value: SERIAL, salt: SALT }] },
      signerFor(buyer),
      NOW,
    );
    expect(await verifyPresentation(fresh, chain, resolve, NOW)).toEqual({ ok: true });
  });

  it("rejects a tampered disclosed value (opening-mismatch)", async () => {
    const owner = makeKey("owner-1");
    const mint = await mintWithSerial(owner);
    const pres = await buildPresentation(
      { subject, nonce: "n1", expiresAt: FUTURE, disclosed: [{ name: "serial", value: "SN-EVIL", salt: SALT }] },
      signerFor(owner),
      NOW,
    );
    expect(await verifyPresentation(pres, [mint], resolverFor(owner), NOW)).toEqual({ ok: false, reason: "opening-mismatch" });
  });

  it("rejects disclosure of a field with no commitment (unknown-field)", async () => {
    const owner = makeKey("owner-1");
    const mint = await mintWithSerial(owner);
    const pres = await buildPresentation(
      { subject, nonce: "n1", expiresAt: FUTURE, disclosed: [{ name: "price", value: 999, salt: "p" }] },
      signerFor(owner),
      NOW,
    );
    expect(await verifyPresentation(pres, [mint], resolverFor(owner), NOW)).toEqual({ ok: false, reason: "unknown-field" });
  });

  it("rejects a forged signature (bad-signature)", async () => {
    const owner = makeKey("owner-1");
    const mint = await mintWithSerial(owner);
    const pres = await buildPresentation(
      { subject, nonce: "n1", expiresAt: FUTURE, disclosed: [] },
      signerFor(owner),
      NOW,
    );
    const forged = { ...pres, proof: { ...pres.proof, signature: "00".repeat(64) } };
    expect(await verifyPresentation(forged, [mint], resolverFor(owner), NOW)).toEqual({ ok: false, reason: "bad-signature" });
  });
});

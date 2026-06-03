import { describe, it, expect } from "vitest";
import { bytesToHex } from "@noble/hashes/utils";
import { buildAttestation } from "../build-attestation.js";
import { signAttestation } from "../sign-attestation.js";
import { commitField } from "../commitments.js";
import { currentController, currentCommitments } from "../chain-state.js";
import { CUSTODY_CHANGE } from "../types/attestation.js";
import type { Attestation, AttestationInput, Subject } from "../types/attestation.js";
import { makeKey, signerFor, type TestKey } from "./_helpers.js";

const subject: Subject = { scheme: "hifisync.unit", id: "amp-42:hashed" };

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

describe("currentController", () => {
  it("is null for an empty chain", () => {
    expect(currentController([])).toBeNull();
  });

  it("is the genesis signer for a single-link chain", async () => {
    const platform = makeKey("platform-1");
    const g = await link(platform, null, { id: "a1", type: "mint", claim: {} });
    expect(currentController([g])).toBe("platform-1");
  });

  it("switches to the new controller after a custody_change", async () => {
    const platform = makeKey("platform-1");
    const device = makeKey("device-1");
    const g = await link(platform, null, { id: "a1", type: "mint", claim: {} });
    const handover = await link(platform, g, {
      id: "a2",
      type: CUSTODY_CHANGE,
      claim: { newController: { keyId: "device-1", publicKey: bytesToHex(device.pub) } },
    });
    expect(currentController([g, handover])).toBe("device-1");
  });
});

describe("currentCommitments", () => {
  it("folds commitments across links, later overriding earlier", async () => {
    const platform = makeKey("platform-1");
    const g = await link(platform, null, {
      id: "a1",
      type: "mint",
      claim: {},
      commitments: { serial: commitField("SN-1", "s"), price: commitField(100, "p") },
    });
    const update = await link(platform, g, {
      id: "a2",
      type: "service",
      claim: {},
      commitments: { price: commitField(120, "p2") },
    });
    const merged = currentCommitments([g, update]);
    expect(merged["serial"]).toBe(commitField("SN-1", "s"));
    expect(merged["price"]).toBe(commitField(120, "p2"));
  });

  it("is an empty object when no link carries commitments", async () => {
    const platform = makeKey("platform-1");
    const g = await link(platform, null, { id: "a1", type: "mint", claim: {} });
    expect(currentCommitments([g])).toEqual({});
  });
});

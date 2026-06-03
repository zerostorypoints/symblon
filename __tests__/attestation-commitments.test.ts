import { describe, it, expect } from "vitest";
import { buildAttestation, computePayloadHash } from "../build-attestation.js";
import { signAttestation } from "../sign-attestation.js";
import { verifyAttestation } from "../verify-attestation.js";
import { commitField } from "../commitments.js";
import type { AttestationInput } from "../types/attestation.js";
import { makeKey, resolverFor, signerFor } from "./_helpers.js";

const base = (commitments?: Record<string, string>): AttestationInput => ({
  id: "a1",
  subject: { scheme: "hifisync.unit", id: "amp-42:hashed" },
  issuer: { scheme: "hifisync.platform", id: "platform", keyId: "k1" },
  type: "mint",
  claim: { owner: "alice" },
  occurredAt: "2026-06-03T00:00:00.000Z",
  recordedAt: "2026-06-03T00:00:00.000Z",
  prevHash: null,
  ...(commitments ? { commitments } : {}),
});

describe("attestation commitments", () => {
  it("a commitment-less attestation still hashes to 64-hex; adding commitments changes the hash", () => {
    const withoutCommit = computePayloadHash(base());
    expect(withoutCommit).toMatch(/^[0-9a-f]{64}$/);
    const withCommit = computePayloadHash(base({ serial: commitField("SN-1", "s") }));
    expect(withCommit).not.toBe(withoutCommit);
  });

  it("commitments are covered by payloadHash (tamper-evident)", async () => {
    const k = makeKey("k1");
    const input = base({ serial: commitField("SN-1", "s") });
    const signed = await signAttestation(buildAttestation(input), signerFor(k), input.recordedAt);
    expect(await verifyAttestation(signed, resolverFor(k))).toEqual({ ok: true });

    const tampered = { ...signed, commitments: { serial: commitField("SN-EVIL", "s") } };
    expect(await verifyAttestation(tampered, resolverFor(k))).toEqual({
      ok: false,
      reason: "payload-hash-mismatch",
    });
  });
});

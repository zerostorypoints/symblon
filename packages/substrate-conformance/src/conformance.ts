// conformance.ts
import { describe, it, expect, beforeEach } from "vitest";
import { bytesToHex } from "@noble/hashes/utils";
import {
  verifyChain,
  HeadConflictError,
  CUSTODY_CHANGE,
  type Subject,
} from "@symblon/core";
import { buildLink } from "./builder.js";
import { makeEd25519Key, type MakeKeys } from "./keys.js";
import type { KeyedSubstrate } from "./types.js";

/**
 * Run the shared IntegritySubstrate conformance suite against an adapter.
 *
 * @param makeSubstrate fresh, ISOLATED substrate per test (new state / truncated
 *        tables). Called in `beforeEach`.
 * @param makeKeys      signing-key factory (defaults to Ed25519).
 */
export function runSubstrateConformance(
  makeSubstrate: () => Promise<KeyedSubstrate>,
  makeKeys: MakeKeys = makeEd25519Key,
): void {
  describe("IntegritySubstrate conformance", () => {
    let s: KeyedSubstrate;
    beforeEach(async () => {
      s = await makeSubstrate();
    });

    it("1. append → readChain round-trips in genesis→head order", async () => {
      const subject: Subject = { scheme: "conf.unit", id: "rt" };
      const key = makeKeys("k1");
      await s.registerKey(key.keyId, key.publicKey);
      const a0 = await buildLink(key, subject, null, { id: "a0", type: "mint", claim: { n: 0 } });
      await s.append(a0);
      const a1 = await buildLink(key, subject, a0, { id: "a1", type: "note", claim: { n: 1 } });
      await s.append(a1);
      const a2 = await buildLink(key, subject, a1, { id: "a2", type: "note", claim: { n: 2 } });
      await s.append(a2);

      const chain = await s.readChain(subject);
      expect(chain.map((a) => a.id)).toEqual(["a0", "a1", "a2"]);
      expect(chain.map((a) => a.payloadHash)).toEqual([
        a0.payloadHash,
        a1.payloadHash,
        a2.payloadHash,
      ]);
    });

    it("2. head returns the latest payloadHash, null before genesis", async () => {
      const subject: Subject = { scheme: "conf.unit", id: "head" };
      const key = makeKeys("k1");
      await s.registerKey(key.keyId, key.publicKey);
      expect(await s.head(subject)).toBeNull();
      const a0 = await buildLink(key, subject, null, { id: "a0", type: "mint", claim: {} });
      await s.append(a0);
      expect(await s.head(subject)).toBe(a0.payloadHash);
      const a1 = await buildLink(key, subject, a0, { id: "a1", type: "note", claim: {} });
      await s.append(a1);
      expect(await s.head(subject)).toBe(a1.payloadHash);
    });

    it("3. genesis accepted once; a second genesis rejected", async () => {
      const subject: Subject = { scheme: "conf.unit", id: "gen" };
      const key = makeKeys("k1");
      await s.registerKey(key.keyId, key.publicKey);
      const a0 = await buildLink(key, subject, null, { id: "a0", type: "mint", claim: {} });
      await s.append(a0);
      const dup = await buildLink(key, subject, null, { id: "a0b", type: "mint", claim: { other: true } });
      await expect(s.append(dup)).rejects.toBeInstanceOf(HeadConflictError);
      expect((await s.readChain(subject)).map((a) => a.id)).toEqual(["a0"]);
    });

    it("4. append with a stale prevHash → HeadConflictError", async () => {
      const subject: Subject = { scheme: "conf.unit", id: "stale" };
      const key = makeKeys("k1");
      await s.registerKey(key.keyId, key.publicKey);
      const a0 = await buildLink(key, subject, null, { id: "a0", type: "mint", claim: {} });
      await s.append(a0);
      const a1 = await buildLink(key, subject, a0, { id: "a1", type: "note", claim: {} });
      await s.append(a1);
      // built off a0, but the head is now a1
      const stale = await buildLink(key, subject, a0, { id: "a1x", type: "note", claim: { stale: true } });
      await expect(s.append(stale)).rejects.toBeInstanceOf(HeadConflictError);
    });

    it("5. concurrency: exactly one of N parallel appends off the same head wins", async () => {
      const subject: Subject = { scheme: "conf.unit", id: "race" };
      const key = makeKeys("k1");
      await s.registerKey(key.keyId, key.publicKey);
      const genesis = await buildLink(key, subject, null, { id: "g", type: "mint", claim: {} });
      await s.append(genesis);

      const N = 8;
      const candidates = await Promise.all(
        Array.from({ length: N }, (_, i) =>
          buildLink(key, subject, genesis, { id: `c${i}`, type: "note", claim: { i } }),
        ),
      );
      const results = await Promise.allSettled(candidates.map((c) => s.append(c)));
      const won = results.filter((r) => r.status === "fulfilled");
      const conflicts = results.filter(
        (r) => r.status === "rejected" && r.reason instanceof HeadConflictError,
      );
      expect(won).toHaveLength(1);
      expect(conflicts).toHaveLength(N - 1);
      expect(await s.readChain(subject)).toHaveLength(2);
    });

    it("6. multi-subject isolation: chains keyed by {scheme,id} don't bleed", async () => {
      const key = makeKeys("k1");
      await s.registerKey(key.keyId, key.publicKey);
      const subjA: Subject = { scheme: "conf.unit", id: "A" };
      const subjB: Subject = { scheme: "conf.unit", id: "B" };
      const subjC: Subject = { scheme: "conf.other", id: "A" }; // same id, different scheme

      await s.append(await buildLink(key, subjA, null, { id: "a0", type: "mint", claim: {} }));
      await s.append(await buildLink(key, subjB, null, { id: "b0", type: "mint", claim: {} }));
      const c0 = await buildLink(key, subjC, null, { id: "c0", type: "mint", claim: {} });
      await s.append(c0);

      expect((await s.readChain(subjA)).map((a) => a.id)).toEqual(["a0"]);
      expect((await s.readChain(subjB)).map((a) => a.id)).toEqual(["b0"]);
      expect((await s.readChain(subjC)).map((a) => a.id)).toEqual(["c0"]);
      expect(await s.head(subjC)).toBe(c0.payloadHash);
    });

    it("7. full lifecycle verifies clean; tamper breaks at the right index", async () => {
      const subject: Subject = { scheme: "conf.unit", id: "lifecycle" };
      const issuer = makeKeys("issuer:v1");
      const owner = makeKeys("device:owner");
      await s.registerKey(issuer.keyId, issuer.publicKey);
      await s.registerKey(owner.keyId, owner.publicKey);

      const mint = await buildLink(issuer, subject, null, {
        id: "m",
        type: "mint",
        claim: { owner: "alice" },
      });
      await s.append(mint);
      const handover = await buildLink(issuer, subject, mint, {
        id: "h",
        type: CUSTODY_CHANGE,
        claim: { newController: { keyId: owner.keyId, publicKey: bytesToHex(owner.publicKey) } },
      });
      await s.append(handover);
      const transfer = await buildLink(owner, subject, handover, {
        id: "t",
        type: "transfer",
        claim: { to: "bob" },
      });
      await s.append(transfer);

      const chain = await s.readChain(subject);
      expect(await verifyChain(chain, s.resolver)).toEqual({ ok: true });

      // tamper the handover's claim (keep its stored payloadHash) → its own
      // payload-hash recomputation fails at index 1.
      const tampered = chain.map((a) =>
        a.id === "h"
          ? { ...a, claim: { newController: { keyId: "evil", publicKey: "00" } } }
          : a,
      );
      expect(await verifyChain(tampered, s.resolver)).toMatchObject({
        ok: false,
        brokenIndex: 1,
        reason: "payload-hash-mismatch",
      });
    });
  });
}

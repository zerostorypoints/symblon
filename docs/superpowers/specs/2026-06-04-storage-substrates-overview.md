# Storage substrates — overview, contract & roadmap — design

**Status:** Design (decision doc). **No code yet** — entry point for the storage workstream.
**Date:** 2026-06-04
**Author:** Claude + Piotr (brainstorm, symblon-web session)
**Repo:** `zerostorypoints/symblon` (the engine). Companion specs: `2026-06-04-substrate-sql.md`, `2026-06-04-substrate-pear.md`, `2026-06-04-substrate-anchor.md`.

---

## 1. Goal

Ship `IntegritySubstrate` implementations across the **trust spectrum** — centralized DB → P2P → public-ledger anchoring — so a consumer (hifipass, agrocontracts, any DPP) can start custodial and become trust-minimized **with no change to `@symblon/core` or its data model**. The engine already isolates persistence behind one seam; this workstream fills it in.

## 2. The seam today, and why storage ≠ trust

`types/seams.ts` (v0.2.0):

```ts
export type IntegritySubstrate = {
  append(attestation: Attestation): Promise<void>;
  readChain(subject: Subject): Promise<Attestation[]>;
  head(subject: Subject): Promise<string | null>; // head payloadHash, null at genesis
};
```

Tamper-evidence is **intrinsic to the chain** (each record's `prevHash` + Ed25519 `proof`), verified by `verifyChain` — it is *not* a property of the store. Consequence: even a fully centralized DB cannot silently rewrite history undetected, and swapping substrates changes the *trust/availability* profile, not the guarantees. That is the whole reason this is a seam.

## 3. Phase 0 — harden the contract (do first; everything depends on it)

### 3.1 Atomic append (head compare-and-set)
**Problem:** `append(att)` has no concurrency guard. A valid append requires `att.prevHash === head(subject)`; two writers reading the same head could both append and fork the chain. The engine's "only the current controller signs" rule prevents *adversarial* forks, but not *accidental* races (same owner, two tabs/processes).

**Decision (recommended):** keep the signature; tighten the **contract** so `append` MUST be an atomic check-and-append: persist iff `att.prevHash` equals the current head for that subject, else reject with a typed `HeadConflictError { subject, expected: att.prevHash, actual: currentHead }`. Genesis: `att.prevHash === null` is accepted iff the subject has no records yet.
- *Alternative considered:* change the signature to `append(att, expectedHead)`. Rejected — `att.prevHash` already carries the expected head, so a second arg is redundant; keep the seam stable.
- **Engine change:** document the contract on the `IntegritySubstrate` type + export a `HeadConflictError`. No change to pure functions.

### 3.2 Conformance suite (the keystone)
A shared, reusable test module — `@symblon/substrate-conformance` — exporting `runSubstrateConformance(makeSubstrate, makeKeys)`. Every adapter imports and runs it. It asserts, against the real engine:
1. append → `readChain` round-trips in genesis→head order;
2. `head` returns the latest `payloadHash` (and `null` before genesis);
3. genesis (`prevHash:null`) accepted once; a second genesis rejected;
4. append with stale `prevHash` → `HeadConflictError`;
5. **concurrency:** N parallel appends off the same head → exactly **one** succeeds, the rest `HeadConflictError`;
6. multi-subject isolation (chains keyed by `{scheme,id}` don't bleed);
7. a full mint→delegate→transfer→release→tamper sequence read back `verifyChain`-clean (and the tampered variant breaks at the right index).

The current in-memory array (used by symblon-web's demo and `examples/`) becomes the **reference adapter** and the first to pass the suite. Ship this suite + reference adapter in Phase 0.

### 3.3 Verify-on-write (optional, per adapter)
Adapters MAY run `verifyAttestation` + linkage/`wrong-signer` checks before persisting (defense-in-depth, fail-fast on bad writes). Not required by the contract (the engine verifies on read), but recommended for server adapters.

### 3.4 Companion: key registry behind `PublicKeyResolver`
Verification needs `(keyId) → publicKey`. Each adapter pairs with a small key store (a `keys` table in SQL; key-announcement records in Pear). Spec the resolver-backing store alongside each adapter; it is a sibling concern, not part of `IntegritySubstrate`.

## 4. Packaging decision

**Recommendation:** make `zerostorypoints/symblon` an npm-workspaces monorepo:

```
packages/
  core/                 @symblon/core            (move the current root sources here, or keep at root initially)
  substrate-conformance @symblon/substrate-conformance  (shared test kit + in-memory reference)
  substrate-sql/        @symblon/substrate-sql
  substrate-pear/       @symblon/substrate-pear
  anchor/               @symblon/anchor
```

**This revises `NEXT_SESSION.md` §2**, which placed the Supabase substrate inside the **hifisync** consumer. Now that symblon is the neutral core for *both* hifipass and agrocontracts, the SQL adapter should be a **reusable engine-side package**, not consumer-specific. (A consumer can still wrap it with domain projections.)

**Open question:** full restructure (move core into `packages/core`, retag) vs. minimal (keep core flat at root, add only `packages/substrate-*`). Minimal is less disruptive to the existing git-dependency consumers; decide in the Phase-0 plan.

## 5. Trust spectrum & sequencing

| Phase | Package | Trust model | Spec |
|---|---|---|---|
| 0 | conformance + in-memory + contract hardening | — | this doc |
| 1 | `@symblon/substrate-sql` | operator-trusted (custodial) | `2026-06-04-substrate-sql.md` |
| 2 | `@symblon/substrate-pear` | trustless, sovereign (P2P) | `2026-06-04-substrate-pear.md` |
| 3 | `@symblon/anchor` | public notarization (add-on) | `2026-06-04-substrate-anchor.md` |

Build order: **0 → 1** is the minimum to put a real product on real storage; 2 and 3 are independent follow-ons that drop in without touching the engine. 3 composes with 1 or 2.

## 6. Scope / non-goals
- No changes to the engine's pure functions or attestation model. Phase 0's only engine touch is documenting the `append` contract + exporting `HeadConflictError`.
- Raw commitment openings (the `(value, salt)` for committed fields) are **not** stored in the chain; they live in consumer custody and are revealed via `Presentation`. Substrates store the chain (which holds the commitment hashes), not the openings.
- W3C VC / EPCIS export adapters are a separate roadmap item (NEXT_SESSION §3), not storage.

## 7. Open questions (consolidated)
1. `append` head-CAS as a contract requirement vs. a signature change (§3.1) — recommend contract.
2. Monorepo restructure scope (§4).
3. Where the `PublicKeyResolver` store lives per adapter (§3.4).
4. SQL: separate `heads` table vs. derive from max seq (see SQL spec).
5. Pear: does the engine's single-active-writer rule fully remove the need for Autobase conflict resolution? (see Pear spec — the central design risk).
6. Anchor: target ledger (OpenTimestamps/Bitcoin vs EVM) and batching granularity (see anchor spec).

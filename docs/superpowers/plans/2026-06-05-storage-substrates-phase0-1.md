# Storage Substrates — Phase 0 + Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Harden the `IntegritySubstrate.append` contract to an atomic head compare-and-set, ship a shared conformance suite + in-memory reference adapter (`@symblon/substrate-conformance`), then a Postgres/Supabase adapter (`@symblon/substrate-sql`) that passes the same suite against a real Postgres — including the concurrency test (exactly one of N parallel appends wins).

**Architecture:** Minimal npm-workspaces monorepo. `@symblon/core` stays flat at the repo root (so the `github:` git-dependency install path is untouched). New packages live under `packages/*` and resolve core at dev/test time via a vitest alias + tsconfig `paths` (no build of core required). The engine's only change is a new exported `HeadConflictError` class plus JSDoc on the `append` contract — no pure functions touched. The conformance suite is the keystone: written once against the in-memory reference, then run verbatim against the SQL adapter. SQL append uses optimistic concurrency — a `SELECT` head check (fast-fails stale writers) followed by an `INSERT` whose `primary key (subject, seq)` makes two racing inserts collide, mapping the unique violation to `HeadConflictError`.

**Tech Stack:** TypeScript (ES2022, ESM, `moduleResolution: bundler`), vitest, `@noble/curves`/`@noble/hashes` (Ed25519, already core deps), `pg` (Postgres driver, SQL adapter), `@testcontainers/postgresql` (disposable Postgres for local tests; a Postgres service container in CI via `SYMBLON_TEST_DATABASE_URL`).

---

## File Structure

**Engine (repo root) — Phase 0.1:**
- Create `errors.ts` — `HeadConflictError` class (the one thrown, shared error).
- Modify `types/seams.ts` — JSDoc the `append` CAS contract; type-import `HeadConflictError` for `{@link}`.
- Modify `index.ts` — export `HeadConflictError`.
- Create `__tests__/errors.test.ts` — unit-test the error class.

**Packaging — Phase 0.2:**
- Modify root `package.json` — add `"workspaces": ["packages/*"]`.
- Modify root `tsconfig.json` — add `"packages"` to `exclude` (defensive; root typecheck ignores packages).

**`packages/substrate-conformance` — Phase 0.3–0.6:** (`@symblon/substrate-conformance`, private)
- `package.json`, `tsconfig.json`, `vitest.config.ts`
- `src/types.ts` — `KeyedSubstrate` (the adapter shape the suite targets).
- `src/keys.ts` — `ConformanceKey`, `MakeKeys`, `makeEd25519Key`.
- `src/builder.ts` — `buildLink` (build+sign one chain link), `CONFORMANCE_TIME`.
- `src/memory.ts` — `createMemorySubstrate` (in-memory reference adapter).
- `src/conformance.ts` — `runSubstrateConformance` (the 7-part suite).
- `src/index.ts` — public exports.
- `__tests__/memory.conformance.test.ts` — runs the suite against the reference.

**`packages/substrate-sql` — Phase 1:** (`@symblon/substrate-sql`, private)
- `package.json`, `tsconfig.json`, `vitest.config.ts`, `README.md`
- `src/client.ts` — `SqlClient` interface, `fromPg`, `isUniqueViolation`.
- `src/schema.ts` — `SCHEMA_SQL`, `createSchema`.
- `src/substrate.ts` — `createSqlSubstrate` (append CAS, readChain, head, resolver, registerKey).
- `src/index.ts` — public exports.
- `__tests__/sql.conformance.test.ts` — runs the suite against real Postgres.

**CI — Phase 1 end:**
- Modify `.github/workflows/ci.yml` — typecheck/test packages; SQL job against a Postgres service.

---

## A note on the monorepo wiring (read once before starting)

`@symblon/core` lives at the repo root, **not** under `packages/*`, so npm will not auto-link it into the new packages. Each new package resolves core two ways, both pointing at the root TypeScript source so **core never needs to be built for dev/test**:

- **tsc** (`typecheck`): tsconfig `compilerOptions.paths` → `"@symblon/core": ["../../index.ts"]`.
- **vitest** (runtime): `resolve.alias` → `@symblon/core` mapped to the absolute path of `../../index.ts`.

Because vitest resolves the alias to one absolute path, every module in a test run (the adapter under test **and** the conformance suite it imports) shares a single `@symblon/core` module instance — so `HeadConflictError` thrown by an adapter `instanceof`-matches the one the suite checks. This is why the alias must appear in **every** package's vitest config.

`@symblon/substrate-sql` depends on `@symblon/substrate-conformance`; both are under `packages/*`, so that link is a normal workspace link (`"@symblon/substrate-conformance": "*"`). The conformance package's `exports` points at `./src/index.ts` (TypeScript source) so the SQL test loads it without a build step.

These packages are `private` this phase. **Before publishing (future):** declare `@symblon/core` as a `peerDependency`, add a `tsc` build, and point `exports` at the built `dist`. Out of scope here.

---

# PHASE 0 — Contract hardening, conformance suite, in-memory reference

## Task 0.1: Engine — `HeadConflictError` + `append` contract docs

**Files:**
- Create: `errors.ts`
- Create: `__tests__/errors.test.ts`
- Modify: `index.ts`
- Modify: `types/seams.ts`

- [ ] **Step 1: Write the failing test**

Create `__tests__/errors.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { HeadConflictError } from "../index.js";
import type { Subject } from "../index.js";

describe("HeadConflictError", () => {
  const subject: Subject = { scheme: "test.unit", id: "abc" };

  it("is an Error and a HeadConflictError with the right name", () => {
    const e = new HeadConflictError(subject, "aaa", "bbb");
    expect(e).toBeInstanceOf(Error);
    expect(e).toBeInstanceOf(HeadConflictError);
    expect(e.name).toBe("HeadConflictError");
  });

  it("carries subject, expected and actual heads", () => {
    const e = new HeadConflictError(subject, "aaa", "bbb");
    expect(e.subject).toEqual(subject);
    expect(e.expected).toBe("aaa");
    expect(e.actual).toBe("bbb");
  });

  it("renders genesis nulls in the message and keeps null fields", () => {
    const e = new HeadConflictError(subject, null, "bbb");
    expect(e.expected).toBeNull();
    expect(e.message).toContain("null (genesis)");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- __tests__/errors.test.ts`
Expected: FAIL — `HeadConflictError` is not exported from `../index.js`.

- [ ] **Step 3: Create the error class**

Create `errors.ts`:

```ts
// errors.ts
import type { Subject } from "./types/attestation.js";

/**
 * Thrown by `IntegritySubstrate.append` when `att.prevHash` does not equal the
 * subject's current head — an optimistic-concurrency (compare-and-set) failure.
 *
 * - `expected` is the head the attestation chained onto (`att.prevHash`).
 * - `actual` is the subject's true current head at append time
 *   (`null` = genesis / no records yet).
 *
 * This is the engine's one effectful-boundary error: the pure verifiers return
 * result objects (expected branches), but a head race on an append is
 * exceptional, so it throws. Every substrate adapter throws THIS class so
 * callers can reliably `instanceof` it.
 */
export class HeadConflictError extends Error {
  readonly subject: Subject;
  readonly expected: string | null;
  readonly actual: string | null;

  constructor(subject: Subject, expected: string | null, actual: string | null) {
    super(
      `head conflict for ${subject.scheme}:${subject.id} — ` +
        `attestation expected prevHash ${expected ?? "null (genesis)"}, ` +
        `but current head is ${actual ?? "null (genesis)"}`,
    );
    this.name = "HeadConflictError";
    this.subject = subject;
    this.expected = expected;
    this.actual = actual;
    // Keep `instanceof` working even if transpiled below ES2015.
    Object.setPrototypeOf(this, HeadConflictError.prototype);
  }
}
```

- [ ] **Step 4: Export it from the engine**

In `index.ts`, add after the `verifyChain` export line (line 19):

```ts
export { HeadConflictError } from "./errors.js";
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npm test -- __tests__/errors.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 6: Document the `append` CAS contract on the seam**

In `types/seams.ts`, replace the `IntegritySubstrate` type (lines 12–18) with:

```ts
import type { HeadConflictError } from "../errors.js";

/** Append-only persistence. Implementations span the trust axis:
 *  Supabase-chain (operator-trusted) -> Hypercore/Autobase (trustless P2P). */
export type IntegritySubstrate = {
  /**
   * Atomically append one attestation to its subject's chain (compare-and-set
   * on the head). MUST persist `attestation` iff `attestation.prevHash` equals
   * the subject's current head — the `payloadHash` returned by `head(subject)`,
   * or `null` at genesis (accepted iff the subject has no records yet).
   *
   * On mismatch (a stale or racing writer) MUST reject with
   * {@link HeadConflictError} and persist nothing. This is the engine's
   * accidental-fork guard: two writers reading the same head cannot both
   * append. Adversarial forks are already prevented by the "only the current
   * controller signs" rule enforced in `verifyChain`.
   */
  append(attestation: Attestation): Promise<void>;
  /** Read a subject's full chain in genesis→head order. Empty if unknown. */
  readChain(subject: Subject): Promise<Attestation[]>;
  /** The subject's head `payloadHash`, or `null` before genesis. */
  head(subject: Subject): Promise<string | null>;
};
```

Note: the new `import type { HeadConflictError }` goes at the top of `types/seams.ts`, alongside the existing `import type { Attestation, Subject }` line. It is referenced only by the `{@link}` tag; `noUnusedLocals` is not enabled, so this is fine. (If `tsc` ever objects, drop the import and write `HeadConflictError` as plain prose in the JSDoc.)

- [ ] **Step 7: Verify the whole engine still typechecks and all tests pass**

Run: `npm run typecheck && npm test`
Expected: typecheck clean; all existing tests + the 3 new error tests PASS.

- [ ] **Step 8: Commit**

```bash
git add errors.ts index.ts types/seams.ts __tests__/errors.test.ts
git commit -m "feat(core): atomic-append contract + exported HeadConflictError"
```

---

## Task 0.2: Packaging — turn the repo into an npm workspace

**Files:**
- Modify: `package.json` (root)
- Modify: `tsconfig.json` (root)

- [ ] **Step 1: Add the workspaces field**

In root `package.json`, add a top-level `"workspaces"` key immediately after the `"type": "module",` line:

```json
  "type": "module",
  "workspaces": [
    "packages/*"
  ],
```

(Leave everything else — `main`, `exports`, `files`, `scripts`, `dependencies` — exactly as-is. The root remains the publishable `@symblon/core`.)

- [ ] **Step 2: Keep the root typecheck from reaching into packages**

In root `tsconfig.json`, change the `exclude` line (line 23) to add `"packages"`:

```json
  "exclude": ["node_modules", "dist", "packages"]
```

- [ ] **Step 3: Reinstall to register the (currently empty) workspace set**

Run: `npm install`
Expected: completes without error; `package-lock.json` updates with a `workspaces` notion (no members yet). Root `node_modules` unchanged otherwise.

- [ ] **Step 4: Verify the engine is unaffected**

Run: `npm run typecheck && npm test && npm run build`
Expected: all green (same as before). Then `git restore dist` is NOT needed — leave `dist` as git-ignored/committed per current repo convention (do not stage `dist`).

- [ ] **Step 5: Commit**

```bash
git add package.json tsconfig.json package-lock.json
git commit -m "build: enable npm workspaces (packages/*)"
```

---

## Task 0.3: Conformance package scaffold + key/builder helpers

**Files:**
- Create: `packages/substrate-conformance/package.json`
- Create: `packages/substrate-conformance/tsconfig.json`
- Create: `packages/substrate-conformance/vitest.config.ts`
- Create: `packages/substrate-conformance/src/types.ts`
- Create: `packages/substrate-conformance/src/keys.ts`
- Create: `packages/substrate-conformance/src/builder.ts`

- [ ] **Step 1: Create the package manifest**

`packages/substrate-conformance/package.json`:

```json
{
  "name": "@symblon/substrate-conformance",
  "version": "0.0.0",
  "private": true,
  "description": "Shared IntegritySubstrate conformance suite + in-memory reference adapter for @symblon/core.",
  "license": "Apache-2.0",
  "type": "module",
  "exports": {
    ".": "./src/index.ts"
  },
  "scripts": {
    "test": "vitest run",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "@noble/curves": "^1.6.0",
    "@noble/hashes": "^1.5.0"
  }
}
```

- [ ] **Step 2: Create the package tsconfig (resolves core to root source)**

`packages/substrate-conformance/tsconfig.json`:

```json
{
  "extends": "../../tsconfig.json",
  "compilerOptions": {
    "types": ["node", "vitest/globals"],
    "paths": {
      "@symblon/core": ["../../index.ts"]
    }
  },
  "include": ["src/**/*.ts", "__tests__/**/*.ts", "vitest.config.ts"]
}
```

- [ ] **Step 3: Create the package vitest config (alias core to root source)**

`packages/substrate-conformance/vitest.config.ts`:

```ts
import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["__tests__/**/*.test.ts"],
  },
  resolve: {
    alias: {
      "@symblon/core": fileURLToPath(new URL("../../index.ts", import.meta.url)),
    },
  },
});
```

- [ ] **Step 4: Define the adapter shape the suite targets**

`packages/substrate-conformance/src/types.ts`:

```ts
import type { IntegritySubstrate, PublicKeyResolver } from "@symblon/core";

/**
 * The full shape a substrate adapter exposes: the `IntegritySubstrate` seam
 * plus the companion key registry (`PublicKeyResolver` + `registerKey`). The
 * conformance suite is written against this shape; adapters satisfy it
 * structurally (no nominal import required in adapter production code).
 */
export type KeyedSubstrate = IntegritySubstrate & {
  resolver: PublicKeyResolver;
  registerKey(keyId: string, publicKey: Uint8Array): Promise<void>;
};
```

- [ ] **Step 5: Define the key factory**

`packages/substrate-conformance/src/keys.ts`:

```ts
import { ed25519 } from "@noble/curves/ed25519";
import { bytesToHex, utf8ToBytes } from "@noble/hashes/utils";
import type { Signer } from "@symblon/core";

/** A test keypair plus a `Signer` over it. */
export type ConformanceKey = {
  keyId: string;
  publicKey: Uint8Array;
  signer: Signer;
};

/** Factory the suite uses to mint signing keys. Overridable per adapter. */
export type MakeKeys = (keyId: string) => ConformanceKey;

/** Default Ed25519 key factory (matches the engine's curve). */
export const makeEd25519Key: MakeKeys = (keyId) => {
  const priv = ed25519.utils.randomPrivateKey();
  const publicKey = ed25519.getPublicKey(priv);
  const signer: Signer = {
    keyId,
    sign: async (message) => bytesToHex(ed25519.sign(utf8ToBytes(message), priv)),
  };
  return { keyId, publicKey, signer };
};
```

- [ ] **Step 6: Define the chain-link builder**

`packages/substrate-conformance/src/builder.ts`:

```ts
import {
  buildAttestation,
  signAttestation,
  type Attestation,
  type AttestationInput,
  type Subject,
} from "@symblon/core";
import type { ConformanceKey } from "./keys.js";

/** Fixed timestamp — the engine is pure, so all times are passed in. */
export const CONFORMANCE_TIME = "2026-06-05T00:00:00.000Z";

/** Build + sign one chain link off `prev` (`null` = genesis). */
export async function buildLink(
  key: ConformanceKey,
  subject: Subject,
  prev: Attestation | null,
  partial: Pick<AttestationInput, "id" | "type" | "claim"> &
    Partial<Pick<AttestationInput, "assurance" | "commitments">>,
): Promise<Attestation> {
  const input: AttestationInput = {
    ...partial,
    subject,
    issuer: { scheme: "conformance.issuer", id: "issuer", keyId: key.keyId },
    occurredAt: CONFORMANCE_TIME,
    recordedAt: CONFORMANCE_TIME,
    prevHash: prev ? prev.payloadHash : null,
  };
  return signAttestation(buildAttestation(input), key.signer, CONFORMANCE_TIME);
}
```

- [ ] **Step 7: Register the workspace and typecheck the helpers**

Run: `npm install`
Expected: npm now lists `@symblon/substrate-conformance` as a workspace; symlinks it under root `node_modules/@symblon/`.

Run: `npm run typecheck -w @symblon/substrate-conformance`
Expected: clean (no test files yet beyond helpers; `src/index.ts` does not exist so don't reference it yet — typecheck covers `types.ts`, `keys.ts`, `builder.ts`).

- [ ] **Step 8: Commit**

```bash
git add packages/substrate-conformance package-lock.json
git commit -m "feat(conformance): scaffold package + key/builder helpers"
```

---

## Task 0.4: Write the conformance suite (RED — no adapter yet)

**Files:**
- Create: `packages/substrate-conformance/src/conformance.ts`
- Create: `packages/substrate-conformance/__tests__/memory.conformance.test.ts`

- [ ] **Step 1: Write the suite**

`packages/substrate-conformance/src/conformance.ts`:

```ts
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
```

- [ ] **Step 2: Wire the suite to the (not-yet-existing) in-memory reference**

`packages/substrate-conformance/__tests__/memory.conformance.test.ts`:

```ts
import { runSubstrateConformance } from "../src/conformance.js";
import { createMemorySubstrate } from "../src/memory.js";

runSubstrateConformance(async () => createMemorySubstrate());
```

- [ ] **Step 3: Run the suite to verify it fails (RED)**

Run: `npm test -w @symblon/substrate-conformance`
Expected: FAIL — `../src/memory.js` / `createMemorySubstrate` does not exist yet (import/resolution error).

- [ ] **Step 4: Commit the RED suite**

```bash
git add packages/substrate-conformance/src/conformance.ts packages/substrate-conformance/__tests__/memory.conformance.test.ts
git commit -m "test(conformance): the 7-part substrate conformance suite (red)"
```

---

## Task 0.5: In-memory reference adapter (GREEN)

**Files:**
- Create: `packages/substrate-conformance/src/memory.ts`

- [ ] **Step 1: Implement the reference adapter**

`packages/substrate-conformance/src/memory.ts`:

```ts
import { HeadConflictError, type Attestation, type Subject } from "@symblon/core";
import type { KeyedSubstrate } from "./types.js";

/** Compose a collision-free map key from a subject's scheme + id. */
function subjectKey(s: Subject): string {
  return `${s.scheme}\u0000${s.id}`; // NUL separator: scheme/id can't forge a collision
}

/**
 * In-memory reference `IntegritySubstrate` — the canonical implementation the
 * conformance suite is written against. Not for production (no persistence),
 * but the behavioural source of truth every real adapter must match. `append`
 * runs to completion synchronously (no internal await), so N concurrent appends
 * resolve deterministically: the first applied wins, the rest see the advanced
 * head and reject — exactly the contract a real DB enforces via constraints.
 */
export function createMemorySubstrate(): KeyedSubstrate {
  const chains = new Map<string, Attestation[]>();
  const keys = new Map<string, Uint8Array>();

  return {
    async append(attestation) {
      const k = subjectKey(attestation.subject);
      const chain = chains.get(k) ?? [];
      const currentHead = chain.length ? chain[chain.length - 1]!.payloadHash : null;
      if (attestation.prevHash !== currentHead) {
        throw new HeadConflictError(attestation.subject, attestation.prevHash, currentHead);
      }
      chains.set(k, [...chain, attestation]);
    },
    async readChain(subject) {
      return [...(chains.get(subjectKey(subject)) ?? [])];
    },
    async head(subject) {
      const chain = chains.get(subjectKey(subject)) ?? [];
      return chain.length ? chain[chain.length - 1]!.payloadHash : null;
    },
    resolver: async (keyId) => keys.get(keyId) ?? null,
    async registerKey(keyId, publicKey) {
      keys.set(keyId, publicKey);
    },
  };
}
```

- [ ] **Step 2: Run the suite to verify it passes (GREEN)**

Run: `npm test -w @symblon/substrate-conformance`
Expected: PASS — all 7 conformance tests green against the in-memory reference.

- [ ] **Step 3: Typecheck the package**

Run: `npm run typecheck -w @symblon/substrate-conformance`
Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add packages/substrate-conformance/src/memory.ts
git commit -m "feat(conformance): in-memory reference adapter passes the suite"
```

---

## Task 0.6: Conformance package public exports

**Files:**
- Create: `packages/substrate-conformance/src/index.ts`

- [ ] **Step 1: Write the barrel**

`packages/substrate-conformance/src/index.ts`:

```ts
export { runSubstrateConformance } from "./conformance.js";
export { createMemorySubstrate } from "./memory.js";
export { makeEd25519Key, type ConformanceKey, type MakeKeys } from "./keys.js";
export { buildLink, CONFORMANCE_TIME } from "./builder.js";
export type { KeyedSubstrate } from "./types.js";
```

- [ ] **Step 2: Verify the package entry typechecks and tests still pass**

Run: `npm run typecheck -w @symblon/substrate-conformance && npm test -w @symblon/substrate-conformance`
Expected: both green.

- [ ] **Step 3: Commit**

```bash
git add packages/substrate-conformance/src/index.ts
git commit -m "feat(conformance): public package exports"
```

**Phase 0 is complete:** the engine enforces an atomic-append contract with a shared `HeadConflictError`, and a reusable conformance suite passes against the in-memory reference.

---

# PHASE 1 — `@symblon/substrate-sql` (Postgres/Supabase)

## Task 1.1: SQL package scaffold

**Files:**
- Create: `packages/substrate-sql/package.json`
- Create: `packages/substrate-sql/tsconfig.json`
- Create: `packages/substrate-sql/vitest.config.ts`

- [ ] **Step 1: Create the package manifest**

`packages/substrate-sql/package.json`:

```json
{
  "name": "@symblon/substrate-sql",
  "version": "0.0.0",
  "private": true,
  "description": "Postgres/Supabase IntegritySubstrate adapter for @symblon/core (custodial, optimistic head-CAS).",
  "license": "Apache-2.0",
  "type": "module",
  "exports": {
    ".": "./src/index.ts"
  },
  "scripts": {
    "test": "vitest run",
    "typecheck": "tsc --noEmit"
  },
  "peerDependencies": {
    "pg": ">=8"
  },
  "peerDependenciesMeta": {
    "pg": { "optional": true }
  },
  "devDependencies": {
    "@symblon/substrate-conformance": "*",
    "@testcontainers/postgresql": "^10.13.0",
    "@types/pg": "^8.11.0",
    "pg": "^8.13.0"
  }
}
```

`pg` is an optional peer because the adapter core is driver-agnostic (it takes a `SqlClient`); only the `fromPg` helper needs `pg`.

- [ ] **Step 2: Create the package tsconfig**

`packages/substrate-sql/tsconfig.json`:

```json
{
  "extends": "../../tsconfig.json",
  "compilerOptions": {
    "types": ["node", "vitest/globals"],
    "paths": {
      "@symblon/core": ["../../index.ts"]
    }
  },
  "include": ["src/**/*.ts", "__tests__/**/*.ts", "vitest.config.ts"]
}
```

- [ ] **Step 3: Create the package vitest config**

`packages/substrate-sql/vitest.config.ts`:

```ts
import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["__tests__/**/*.test.ts"],
    testTimeout: 60_000, // Testcontainers / DB round-trips
    hookTimeout: 120_000, // pulling the Postgres image on first run
  },
  resolve: {
    alias: {
      "@symblon/core": fileURLToPath(new URL("../../index.ts", import.meta.url)),
    },
  },
});
```

- [ ] **Step 4: Install workspace deps**

Run: `npm install`
Expected: installs `pg`, `@types/pg`, `@testcontainers/postgresql`; links `@symblon/substrate-conformance` into `packages/substrate-sql`'s resolution. Completes without error.

- [ ] **Step 5: Commit**

```bash
git add packages/substrate-sql/package.json packages/substrate-sql/tsconfig.json packages/substrate-sql/vitest.config.ts package-lock.json
git commit -m "feat(substrate-sql): scaffold package"
```

---

## Task 1.2: SQL client interface, schema, and primitives

**Files:**
- Create: `packages/substrate-sql/src/client.ts`
- Create: `packages/substrate-sql/src/schema.ts`

- [ ] **Step 1: Define the driver-agnostic client + error mapping**

`packages/substrate-sql/src/client.ts`:

```ts
/** Minimal, driver-agnostic SQL client. Parameters use `$1, $2, …` placeholders. */
export type SqlClient = {
  query<Row = Record<string, unknown>>(
    text: string,
    params?: readonly unknown[],
  ): Promise<Row[]>;
};

/** Postgres SQLSTATE for `unique_violation`. */
const UNIQUE_VIOLATION = "23505";

/** True if `err` is a Postgres unique-constraint violation (driver-independent:
 *  both `pg` and `postgres` surface the SQLSTATE on `err.code`). */
export function isUniqueViolation(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    (err as { code?: unknown }).code === UNIQUE_VIOLATION
  );
}

/** Wrap a `pg` `Pool` (or `Client`) as a `SqlClient`. */
export function fromPg(pg: {
  query: (text: string, params?: readonly unknown[]) => Promise<{ rows: unknown[] }>;
}): SqlClient {
  return {
    async query<Row = Record<string, unknown>>(text: string, params?: readonly unknown[]) {
      const result = await pg.query(text, params);
      return result.rows as Row[];
    },
  };
}
```

- [ ] **Step 2: Define the schema DDL + creator**

`packages/substrate-sql/src/schema.ts`:

```ts
import type { SqlClient } from "./client.js";

/**
 * DDL for the substrate's tables. Idempotent (`if not exists`).
 *
 * - `attestations`: one row per link; a subject's chain is its rows ordered by
 *   `seq`. The `primary key (subject_scheme, subject_id, seq)` enforces ordering
 *   AND optimistic concurrency (two racing inserts at the same seq collide).
 * - `keys`: the `PublicKeyResolver` backing store (ed25519 pubkey bytes).
 */
export const SCHEMA_SQL = `
create table if not exists attestations (
  subject_scheme text not null,
  subject_id     text not null,
  seq            integer not null,
  payload_hash   text not null,
  prev_hash      text,
  attestation    jsonb not null,
  created_at     timestamptz not null default now(),
  primary key (subject_scheme, subject_id, seq),
  unique (subject_scheme, subject_id, payload_hash)
);
create index if not exists attestations_subject_seq_idx
  on attestations (subject_scheme, subject_id, seq);
create table if not exists keys (
  key_id      text primary key,
  public_key  bytea not null,
  created_at  timestamptz not null default now()
);
`;

/** Create the substrate schema if absent. Safe to call repeatedly. */
export async function createSchema(sql: SqlClient): Promise<void> {
  await sql.query(SCHEMA_SQL);
}
```

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck -w @symblon/substrate-sql`
Expected: clean (note: `src/index.ts` and `src/substrate.ts` don't exist yet — that's fine; tsconfig globs only pick up existing files).

- [ ] **Step 4: Commit**

```bash
git add packages/substrate-sql/src/client.ts packages/substrate-sql/src/schema.ts
git commit -m "feat(substrate-sql): SqlClient interface, schema DDL, error mapping"
```

---

## Task 1.3: `createSqlSubstrate` (append CAS, read, head, key registry)

**Files:**
- Create: `packages/substrate-sql/src/substrate.ts`
- Create: `packages/substrate-sql/src/index.ts`

- [ ] **Step 1: Implement the substrate**

`packages/substrate-sql/src/substrate.ts`:

```ts
import {
  HeadConflictError,
  type Attestation,
  type IntegritySubstrate,
  type PublicKeyResolver,
  type Subject,
} from "@symblon/core";
import { isUniqueViolation, type SqlClient } from "./client.js";

type HeadRow = { seq: number; payload_hash: string };
type AttestationRow = { attestation: Attestation };

/** The shape `createSqlSubstrate` returns: the seam + the key registry. */
export type SqlSubstrate = IntegritySubstrate & {
  resolver: PublicKeyResolver;
  registerKey(keyId: string, publicKey: Uint8Array): Promise<void>;
};

async function readHead(sql: SqlClient, subject: Subject): Promise<HeadRow | null> {
  const rows = await sql.query<HeadRow>(
    `select seq, payload_hash from attestations
     where subject_scheme = $1 and subject_id = $2
     order by seq desc limit 1`,
    [subject.scheme, subject.id],
  );
  return rows[0] ?? null;
}

/**
 * Postgres/Supabase `IntegritySubstrate`. Append is an optimistic compare-and-set:
 * read the head, fast-fail a stale/duplicate `prevHash`, then `INSERT` at
 * `seq = head.seq + 1`. Two writers racing off the same head both target the
 * same seq; the `(subject, seq)` primary key lets exactly one commit and maps
 * the loser's unique violation to `HeadConflictError`.
 */
export function createSqlSubstrate(opts: { sql: SqlClient }): SqlSubstrate {
  const { sql } = opts;
  return {
    async append(attestation) {
      const subject = attestation.subject;
      const current = await readHead(sql, subject);
      const currentHead = current ? current.payload_hash : null;
      if (attestation.prevHash !== currentHead) {
        throw new HeadConflictError(subject, attestation.prevHash, currentHead);
      }
      const nextSeq = current ? current.seq + 1 : 0;
      try {
        await sql.query(
          `insert into attestations
             (subject_scheme, subject_id, seq, payload_hash, prev_hash, attestation)
           values ($1, $2, $3, $4, $5, $6::jsonb)`,
          [
            subject.scheme,
            subject.id,
            nextSeq,
            attestation.payloadHash,
            attestation.prevHash,
            JSON.stringify(attestation),
          ],
        );
      } catch (err) {
        if (isUniqueViolation(err)) {
          const now = await readHead(sql, subject);
          throw new HeadConflictError(subject, attestation.prevHash, now ? now.payload_hash : null);
        }
        throw err;
      }
    },

    async readChain(subject) {
      const rows = await sql.query<AttestationRow>(
        `select attestation from attestations
         where subject_scheme = $1 and subject_id = $2
         order by seq asc`,
        [subject.scheme, subject.id],
      );
      return rows.map((r) => r.attestation);
    },

    async head(subject) {
      const current = await readHead(sql, subject);
      return current ? current.payload_hash : null;
    },

    resolver: async (keyId) => {
      const rows = await sql.query<{ public_key: Uint8Array }>(
        `select public_key from keys where key_id = $1`,
        [keyId],
      );
      const row = rows[0];
      return row ? new Uint8Array(row.public_key) : null;
    },

    async registerKey(keyId, publicKey) {
      await sql.query(
        `insert into keys (key_id, public_key) values ($1, $2)
         on conflict (key_id) do nothing`,
        [keyId, Buffer.from(publicKey)],
      );
    },
  };
}
```

Notes for the engineer:
- `pg` parses `jsonb` columns into JS objects automatically, so `r.attestation` is a ready `Attestation`. `JSON.stringify(attestation)` into a `$N::jsonb` param round-trips hash-stably (the engine recomputes `payloadHash` via key-sorted canonicalization on read, so JSON key order is irrelevant; absent optional fields like `assurance` stay absent and hash identically).
- `pg` returns `bytea` as a Node `Buffer`; `new Uint8Array(buffer)` hands the resolver a clean `Uint8Array`. `Buffer.from(publicKey)` encodes the pubkey for storage.

- [ ] **Step 2: Write the package barrel**

`packages/substrate-sql/src/index.ts`:

```ts
export { createSqlSubstrate, type SqlSubstrate } from "./substrate.js";
export { type SqlClient, fromPg, isUniqueViolation } from "./client.js";
export { SCHEMA_SQL, createSchema } from "./schema.js";
```

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck -w @symblon/substrate-sql`
Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add packages/substrate-sql/src/substrate.ts packages/substrate-sql/src/index.ts
git commit -m "feat(substrate-sql): createSqlSubstrate (optimistic head-CAS)"
```

---

## Task 1.4: Run the conformance suite against real Postgres (the keystone)

**Files:**
- Create: `packages/substrate-sql/__tests__/sql.conformance.test.ts`

**Prerequisite check (do this first):** the test needs a real Postgres. Two paths, auto-selected by the test:
- If `SYMBLON_TEST_DATABASE_URL` is set, it uses that database (a local Postgres, or a disposable Supabase branch).
- Otherwise it starts a throwaway Postgres via Testcontainers — **requires Docker running locally**.

Verify one is available before Step 2:
- Docker path: `docker info` should succeed.
- URL path: `echo "$SYMBLON_TEST_DATABASE_URL"` is non-empty and reachable.

If neither is available, provision one (e.g. `docker run -d --rm -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=symblon_test -p 5432:5432 postgres:16` and export `SYMBLON_TEST_DATABASE_URL=postgres://postgres:postgres@localhost:5432/symblon_test`).

- [ ] **Step 1: Write the integration test**

`packages/substrate-sql/__tests__/sql.conformance.test.ts`:

```ts
import { beforeAll, afterAll } from "vitest";
import { Pool } from "pg";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { runSubstrateConformance, type KeyedSubstrate } from "@symblon/substrate-conformance";
import { createSqlSubstrate } from "../src/substrate.js";
import { fromPg, type SqlClient } from "../src/client.js";
import { createSchema } from "../src/schema.js";

let container: StartedPostgreSqlContainer | undefined;
let pool: Pool;
let sql: SqlClient;

beforeAll(async () => {
  const url = process.env.SYMBLON_TEST_DATABASE_URL;
  if (url) {
    pool = new Pool({ connectionString: url, max: 16 });
  } else {
    container = await new PostgreSqlContainer("postgres:16-alpine").start();
    pool = new Pool({ connectionString: container.getConnectionUri(), max: 16 });
  }
  sql = fromPg(pool);
  await createSchema(sql);
});

afterAll(async () => {
  await pool?.end();
  await container?.stop();
});

// `max: 16` connections (> N=8) so the concurrency test races on real,
// separate connections; `truncate` isolates each test.
runSubstrateConformance(async (): Promise<KeyedSubstrate> => {
  await sql.query("truncate attestations, keys");
  return createSqlSubstrate({ sql });
});
```

- [ ] **Step 2: Run the suite against Postgres**

Run: `npm test -w @symblon/substrate-sql`
Expected: PASS — all 7 conformance tests green against real Postgres, including test 5 (exactly one of 8 parallel appends wins, 7 reject with `HeadConflictError`).

If test 5 ever shows >1 winner, the optimistic guard is broken — STOP and debug (likely the `(subject, seq)` PK is missing or the pool has only 1 connection). Do not weaken the test.

- [ ] **Step 3: Typecheck the package including the test**

Run: `npm run typecheck -w @symblon/substrate-sql`
Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add packages/substrate-sql/__tests__/sql.conformance.test.ts
git commit -m "test(substrate-sql): conformance suite passes against real Postgres"
```

---

## Task 1.5: SQL package README + CI wiring

**Files:**
- Create: `packages/substrate-sql/README.md`
- Modify: `.github/workflows/ci.yml`

- [ ] **Step 1: Write the README**

`packages/substrate-sql/README.md`:

````markdown
# @symblon/substrate-sql

Postgres/Supabase [`IntegritySubstrate`](../../types/seams.ts) for
[`@symblon/core`](../../README.md). Custodial, ship-first storage: an operator
holds the attestation chains in Postgres. Operator-trusted for **availability
and access control** — **not** for integrity (the chain self-verifies via
`verifyChain`).

## Usage

```ts
import { Pool } from "pg";
import { createSqlSubstrate, fromPg, createSchema } from "@symblon/substrate-sql";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const sql = fromPg(pool);
await createSchema(sql); // or run the DDL via your migration tool

const store = createSqlSubstrate({ sql });
await store.registerKey(keyId, publicKeyBytes);
await store.append(attestation);           // throws HeadConflictError on a head race
const chain = await store.readChain(subject);
const ok = await verifyChain(chain, store.resolver);
```

## Concurrency

`append` is an optimistic compare-and-set: it reads the head, fast-fails a stale
`prevHash` with `HeadConflictError`, then inserts at `seq = head.seq + 1`. Two
writers racing off the same head both target the same `seq`; the
`primary key (subject_scheme, subject_id, seq)` lets exactly one commit and the
loser's unique violation maps to `HeadConflictError`. No app-level locking.

## Driver-agnostic

The adapter talks to a thin `SqlClient` (`query(text, params) => rows`).
`fromPg` wraps a `pg` `Pool`/`Client`. For **Supabase**, connect `pg` (or any
Postgres driver) to your project's Postgres connection string and wrap it the
same way — the adapter uses raw SQL, not the supabase-js REST client.

## Testing

`__tests__/sql.conformance.test.ts` runs the shared
`@symblon/substrate-conformance` suite against real Postgres. Set
`SYMBLON_TEST_DATABASE_URL` to target a specific database, or leave it unset to
spin up a throwaway Postgres via Testcontainers (needs Docker).
````

- [ ] **Step 2: Update CI to cover the packages**

Replace `.github/workflows/ci.yml` entirely with:

```yaml
name: CI

on:
  push:
    branches: [main]
  pull_request:

jobs:
  engine-and-conformance:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: "24"
          cache: npm
      - run: npm ci
      - run: npm run typecheck
      - run: npm test
      - run: npm run typecheck -w @symblon/substrate-conformance
      - run: npm test -w @symblon/substrate-conformance
      - run: npm run typecheck -w @symblon/substrate-sql
      - run: npm run build

  sql-substrate:
    runs-on: ubuntu-latest
    services:
      postgres:
        image: postgres:16
        env:
          POSTGRES_PASSWORD: postgres
          POSTGRES_DB: symblon_test
        ports:
          - 5432:5432
        options: >-
          --health-cmd "pg_isready -U postgres"
          --health-interval 10s
          --health-timeout 5s
          --health-retries 5
    env:
      SYMBLON_TEST_DATABASE_URL: postgres://postgres:postgres@localhost:5432/symblon_test
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: "24"
          cache: npm
      - run: npm ci
      - run: npm test -w @symblon/substrate-sql
```

The `sql-substrate` job uses a Postgres **service container** and sets
`SYMBLON_TEST_DATABASE_URL`, so the test skips Testcontainers in CI.

- [ ] **Step 3: Verify the full local suite is green**

Run: `npm run typecheck && npm test && npm test -w @symblon/substrate-conformance && npm test -w @symblon/substrate-sql && npm run build`
Expected: every command green (the SQL one needs Docker or `SYMBLON_TEST_DATABASE_URL`).

- [ ] **Step 4: Commit**

```bash
git add packages/substrate-sql/README.md .github/workflows/ci.yml
git commit -m "docs(substrate-sql): README; ci: typecheck/test packages + SQL service job"
```

---

## Task 1.6 (OPTIONAL): verify-on-write defense-in-depth

Per overview §3.3, adapters MAY verify before persisting. The conformance suite does **not** require it (the engine verifies on read), so this is optional hardening — implement only if a server consumer wants fail-fast bad-write rejection.

**Files:**
- Modify: `packages/substrate-sql/src/substrate.ts`
- Test: `packages/substrate-sql/__tests__/verify-on-write.test.ts`

- [ ] **Step 1: Write the failing test**

`packages/substrate-sql/__tests__/verify-on-write.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Pool } from "pg";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { makeEd25519Key, buildLink } from "@symblon/substrate-conformance";
import { createSqlSubstrate } from "../src/substrate.js";
import { fromPg, type SqlClient } from "../src/client.js";
import { createSchema } from "../src/schema.js";

let container: StartedPostgreSqlContainer | undefined;
let pool: Pool;
let sql: SqlClient;

beforeAll(async () => {
  const url = process.env.SYMBLON_TEST_DATABASE_URL;
  pool = url
    ? new Pool({ connectionString: url, max: 4 })
    : new Pool({ connectionString: (container = await new PostgreSqlContainer("postgres:16-alpine").start()).getConnectionUri(), max: 4 });
  sql = fromPg(pool);
  await createSchema(sql);
});
afterAll(async () => {
  await pool?.end();
  await container?.stop();
});

describe("verify-on-write", () => {
  it("rejects an attestation whose signer key is unregistered", async () => {
    await sql.query("truncate attestations, keys");
    const store = createSqlSubstrate({ sql, verifyOnWrite: true });
    const key = makeEd25519Key("unregistered");
    const genesis = await buildLink(key, { scheme: "vow.unit", id: "x" }, null, {
      id: "g",
      type: "mint",
      claim: {},
    });
    // key NOT registered → resolver returns null → verifyAttestation 'unverifiable'
    await expect(store.append(genesis)).rejects.toThrow();
    expect(await store.readChain({ scheme: "vow.unit", id: "x" })).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm test -w @symblon/substrate-sql -- verify-on-write`
Expected: FAIL — `createSqlSubstrate` doesn't accept `verifyOnWrite` and persists the record.

- [ ] **Step 3: Add the option**

In `packages/substrate-sql/src/substrate.ts`, add the import and option. Change the import block to include `verifyAttestation`:

```ts
import {
  HeadConflictError,
  verifyAttestation,
  type Attestation,
  type IntegritySubstrate,
  type PublicKeyResolver,
  type Subject,
} from "@symblon/core";
```

Change the factory signature and, inside `append`, run verification after the head check and before the INSERT:

```ts
export function createSqlSubstrate(opts: { sql: SqlClient; verifyOnWrite?: boolean }): SqlSubstrate {
  const { sql, verifyOnWrite = false } = opts;
  const self: SqlSubstrate = {
    async append(attestation) {
      const subject = attestation.subject;
      const current = await readHead(sql, subject);
      const currentHead = current ? current.payload_hash : null;
      if (attestation.prevHash !== currentHead) {
        throw new HeadConflictError(subject, attestation.prevHash, currentHead);
      }
      if (verifyOnWrite) {
        const v = await verifyAttestation(attestation, self.resolver);
        if (!v.ok) throw new Error(`verify-on-write rejected attestation: ${v.reason}`);
      }
      const nextSeq = current ? current.seq + 1 : 0;
      // ... rest of append unchanged (try/catch INSERT) ...
    },
    // ... readChain, head, resolver, registerKey unchanged ...
  };
  return self;
}
```

Note: the object must be named (`self`) so `append` can call `self.resolver`. Keep the remaining methods exactly as in Task 1.3.

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -w @symblon/substrate-sql -- verify-on-write`
Expected: PASS.

- [ ] **Step 5: Confirm the conformance suite still passes**

Run: `npm test -w @symblon/substrate-sql`
Expected: all green (the conformance test constructs the substrate with `verifyOnWrite` off — default — and registers keys, so nothing changes).

- [ ] **Step 6: Commit**

```bash
git add packages/substrate-sql/src/substrate.ts packages/substrate-sql/__tests__/verify-on-write.test.ts
git commit -m "feat(substrate-sql): optional verify-on-write defense-in-depth"
```

---

## Self-Review (completed by plan author)

**Spec coverage (overview §3 + SQL spec):**
- §3.1 atomic append / `HeadConflictError` → Task 0.1 (+ enforced by conformance test 4/5 in 0.4–0.5, 1.4).
- §3.2 conformance suite (7 assertions) → Task 0.4 (all 7 mapped 1:1); reference adapter → Task 0.5; ships in the conformance package → 0.3–0.6.
- §3.3 verify-on-write (optional) → Task 1.6 (marked optional).
- §3.4 `PublicKeyResolver` key registry → `registerKey`/`resolver` in memory (0.5) and SQL (1.3); `keys` table in schema (1.2).
- §4 packaging (minimal monorepo) → Task 0.2 + per-package scaffolds.
- SQL spec §2 data model → Task 1.2 (`SCHEMA_SQL`). §3 append CAS (optimistic) → Task 1.3. §4 read → 1.3. §5 resolver → 1.3. §6 API shape `createSqlSubstrate` → 1.3. §7 testing against real Postgres → 1.4.
- SQL spec §8.1 (optimistic vs pessimistic) → resolved **optimistic** (PK unique-violation), implemented in 1.3, asserted in 1.4 test 5. §8.2 (`heads` denormalization) → deferred per spec. §8.3 (public-lookup projection) → consumer-side per spec, out of scope. §8.4 (single-primary) → satisfied (single Postgres).

**Placeholder scan:** none — every code/command step shows full content.

**Type consistency:** `KeyedSubstrate` (conformance) and `SqlSubstrate` (sql) are structurally identical (`IntegritySubstrate & { resolver; registerKey }`); the SQL test annotates the factory return as `KeyedSubstrate` and relies on structural compatibility. `makeKeys`/`buildLink`/`createMemorySubstrate`/`createSqlSubstrate`/`fromPg`/`createSchema`/`isUniqueViolation`/`SCHEMA_SQL`/`runSubstrateConformance`/`HeadConflictError` names are used consistently across tasks. `buildLink` partial type matches `AttestationInput`'s optional `assurance`/`commitments`.
</content>
</invoke>

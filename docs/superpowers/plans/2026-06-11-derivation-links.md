# Derivation Links (Transformation Primitive) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the agropass backbone's one new engine primitive to `@symblon/core`: cross-chain derivation links (`derivedFrom` / `consumedIn`) plus a pure `verifyDerivation`, so "subject produced from subjects" (N raw batches → 1 finished batch) is engine-verified, not registry-trusted.

**Architecture:** Mirrors the `custody_change` precedent exactly — a reserved event type (`transformation`) whose claim carries engine-parsed structure, validated by a parser module (`derivation.ts`, like `custody.ts`) and checked by a dedicated pure verifier (`verify-derivation.ts`, like `verify-chain.ts`). The output chain's **genesis** claim carries `derivedFrom: AttestationRef[]` (pinning the consumed input states by id + payloadHash); each input chain then appends a `transformation` attestation whose claim carries `consumedIn: AttestationRef` (pinning the output genesis). `verifyDerivation(output, inputs[], resolver)` checks both halves bidirectionally. No I/O, no randomness, all chains passed in — the engine's purity rules hold. Quantities/mass-balance stay OUT (registry-layer, per spec §7).

**Tech Stack:** TypeScript (strict, `exactOptionalPropertyTypes`), vitest, `@noble/curves` Ed25519 (tests only). No new dependencies. No changes to `Attestation` type, Zod schema, or `verifyChain`.

**Spec:** `docs/superpowers/specs/2026-06-11-agropass-registry-backbone-design.md` §7.

**Creation order matters (and is the design):** output genesis is created FIRST (it can reference input heads that already exist); consumption records are appended to input chains AFTER (they can reference the now-existing genesis, including its payloadHash). So both halves are hash-pinned with no circularity, and the consumption record always sits at a higher index than the consumed state — `verifyDerivation` enforces that ordering.

---

## File Structure

- Create: `derivation.ts` — `AttestationRef` type, `TRANSFORMATION` constant, `attestationRef()` helper, `parseDerivedFrom()` / `parseConsumedIn()` claim parsers (mirror of `custody.ts`).
- Create: `verify-derivation.ts` — `verifyDerivation()` + result types (mirror of `verify-chain.ts`).
- Create: `__tests__/derivation.test.ts` — parser/helper tests.
- Create: `__tests__/verify-derivation.test.ts` — verifier tests (happy path, every failure reason, DAG fan-out).
- Create: `examples/agro-batch.ts` — runnable fruit-traceability example (two deliveries → transformation → verify → tamper demo).
- Modify: `index.ts` — export the new module surfaces.
- Modify: `package.json` — `example:agro` script; version `0.2.0` → `0.3.0`.
- Modify: `README.md` — derivation-links section.
- Modify: `NEXT_SESSION.md` — record the addition.

---

### Task 1: `derivation.ts` — refs and claim parsers

**Files:**
- Create: `derivation.ts`
- Test: `__tests__/derivation.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `__tests__/derivation.test.ts`:

```typescript
// __tests__/derivation.test.ts
import { describe, it, expect } from "vitest";
import { attestationRef, parseDerivedFrom, parseConsumedIn } from "../derivation.js";
import { buildAttestation } from "../build-attestation.js";
import { signAttestation } from "../sign-attestation.js";
import { makeKey, signerFor } from "./_helpers.js";

const T = "2026-06-11T00:00:00.000Z";
const HEX64 = "0".repeat(64);

async function someAttestation() {
  const key = makeKey("k1");
  const input = {
    id: "a1",
    subject: { scheme: "agro.batch", id: "raw-1" },
    issuer: { scheme: "agro.producer", id: "szulc", keyId: key.keyId },
    type: "delivery_received",
    claim: { species: "blueberry" },
    occurredAt: T,
    recordedAt: T,
    prevHash: null,
  };
  return signAttestation(buildAttestation(input), signerFor(key), T);
}

describe("attestationRef", () => {
  it("pins the attestation's subject, id, and payloadHash", async () => {
    const a = await someAttestation();
    expect(attestationRef(a)).toEqual({
      subject: { scheme: "agro.batch", id: "raw-1" },
      attestationId: "a1",
      payloadHash: a.payloadHash,
    });
  });
});

describe("parseDerivedFrom", () => {
  const ref = {
    subject: { scheme: "agro.batch", id: "raw-1" },
    attestationId: "a1",
    payloadHash: HEX64,
  };

  it("accepts a claim with valid refs alongside domain fields", () => {
    expect(parseDerivedFrom({ product: "Borówka 250g", derivedFrom: [ref] })).toEqual([ref]);
  });

  it("rejects an empty derivedFrom list", () => {
    expect(parseDerivedFrom({ derivedFrom: [] })).toBeNull();
  });

  it("rejects a ref with a non-hex payloadHash", () => {
    expect(parseDerivedFrom({ derivedFrom: [{ ...ref, payloadHash: "nope" }] })).toBeNull();
  });

  it("rejects a ref with a missing subject field", () => {
    expect(parseDerivedFrom({ derivedFrom: [{ ...ref, subject: { scheme: "agro.batch" } }] })).toBeNull();
  });

  it("rejects a claim without derivedFrom", () => {
    expect(parseDerivedFrom({ other: 1 })).toBeNull();
  });

  it("rejects non-object claims", () => {
    expect(parseDerivedFrom("nope")).toBeNull();
    expect(parseDerivedFrom(null)).toBeNull();
  });
});

describe("parseConsumedIn", () => {
  const ref = {
    subject: { scheme: "agro.batch", id: "fg-1" },
    attestationId: "g1",
    payloadHash: HEX64,
  };

  it("accepts a claim with a valid consumedIn ref alongside domain fields", () => {
    expect(parseConsumedIn({ consumedIn: ref, note: "ZP-77" })).toEqual(ref);
  });

  it("rejects a missing or malformed consumedIn", () => {
    expect(parseConsumedIn({})).toBeNull();
    expect(parseConsumedIn({ consumedIn: { attestationId: "g1" } })).toBeNull();
    expect(parseConsumedIn(null)).toBeNull();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run __tests__/derivation.test.ts`
Expected: FAIL — `Cannot find module '../derivation.js'` (or equivalent resolve error).

- [ ] **Step 3: Write the implementation**

Create `derivation.ts`:

```typescript
// derivation.ts
import type { Attestation, Subject } from "./types/attestation.js";

const HEX64 = /^[0-9a-f]{64}$/;

/** Reserved event type the engine understands on an INPUT chain: this subject
 *  was (partially) consumed to produce another subject. The matching output
 *  side is the other chain's genesis claim carrying `derivedFrom`. */
export const TRANSFORMATION = "transformation" as const;

/** A tamper-binding pointer at one specific attestation on some chain:
 *  id locates it, payloadHash pins its exact content. */
export type AttestationRef = {
  subject: Subject;
  attestationId: string;
  payloadHash: string;
};

/** The ref that pins `a` — used for both `derivedFrom` entries (output genesis
 *  → consumed input state) and `consumedIn` (input chain → output genesis). */
export function attestationRef(a: Attestation): AttestationRef {
  return { subject: a.subject, attestationId: a.id, payloadHash: a.payloadHash };
}

function parseRef(v: unknown): AttestationRef | null {
  if (v === null || typeof v !== "object") return null;
  const r = v as Record<string, unknown>;
  const s = r["subject"];
  if (s === null || typeof s !== "object") return null;
  const subj = s as Record<string, unknown>;
  const scheme = typeof subj["scheme"] === "string" ? subj["scheme"] : null;
  const id = typeof subj["id"] === "string" ? subj["id"] : null;
  const attestationId = typeof r["attestationId"] === "string" ? r["attestationId"] : null;
  const payloadHash = typeof r["payloadHash"] === "string" ? r["payloadHash"] : null;
  if (!scheme?.length || !id?.length || !attestationId?.length) return null;
  if (!payloadHash || !HEX64.test(payloadHash)) return null;
  return { subject: { scheme, id }, attestationId, payloadHash };
}

/**
 * Parse & validate a genesis claim's `derivedFrom` list (≥ 1 refs), or `null`
 * if absent/malformed. Domain fields may sit alongside `derivedFrom` in the
 * same claim — only the reserved key is engine-parsed (custody_change precedent).
 */
export function parseDerivedFrom(claim: unknown): AttestationRef[] | null {
  if (claim === null || typeof claim !== "object") return null;
  const df = (claim as Record<string, unknown>)["derivedFrom"];
  if (!Array.isArray(df) || df.length === 0) return null;
  const out: AttestationRef[] = [];
  for (const entry of df) {
    const ref = parseRef(entry);
    if (!ref) return null;
    out.push(ref);
  }
  return out;
}

/** Parse & validate a `transformation` claim's `consumedIn` ref, or `null`. */
export function parseConsumedIn(claim: unknown): AttestationRef | null {
  if (claim === null || typeof claim !== "object") return null;
  return parseRef((claim as Record<string, unknown>)["consumedIn"]);
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run __tests__/derivation.test.ts`
Expected: PASS (all tests green).

- [ ] **Step 5: Typecheck and commit**

```bash
npm run typecheck
git add derivation.ts __tests__/derivation.test.ts
git commit -m "feat(core): derivation refs + claim parsers (agropass spec §7)"
```

---

### Task 2: `verify-derivation.ts` — the cross-chain verifier

**Files:**
- Create: `verify-derivation.ts`
- Test: `__tests__/verify-derivation.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `__tests__/verify-derivation.test.ts`:

```typescript
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
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run __tests__/verify-derivation.test.ts`
Expected: FAIL — `Cannot find module '../verify-derivation.js'`.

- [ ] **Step 3: Write the implementation**

Create `verify-derivation.ts`:

```typescript
// verify-derivation.ts
import { verifyChain } from "./verify-chain.js";
import { parseConsumedIn, parseDerivedFrom, TRANSFORMATION } from "./derivation.js";
import type { Attestation } from "./types/attestation.js";
import type { PublicKeyResolver } from "./types/seams.js";

export type DerivationFailureReason =
  | "output-chain-invalid"
  | "missing-derivation"
  | "input-chain-mismatch"
  | "input-chain-invalid"
  | "reference-mismatch"
  | "consumption-missing";

export type DerivationVerification =
  | { ok: true }
  | { ok: false; reason: DerivationFailureReason; inputSubjectId?: string };

function subjectKey(s: { scheme: string; id: string }): string {
  return `${s.scheme} ${s.id}`;
}

/**
 * Verify a transformation end-to-end: the output chain's genesis declares
 * `derivedFrom` refs pinning the consumed input states; every input chain
 * must (a) itself verify, (b) actually contain the pinned state, and
 * (c) record the consumption — a `transformation` attestation appended AFTER
 * the pinned state whose `consumedIn` pins this exact output genesis.
 *
 * Pure: all chains are passed in (the registry serves the cone; this checks
 * it). One ref per input subject in v1. Quantity conservation is NOT checked
 * here — mass balance is registry-layer analytics (spec §7).
 */
export async function verifyDerivation(
  output: Attestation[],
  inputs: Attestation[][],
  resolvePublicKey: PublicKeyResolver,
): Promise<DerivationVerification> {
  // 1. The output chain must be non-empty and verify end-to-end.
  if (output.length === 0) return { ok: false, reason: "output-chain-invalid" };
  const ov = await verifyChain(output, resolvePublicKey);
  if (!ov.ok) return { ok: false, reason: "output-chain-invalid" };

  // 2. The output genesis must carry a valid derivedFrom list.
  const genesis = output[0]!;
  const refs = parseDerivedFrom(genesis.claim);
  if (!refs) return { ok: false, reason: "missing-derivation" };

  // 3. Provided input chains must match the refs 1:1 by subject.
  const bySubject = new Map<string, Attestation[]>();
  for (const chain of inputs) {
    if (chain.length === 0) return { ok: false, reason: "input-chain-mismatch" };
    bySubject.set(subjectKey(chain[0]!.subject), chain);
  }
  if (bySubject.size !== refs.length || inputs.length !== refs.length) {
    return { ok: false, reason: "input-chain-mismatch" };
  }

  for (const ref of refs) {
    const chain = bySubject.get(subjectKey(ref.subject));
    if (!chain) {
      return { ok: false, reason: "input-chain-mismatch", inputSubjectId: ref.subject.id };
    }

    // 4. Each input chain must itself verify.
    const iv = await verifyChain(chain, resolvePublicKey);
    if (!iv.ok) {
      return { ok: false, reason: "input-chain-invalid", inputSubjectId: ref.subject.id };
    }

    // 5. The pinned consumed state must exist on the input chain, hash-exact.
    const refIndex = chain.findIndex(
      (a) => a.id === ref.attestationId && a.payloadHash === ref.payloadHash,
    );
    if (refIndex === -1) {
      return { ok: false, reason: "reference-mismatch", inputSubjectId: ref.subject.id };
    }

    // 6. The input chain must record the consumption AFTER the pinned state,
    //    pointing back at this exact output genesis.
    const consumed = chain.some((a, i) => {
      if (i <= refIndex || a.type !== TRANSFORMATION) return false;
      const c = parseConsumedIn(a.claim);
      return (
        c !== null &&
        c.subject.scheme === genesis.subject.scheme &&
        c.subject.id === genesis.subject.id &&
        c.attestationId === genesis.id &&
        c.payloadHash === genesis.payloadHash
      );
    });
    if (!consumed) {
      return { ok: false, reason: "consumption-missing", inputSubjectId: ref.subject.id };
    }
  }

  return { ok: true };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run __tests__/verify-derivation.test.ts`
Expected: PASS (all tests green).

- [ ] **Step 5: Run the full suite and typecheck**

Run: `npm test && npm run typecheck`
Expected: all tests pass, no type errors.

- [ ] **Step 6: Commit**

```bash
git add verify-derivation.ts __tests__/verify-derivation.test.ts
git commit -m "feat(core): verifyDerivation — cross-chain transformation verifier"
```

---

### Task 3: Public exports + runnable agro example

**Files:**
- Modify: `index.ts`
- Create: `examples/agro-batch.ts`
- Modify: `package.json` (scripts only)

- [ ] **Step 1: Add the exports**

In `index.ts`, after the `currentController, currentCommitments` export line, add:

```typescript
export {
  TRANSFORMATION,
  attestationRef,
  parseDerivedFrom,
  parseConsumedIn,
  type AttestationRef,
} from "./derivation.js";
export {
  verifyDerivation,
  type DerivationVerification,
  type DerivationFailureReason,
} from "./verify-derivation.js";
```

- [ ] **Step 2: Verify the exports compile**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 3: Write the runnable example**

Create `examples/agro-batch.ts`:

```typescript
/**
 * Agro batch traceability — a runnable, copy-pasteable example.
 *
 * Run it:  npm run example:agro   (or: npx tsx examples/agro-batch.ts)
 *
 * The agropass shape (spec §7): two raw fruit batches are delivered
 * (suppliers + prices COMMITTED, never cleartext), then consumed to produce
 * one finished-good batch via derivation links. `verifyDerivation` proves the
 * lineage; tampering with any input delivery breaks it. A Presentation then
 * selectively opens ONE committed field (the price) to an auditor.
 */
import { ed25519 } from "@noble/curves/ed25519";
import { bytesToHex, utf8ToBytes } from "@noble/hashes/utils";
import {
  attestationRef,
  buildAttestation,
  buildPresentation,
  commitField,
  signAttestation,
  TRANSFORMATION,
  verifyDerivation,
  verifyPresentation,
  type Attestation,
  type AttestationInput,
  type PublicKeyResolver,
  type Signer,
  type Subject,
} from "../index.js";

// --- consumer-owned key custody (the engine never sees a private key) ---
type Key = { id: string; priv: Uint8Array; pub: Uint8Array };
function makeKey(id: string): Key {
  const priv = ed25519.utils.randomPrivateKey();
  return { id, priv, pub: ed25519.getPublicKey(priv) };
}
function signerFor(k: Key): Signer {
  return { keyId: k.id, sign: async (msg) => bytesToHex(ed25519.sign(utf8ToBytes(msg), k.priv)) };
}
function resolverFor(keys: Key[]): PublicKeyResolver {
  const map = new Map(keys.map((k) => [k.id, k.pub]));
  return async (id) => map.get(id) ?? null;
}

const T = "2026-06-11T06:00:00.000Z"; // times are passed in — the engine is pure

async function link(
  signerKey: Key,
  subject: Subject,
  prev: Attestation | null,
  partial: Pick<AttestationInput, "id" | "type" | "claim" | "assurance" | "commitments">,
): Promise<Attestation> {
  const input: AttestationInput = {
    ...partial,
    subject,
    issuer: { scheme: "agro.producer", id: "producer-77", keyId: signerKey.id },
    occurredAt: T,
    recordedAt: T,
    prevHash: prev ? prev.payloadHash : null,
  };
  return signAttestation(buildAttestation(input), signerFor(signerKey), T);
}

async function main(): Promise<void> {
  const producer = makeKey("producer-77:v1"); // custodial signer (Phase 0)
  const resolver = resolverFor([producer]);

  // Subjects: producers keep their semantic batch codes (spec §3).
  const rawA: Subject = { scheme: "agro.batch", id: "producer-77:1011125-09561" };
  const rawB: Subject = { scheme: "agro.batch", id: "producer-77:1011125-01111" };
  const fg: Subject = { scheme: "agro.batch", id: "producer-77:36441715251" };

  // 1) Two deliveries (PZ). Public claim: species/origin/quality.
  //    Committed: supplier + price (salts are caller-supplied entropy).
  const a1 = await link(producer, rawA, null, {
    id: "pz-101",
    type: "delivery_received",
    claim: { species: "blueberry", origin: "PL", quality: "101" },
    assurance: "documented",
    commitments: {
      supplier: commitField("Farm Kowalski, GGN 4056186000001", "salt-a-sup"),
      pricePlnKg: commitField(18.5, "salt-a-price"),
    },
  });
  const b1 = await link(producer, rawB, null, {
    id: "pz-102",
    type: "delivery_received",
    claim: { species: "blueberry", origin: "PL", quality: "102" },
    assurance: "documented",
    commitments: {
      supplier: commitField("Farm Nowak, GGN 4056186000002", "salt-b-sup"),
      pricePlnKg: commitField(16.0, "salt-b-price"),
    },
  });

  // 2) Transformation (ZP): output genesis FIRST — it pins the consumed
  //    input states by ref...
  const genesis = await link(producer, fg, null, {
    id: "zp-77",
    type: "transformation",
    claim: {
      product: "Borówka 250g KRAJ POCHODZENIA POLSKA",
      derivedFrom: [attestationRef(a1), attestationRef(b1)],
    },
  });
  //    ...then each input chain records the consumption, pinning the genesis.
  const a2 = await link(producer, rawA, a1, {
    id: "pz-101-zp77",
    type: TRANSFORMATION,
    claim: { consumedIn: attestationRef(genesis) },
  });
  const b2 = await link(producer, rawB, b1, {
    id: "pz-102-zp77",
    type: TRANSFORMATION,
    claim: { consumedIn: attestationRef(genesis) },
  });

  // 3) Verify the lineage: finished batch ← both raw batches.
  const ok = await verifyDerivation([genesis], [[a1, a2], [b1, b2]], resolver);
  console.log("derivation verifies:", ok); // { ok: true }

  // 4) Tamper with one delivery (silently change the quality grade) → caught,
  //    and the failure names the exact input batch.
  const tampered = { ...a1, claim: { species: "blueberry", origin: "PL", quality: "103" } };
  const bad = await verifyDerivation([genesis], [[tampered, a2], [b1, b2]], resolver);
  console.log("tampered input:", bad); // { ok: false, reason: 'input-chain-invalid', inputSubjectId: ... }

  // 5) Selective disclosure: open ONLY raw-A's price to an auditor.
  //    The supplier commitment stays closed.
  const presentation = await buildPresentation(
    {
      subject: rawA,
      nonce: "audit-nonce-1",
      expiresAt: "2026-06-12T06:00:00.000Z",
      disclosed: [{ name: "pricePlnKg", value: 18.5, salt: "salt-a-price" }],
    },
    signerFor(producer),
    T,
  );
  const audit = await verifyPresentation(presentation, [a1, a2], resolver, T);
  console.log("auditor verifies the opened price:", audit); // { ok: true }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
```

- [ ] **Step 4: Add the script and run the example**

In `package.json` `scripts`, after `"example": "tsx examples/basic-passport.ts",` add:

```json
"example:agro": "tsx examples/agro-batch.ts"
```

Run: `npm run example:agro`
Expected output (key order may vary):

```
derivation verifies: { ok: true }
tampered input: { ok: false, reason: 'input-chain-invalid', inputSubjectId: 'producer-77:1011125-09561' }
auditor verifies the opened price: { ok: true }
```

- [ ] **Step 5: Full suite + commit**

```bash
npm test && npm run typecheck && npm run build
git add index.ts examples/agro-batch.ts package.json
git commit -m "feat(core): export derivation surface; add runnable agro-batch example"
```

---

### Task 4: Docs + version bump

**Files:**
- Modify: `README.md`
- Modify: `NEXT_SESSION.md`
- Modify: `package.json` (version only)

- [ ] **Step 1: README section**

In `README.md`, locate the section documenting disclosure primitives (commitments/presentations) and add a sibling section after it:

```markdown
## Derivation links — transformations

One subject produced from others (N raw batches → 1 finished batch; a
refurbished unit → its donor). The output chain's **genesis claim** carries
`derivedFrom: AttestationRef[]` pinning the consumed input states
(id + payloadHash); each input chain then appends a reserved
`transformation` attestation whose claim's `consumedIn` pins the output
genesis. Both halves are hash-pinned with no circularity because the genesis
is created first.

```ts
const genesis = await link(producer, fgBatch, null, {
  id: "zp-77",
  type: "transformation",
  claim: { product: "Borówka 250g", derivedFrom: [attestationRef(a1), attestationRef(b1)] },
});
const a2 = await link(producer, rawBatchA, a1, {
  id: "pz-101-zp77",
  type: TRANSFORMATION,
  claim: { consumedIn: attestationRef(genesis) },
});

await verifyDerivation([genesis], [[a1, a2], [b1, b2]], resolver); // { ok: true }
```

`verifyDerivation` is pure (all chains passed in) and checks: output chain
verifies; genesis declares ≥1 refs; input chains match the refs 1:1, verify,
contain the pinned states, and record the consumption after them. Quantity
conservation is deliberately NOT checked — mass balance is registry-layer.
See `npm run example:agro` and the agropass backbone spec
(`docs/superpowers/specs/2026-06-11-agropass-registry-backbone-design.md` §7).
```

(Adjust placement/heading level to match the README's existing structure; keep its voice.)

- [ ] **Step 2: NEXT_SESSION + version**

- `package.json`: `"version": "0.2.0"` → `"version": "0.3.0"`.
- `NEXT_SESSION.md`: under "Where this repo stands," note `v0.3.0 — derivation links (agropass spec #1)`; under "Engine roadmap," mark the multi-input transformation need as shipped and point spec #2 (agropass registry) at the substrates work. Update the install-tag references from `#v0.2.0` to `#v0.3.0` where they describe the current release.

- [ ] **Step 3: Full verification**

Run: `npm test && npm run typecheck && npm run build && npm run example && npm run example:agro`
Expected: everything green; both examples run to completion.

- [ ] **Step 4: Commit**

```bash
git add README.md NEXT_SESSION.md package.json
git commit -m "docs+chore: derivation links docs; release v0.3.0"
```

(Tagging `v0.3.0` and pushing is a release action — leave to the user.)

---

## Self-Review Notes

- **Spec coverage (§7):** derivedFrom/consumedIn structure ✓ (Task 1), bidirectional verifyDerivation ✓ (Task 2), purity (all chains passed in) ✓, mass balance excluded ✓ (documented in code + README), domain-neutral naming ✓. Head-contention/CAS is substrate work, correctly out of this plan.
- **Type consistency:** `AttestationRef` is the single ref shape used by both halves; `TRANSFORMATION` constant used in tests, example, and verifier; failure-reason strings match between implementation and tests.
- **No placeholders:** every step carries complete code or exact commands.

# Generalized Cross-Chain References Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a typed, tamper-binding cross-chain reference primitive to `@symblon/core` so an attestation on one chain can point at a specific attestation on another chain — the foundation for agropass disputes/counter-claims (a party chain referencing a contested lot attestation).

**Architecture:** Extract the existing `AttestationRef` value object (currently private to `derivation.ts`) into its own module, then build a general `references` claim mechanism alongside the transformation-specific `derivedFrom`/`consumedIn` (which stay untouched). A `references` claim carries `[{ rel, ref }]` entries; `rel` is a domain-owned relationship string (e.g. `"disputes"`), `ref` is a tamper-binding `AttestationRef`. A `verifyReference` checker confirms — across two passed-in chains — that the link is real and hash-exact, exactly mirroring the existing `verifyDerivation`. The engine validates structure + tamper-binding only; the *meaning* of `rel` stays in the domain (the `custody_change`/`derivedFrom` precedent: engine special-cases the reserved key, domain owns semantics).

**Tech Stack:** TypeScript (strict, ESM, `.js` import specifiers), Vitest 4, `@noble` for the test crypto helpers. Pure functions only — no I/O, no randomness, no clock inside the engine (all entropy/timestamps passed in).

## Global Constraints

- **Purity rule:** no randomness, no clock, no I/O inside `@symblon/core`. Salts, ids, and timestamps are always caller-supplied. (Copied from the existing engine contract; every task obeys it.)
- **ESM import specifiers:** all relative imports end in `.js` even though the source is `.ts` (e.g. `import { attestationRef } from "./attestation-ref.js"`).
- **Strict TypeScript:** `npm run build` (`tsc -p tsconfig.build.json`) must stay clean. No `any`; use `unknown` + narrowing, matching `derivation.ts`'s `parseRef` style.
- **Reserved-key precedent:** a reserved claim key (`references`) may sit alongside arbitrary domain fields in the same `claim` object; the parser reads only its own key and ignores the rest — exactly as `parseDerivedFrom` reads only `derivedFrom`.
- **Do not modify** the shipped, tested transformation surface behavior: `parseDerivedFrom`, `parseConsumedIn`, `TRANSFORMATION`, `verifyDerivation` keep their existing semantics. The only change to `derivation.ts` is re-importing the extracted ref helpers.
- **Test command:** `npx vitest run <file>` for a single file; `npm test` for the full suite.

---

## File Structure

| File | Responsibility | Action |
|---|---|---|
| `attestation-ref.ts` | The `AttestationRef` value object: type, `attestationRef()` builder, `parseRef()` validator | **Create** (extract from `derivation.ts`) |
| `derivation.ts` | Transformation-specific reserved keys (`derivedFrom`/`consumedIn`, `TRANSFORMATION`) | **Modify** (import ref helpers from new module; re-export for back-compat) |
| `reference.ts` | The general `references` mechanism: `Reference` type, `DISPUTES` rel, `reference()` builder, `parseReferences()` parser | **Create** |
| `verify-reference.ts` | `verifyReference()` cross-chain checker (mirrors `verify-derivation.ts`) | **Create** |
| `index.ts` | Public surface | **Modify** (export the new symbols; re-point ref exports) |
| `__tests__/reference.test.ts` | Unit tests for build/parse | **Create** |
| `__tests__/verify-reference.test.ts` | Cross-chain verify tests incl. the blueberry dispute scenario | **Create** |
| `__tests__/attestation-ref.test.ts` | Unit tests for the extracted `parseRef`/`attestationRef` | **Create** |

---

### Task 1: Extract the `AttestationRef` value object

Pull `AttestationRef`, `attestationRef()`, and the (currently private) `parseRef()` out of `derivation.ts` into a focused `attestation-ref.ts`, so both `derivation.ts` and the new `reference.ts` share one ref implementation. Behavior is unchanged; this is a refactor that keeps the full existing suite green and newly exposes `parseRef`.

**Files:**
- Create: `attestation-ref.ts`
- Modify: `derivation.ts` (top of file: remove the three definitions, import them instead; keep re-exporting `AttestationRef` + `attestationRef` so existing importers and `index.ts` are unaffected)
- Modify: `index.ts` (re-point the `attestationRef` / `AttestationRef` exports to the new module; add `parseRef`)
- Test: `__tests__/attestation-ref.test.ts`

**Interfaces:**
- Produces:
  - `type AttestationRef = { subject: Subject; attestationId: string; payloadHash: string }`
  - `function attestationRef(a: Attestation): AttestationRef`
  - `function parseRef(v: unknown): AttestationRef | null`

- [ ] **Step 1: Create `attestation-ref.ts` with the extracted code**

```typescript
// attestation-ref.ts
import type { Attestation, Subject } from "./types/attestation.js";

const HEX64 = /^[0-9a-f]{64}$/;

/** A tamper-binding pointer at one specific attestation on some chain:
 *  id locates it, payloadHash pins its exact content. */
export type AttestationRef = {
  subject: Subject;
  attestationId: string;
  payloadHash: string;
};

/** The ref that pins `a`. */
export function attestationRef(a: Attestation): AttestationRef {
  return { subject: a.subject, attestationId: a.id, payloadHash: a.payloadHash };
}

/** Parse & validate an unknown value into an AttestationRef, or `null`. */
export function parseRef(v: unknown): AttestationRef | null {
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
```

- [ ] **Step 2: Rewrite the top of `derivation.ts` to import from the new module**

Replace the `HEX64` const, the `AttestationRef` type, `attestationRef()`, and `parseRef()` definitions with an import + re-export. The file's remaining functions (`parseDerivedFrom`, `parseConsumedIn`) call `parseRef` — that reference now resolves to the import. Final top-of-file:

```typescript
// derivation.ts
import type { Attestation, Subject } from "./types/attestation.js";
import { attestationRef, parseRef, type AttestationRef } from "./attestation-ref.js";

// Re-exported for back-compat: existing importers expect these from "./derivation.js".
export { attestationRef, type AttestationRef };

/** Reserved event type the engine understands on an INPUT chain: this subject
 *  was (partially) consumed to produce another subject. The matching output
 *  side is the other chain's genesis claim carrying `derivedFrom`. */
export const TRANSFORMATION = "transformation" as const;
```

Leave `parseDerivedFrom` and `parseConsumedIn` exactly as they are below that. Delete the now-unused local `HEX64`, the old `AttestationRef` type, the old `attestationRef`, and the old `parseRef` from this file (they live in `attestation-ref.ts` now). Note `Subject` is still imported because the file's types reference it; if `tsc` reports it unused after the edit, drop it from the import.

- [ ] **Step 3: Re-point the exports in `index.ts`**

Change the derivation export block so ref symbols come from the new module. Replace:

```typescript
export {
  TRANSFORMATION,
  attestationRef,
  parseDerivedFrom,
  parseConsumedIn,
  type AttestationRef,
} from "./derivation.js";
```

with:

```typescript
export { attestationRef, parseRef, type AttestationRef } from "./attestation-ref.js";
export {
  TRANSFORMATION,
  parseDerivedFrom,
  parseConsumedIn,
} from "./derivation.js";
```

- [ ] **Step 4: Write a unit test for the extracted helpers**

```typescript
// __tests__/attestation-ref.test.ts
import { describe, it, expect } from "vitest";
import { attestationRef, parseRef } from "../attestation-ref.js";
import type { Attestation } from "../types/attestation.js";

const HASH = "a".repeat(64);

const att = {
  id: "x1",
  subject: { scheme: "agro.lot", id: "BB-123" },
  payloadHash: HASH,
} as unknown as Attestation;

describe("attestationRef", () => {
  it("pins subject, id, and payloadHash", () => {
    expect(attestationRef(att)).toEqual({
      subject: { scheme: "agro.lot", id: "BB-123" },
      attestationId: "x1",
      payloadHash: HASH,
    });
  });
});

describe("parseRef", () => {
  it("round-trips a built ref", () => {
    expect(parseRef(attestationRef(att))).toEqual(attestationRef(att));
  });
  it("rejects a non-hex payloadHash", () => {
    expect(parseRef({ subject: { scheme: "s", id: "i" }, attestationId: "a", payloadHash: "nope" })).toBeNull();
  });
  it("rejects a missing subject", () => {
    expect(parseRef({ attestationId: "a", payloadHash: HASH })).toBeNull();
  });
  it("rejects null", () => {
    expect(parseRef(null)).toBeNull();
  });
});
```

- [ ] **Step 5: Run the new test + the full suite + the build**

Run: `npx vitest run __tests__/attestation-ref.test.ts`
Expected: PASS (4 tests).

Run: `npm test`
Expected: PASS — the full existing suite (derivation, verify-derivation, etc.) is green, proving the refactor is behavior-preserving.

Run: `npm run build`
Expected: no TypeScript errors.

- [ ] **Step 6: Commit**

```bash
git add attestation-ref.ts derivation.ts index.ts __tests__/attestation-ref.test.ts
git commit -m "refactor(core): extract AttestationRef into its own module; export parseRef"
```

---

### Task 2: The general `references` mechanism (build + parse)

Add `reference.ts`: a `Reference = { rel, ref }` value, a `reference()` builder, a `parseReferences()` parser reading the reserved `references` claim key, and the `DISPUTES` rel constant. Mirrors `parseDerivedFrom`'s shape but carries a relationship discriminator and is a list of typed entries.

**Files:**
- Create: `reference.ts`
- Modify: `index.ts` (export the new surface)
- Test: `__tests__/reference.test.ts`

**Interfaces:**
- Consumes (from Task 1): `attestationRef`, `parseRef`, `type AttestationRef` from `./attestation-ref.js`.
- Produces:
  - `type Reference = { rel: string; ref: AttestationRef }`
  - `const DISPUTES = "disputes"` (reserved rel string)
  - `function reference(rel: string, target: Attestation): Reference`
  - `function parseReferences(claim: unknown): Reference[] | null` — returns `null` if the `references` key is absent, not a non-empty array, or any entry is malformed; otherwise the parsed list.

- [ ] **Step 1: Write the failing test**

```typescript
// __tests__/reference.test.ts
import { describe, it, expect } from "vitest";
import { reference, parseReferences, DISPUTES } from "../reference.js";
import { attestationRef } from "../attestation-ref.js";
import type { Attestation } from "../types/attestation.js";

const HASH = "b".repeat(64);
const target = {
  id: "w2",
  subject: { scheme: "agro.lot", id: "BB-123" },
  payloadHash: HASH,
} as unknown as Attestation;

describe("reference / parseReferences", () => {
  it("builds a disputes reference and round-trips it through a claim", () => {
    const claim = { note: "I contest the mold finding", references: [reference(DISPUTES, target)] };
    expect(parseReferences(claim)).toEqual([
      { rel: "disputes", ref: attestationRef(target) },
    ]);
  });

  it("ignores non-reserved domain fields in the same claim", () => {
    const claim = { species: "blueberry", references: [reference("relatedTo", target)] };
    const parsed = parseReferences(claim);
    expect(parsed).not.toBeNull();
    expect(parsed![0]!.rel).toBe("relatedTo");
  });

  it("returns null when the references key is absent", () => {
    expect(parseReferences({ species: "blueberry" })).toBeNull();
  });

  it("returns null for an empty references array", () => {
    expect(parseReferences({ references: [] })).toBeNull();
  });

  it("returns null when an entry has a non-string rel", () => {
    expect(parseReferences({ references: [{ rel: 5, ref: attestationRef(target) }] })).toBeNull();
  });

  it("returns null when an entry's ref is malformed", () => {
    expect(parseReferences({ references: [{ rel: "disputes", ref: { nope: true } }] })).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run __tests__/reference.test.ts`
Expected: FAIL — cannot find module `../reference.js`.

- [ ] **Step 3: Write `reference.ts`**

```typescript
// reference.ts
import type { Attestation } from "./types/attestation.js";
import { attestationRef, parseRef, type AttestationRef } from "./attestation-ref.js";

/** A typed, tamper-binding pointer from one chain at an attestation on another:
 *  `rel` is the domain-owned relationship (engine does not interpret it),
 *  `ref` pins the target attestation's exact content. */
export type Reference = { rel: string; ref: AttestationRef };

/** Reserved relationship: a counter-claim contesting the referenced attestation.
 *  The canonical agropass dispute (a party chain → a contested lot attestation). */
export const DISPUTES = "disputes" as const;

/** Build a reference of relationship `rel` pinning `target`. */
export function reference(rel: string, target: Attestation): Reference {
  return { rel, ref: attestationRef(target) };
}

/**
 * Parse & validate a claim's reserved `references` list (≥ 1 entry), or `null`
 * if absent/malformed. Each entry must be `{ rel: non-empty string, ref }` with
 * a well-formed, tamper-binding `ref`. Domain fields may sit alongside
 * `references` in the same claim — only the reserved key is engine-parsed
 * (custody_change / derivedFrom precedent).
 */
export function parseReferences(claim: unknown): Reference[] | null {
  if (claim === null || typeof claim !== "object") return null;
  const list = (claim as Record<string, unknown>)["references"];
  if (!Array.isArray(list) || list.length === 0) return null;
  const out: Reference[] = [];
  for (const entry of list) {
    if (entry === null || typeof entry !== "object") return null;
    const e = entry as Record<string, unknown>;
    const rel = typeof e["rel"] === "string" ? e["rel"] : null;
    if (!rel?.length) return null;
    const ref = parseRef(e["ref"]);
    if (!ref) return null;
    out.push({ rel, ref });
  }
  return out;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run __tests__/reference.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Export the new surface from `index.ts`**

Add directly after the derivation/attestation-ref export block:

```typescript
export {
  DISPUTES,
  reference,
  parseReferences,
  type Reference,
} from "./reference.js";
```

- [ ] **Step 6: Build + commit**

Run: `npm run build`
Expected: no TypeScript errors.

```bash
git add reference.ts index.ts __tests__/reference.test.ts
git commit -m "feat(core): general cross-chain references (typed rel + tamper-binding ref)"
```

---

### Task 3: `verifyReference` — the cross-chain checker

Add `verify-reference.ts`, mirroring `verify-derivation.ts`: given a *referencing* chain (e.g. a party chain) and a *target* chain (e.g. a lot chain), confirm both chains verify end-to-end and the referencing chain actually pins an attestation that exists hash-exact on the target chain. This is the tamper-binding guarantee made checkable; `rel` is carried but not interpreted (domain concern).

**Files:**
- Create: `verify-reference.ts`
- Modify: `index.ts` (export)
- Test: `__tests__/verify-reference.test.ts`

**Interfaces:**
- Consumes: `verifyChain` from `./verify-chain.js`; `parseReferences` from `./reference.js`; `type Attestation` from `./types/attestation.js`; `type PublicKeyResolver` from `./types/seams.js`.
- Produces:
  - `type ReferenceFailureReason = "referencing-chain-invalid" | "target-chain-invalid" | "no-reference" | "reference-mismatch"`
  - `type ReferenceVerification = { ok: true } | { ok: false; reason: ReferenceFailureReason }`
  - `function verifyReference(referencing: Attestation[], target: Attestation[], resolvePublicKey: PublicKeyResolver): Promise<ReferenceVerification>`

- [ ] **Step 1: Write the failing test**

```typescript
// __tests__/verify-reference.test.ts
import { describe, it, expect } from "vitest";
import { buildAttestation } from "../build-attestation.js";
import { signAttestation } from "../sign-attestation.js";
import { verifyReference } from "../verify-reference.js";
import { reference, DISPUTES } from "../reference.js";
import type { Attestation, AttestationInput, Subject } from "../types/attestation.js";
import { makeKey, resolverFor, signerFor, type TestKey } from "./_helpers.js";

const T = "2026-06-26T00:00:00.000Z";

async function link(
  key: TestKey,
  subject: Subject,
  prev: Attestation | null,
  partial: Pick<AttestationInput, "id" | "type" | "claim">,
): Promise<Attestation> {
  const input: AttestationInput = {
    ...partial,
    subject,
    issuer: { scheme: "agropass.party", id: "actor", keyId: key.keyId },
    occurredAt: T,
    recordedAt: T,
    prevHash: prev ? prev.payloadHash : null,
  };
  return signAttestation(buildAttestation(input), signerFor(key), T);
}

const lot: Subject = { scheme: "agropass.lot", id: "BB-123" };
const growerChain: Subject = { scheme: "agropass.party", id: "grower-7" };

/** Lot chain: grower harvest → custody passes → wholesaler records a rejection.
 *  (Custody mechanics are exercised elsewhere; here both lot links are signed by
 *  one key for brevity — verifyReference only cares the chain verifies + the
 *  pinned attestation exists.) */
async function lotChain(key: TestKey): Promise<Attestation[]> {
  const g1 = await link(key, lot, null, { id: "g1", type: "harvest", claim: { species: "blueberry" } });
  const w2 = await link(key, lot, g1, {
    id: "w2",
    type: "quality_rejection",
    claim: { grade: "C", reason: "mold" },
  });
  return [g1, w2];
}

describe("verifyReference", () => {
  it("accepts a party chain that disputes a real lot attestation", async () => {
    const lotKey = makeKey("lot-signer");
    const growerKey = makeKey("grower-7");
    const resolver = resolverFor(lotKey, growerKey);

    const lc = await lotChain(lotKey);
    const rejection = lc[1]!;

    const d1 = await link(growerKey, growerChain, null, {
      id: "d1",
      type: "counter_claim",
      claim: { note: "I dispute the mold finding", references: [reference(DISPUTES, rejection)] },
    });

    expect(await verifyReference([d1], lc, resolver)).toEqual({ ok: true });
  });

  it("rejects when the referencing chain carries no references", async () => {
    const lotKey = makeKey("lot-signer");
    const growerKey = makeKey("grower-7");
    const resolver = resolverFor(lotKey, growerKey);
    const lc = await lotChain(lotKey);
    const d1 = await link(growerKey, growerChain, null, { id: "d1", type: "note", claim: { note: "hi" } });

    expect(await verifyReference([d1], lc, resolver)).toEqual({ ok: false, reason: "no-reference" });
  });

  it("rejects when the pinned attestation is not on the target chain", async () => {
    const lotKey = makeKey("lot-signer");
    const growerKey = makeKey("grower-7");
    const resolver = resolverFor(lotKey, growerKey);
    const lc = await lotChain(lotKey);
    const rejection = lc[1]!;

    // Tamper: dispute references a forged copy with a different payloadHash.
    const forged = { ...rejection, payloadHash: "f".repeat(64) } as Attestation;
    const d1 = await link(growerKey, growerChain, null, {
      id: "d1",
      type: "counter_claim",
      claim: { references: [reference(DISPUTES, forged)] },
    });

    expect(await verifyReference([d1], lc, resolver)).toEqual({ ok: false, reason: "reference-mismatch" });
  });

  it("rejects when the target chain does not verify", async () => {
    const lotKey = makeKey("lot-signer");
    const growerKey = makeKey("grower-7");
    const resolver = resolverFor(lotKey, growerKey);
    const lc = await lotChain(lotKey);
    const rejection = lc[1]!;
    const d1 = await link(growerKey, growerChain, null, {
      id: "d1",
      type: "counter_claim",
      claim: { references: [reference(DISPUTES, rejection)] },
    });

    // Break the target chain's genesis link.
    const brokenTarget = [{ ...lc[0]!, payloadHash: "0".repeat(64) } as Attestation, lc[1]!];
    expect(await verifyReference([d1], brokenTarget, resolver)).toEqual({
      ok: false,
      reason: "target-chain-invalid",
    });
  });

  it("rejects when the referencing chain does not verify", async () => {
    const lotKey = makeKey("lot-signer");
    const growerKey = makeKey("grower-7");
    const resolver = resolverFor(lotKey, growerKey);
    const lc = await lotChain(lotKey);
    const rejection = lc[1]!;
    const d1 = await link(growerKey, growerChain, null, {
      id: "d1",
      type: "counter_claim",
      claim: { references: [reference(DISPUTES, rejection)] },
    });

    const broken = [{ ...d1, payloadHash: "0".repeat(64) } as Attestation];
    expect(await verifyReference(broken, lc, resolver)).toEqual({
      ok: false,
      reason: "referencing-chain-invalid",
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run __tests__/verify-reference.test.ts`
Expected: FAIL — cannot find module `../verify-reference.js`.

- [ ] **Step 3: Write `verify-reference.ts`**

```typescript
// verify-reference.ts
import { verifyChain } from "./verify-chain.js";
import { parseReferences } from "./reference.js";
import type { Attestation } from "./types/attestation.js";
import type { PublicKeyResolver } from "./types/seams.js";

export type ReferenceFailureReason =
  | "referencing-chain-invalid"
  | "target-chain-invalid"
  | "no-reference"
  | "reference-mismatch";

export type ReferenceVerification =
  | { ok: true }
  | { ok: false; reason: ReferenceFailureReason };

/**
 * Verify a cross-chain reference end-to-end. Both chains must verify; the
 * `referencing` chain must carry at least one `references` entry whose pinned
 * `ref` exists hash-exact (id + payloadHash) on the `target` chain.
 *
 * Pure: both chains are passed in (the registry serves them; this checks them).
 * The `rel` is NOT interpreted here — relationship meaning is a domain concern
 * (engine validates structure + tamper-binding only; spec §5).
 */
export async function verifyReference(
  referencing: Attestation[],
  target: Attestation[],
  resolvePublicKey: PublicKeyResolver,
): Promise<ReferenceVerification> {
  // 1. The referencing chain must be non-empty and verify end-to-end.
  if (referencing.length === 0) return { ok: false, reason: "referencing-chain-invalid" };
  const rv = await verifyChain(referencing, resolvePublicKey);
  if (!rv.ok) return { ok: false, reason: "referencing-chain-invalid" };

  // 2. The target chain must be non-empty and verify end-to-end.
  if (target.length === 0) return { ok: false, reason: "target-chain-invalid" };
  const tv = await verifyChain(target, resolvePublicKey);
  if (!tv.ok) return { ok: false, reason: "target-chain-invalid" };

  // 3. Collect every well-formed reference across the referencing chain.
  const refs = referencing.flatMap((a) => parseReferences(a.claim) ?? []);
  if (refs.length === 0) return { ok: false, reason: "no-reference" };

  // 4. At least one reference must pin an attestation present on the target
  //    chain, hash-exact (id + payloadHash both match).
  const hit = refs.some((r) =>
    target.some((a) => a.id === r.ref.attestationId && a.payloadHash === r.ref.payloadHash),
  );
  if (!hit) return { ok: false, reason: "reference-mismatch" };

  return { ok: true };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run __tests__/verify-reference.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Export from `index.ts`**

Add directly after the `reference.js` export block:

```typescript
export {
  verifyReference,
  type ReferenceVerification,
  type ReferenceFailureReason,
} from "./verify-reference.js";
```

- [ ] **Step 6: Run the full suite + build + commit**

Run: `npm test`
Expected: PASS — full suite green (existing + the three new test files).

Run: `npm run build`
Expected: no TypeScript errors.

```bash
git add verify-reference.ts index.ts __tests__/verify-reference.test.ts
git commit -m "feat(core): verifyReference — cross-chain tamper-binding reference checker"
```

---

### Task 4: Runnable dispute example + README surface note

Ship a runnable end-to-end example (the blueberry rejection + grower counter-claim) so the primitive is demonstrably usable, and document the new export surface — matching how `derivation-links` shipped with `examples/agro-batch.ts` + a README note.

**Files:**
- Create: `examples/dispute.ts`
- Modify: `package.json` (add `example:dispute` script)
- Modify: `README.md` (add the cross-chain references / disputes surface to the API list — locate the section that lists `verifyDerivation` / derivation links and add a sibling entry)

**Interfaces:**
- Consumes: `buildAttestation`, `signAttestation`, `verifyReference`, `reference`, `DISPUTES` from the package root (`../index.js`), plus the `_helpers`-style inline key setup (the example is self-contained — it builds its own signer/resolver, mirroring `examples/agro-batch.ts`).

- [ ] **Step 1: Inspect the existing example to match its exact style**

Run: `cat examples/agro-batch.ts`
Expected: see how it constructs keys/signers/resolver inline and prints results. Mirror that structure (imports from `../index.js`, an inline Ed25519 signer using `@noble`, console output of the verification result).

- [ ] **Step 2: Write `examples/dispute.ts`**

```typescript
// examples/dispute.ts
//
// Blueberry rejection + grower counter-claim, end-to-end.
// A wholesaler rejects a lot on its (custody-passed) lot chain; the grower —
// no longer the lot's controller — records a dispute on their OWN party chain,
// referencing the exact rejection. verifyReference confirms the tamper-binding
// link. Run: npm run example:dispute
import { ed25519 } from "@noble/curves/ed25519";
import { bytesToHex, utf8ToBytes } from "@noble/hashes/utils";
import {
  buildAttestation,
  signAttestation,
  verifyReference,
  reference,
  DISPUTES,
  type Attestation,
  type AttestationInput,
  type Signer,
  type PublicKeyResolver,
  type Subject,
} from "../index.js";

const T = "2026-06-26T00:00:00.000Z";

function key(keyId: string) {
  const priv = ed25519.utils.randomPrivateKey();
  return { keyId, priv, pub: ed25519.getPublicKey(priv) };
}
function signerFor(k: { keyId: string; priv: Uint8Array }): Signer {
  return { keyId: k.keyId, sign: async (m) => bytesToHex(ed25519.sign(utf8ToBytes(m), k.priv)) };
}

async function link(
  k: { keyId: string; priv: Uint8Array },
  subject: Subject,
  prev: Attestation | null,
  partial: Pick<AttestationInput, "id" | "type" | "claim">,
): Promise<Attestation> {
  const input: AttestationInput = {
    ...partial,
    subject,
    issuer: { scheme: subject.scheme, id: "demo", keyId: k.keyId },
    occurredAt: T,
    recordedAt: T,
    prevHash: prev ? prev.payloadHash : null,
  };
  return signAttestation(buildAttestation(input), signerFor(k), T);
}

const lotKey = key("lot-signer");
const growerKey = key("grower-7");
const resolver: PublicKeyResolver = async (id) =>
  id === lotKey.keyId ? lotKey.pub : id === growerKey.keyId ? growerKey.pub : null;

const lot: Subject = { scheme: "agropass.lot", id: "BB-123" };
const party: Subject = { scheme: "agropass.party", id: "grower-7" };

const g1 = await link(lotKey, lot, null, { id: "g1", type: "harvest", claim: { species: "blueberry" } });
const rejection = await link(lotKey, lot, g1, {
  id: "w2",
  type: "quality_rejection",
  claim: { grade: "C", reason: "mold" },
});

const dispute = await link(growerKey, party, null, {
  id: "d1",
  type: "counter_claim",
  claim: { note: "I dispute the mold finding", references: [reference(DISPUTES, rejection)] },
});

const result = await verifyReference([dispute], [g1, rejection], resolver);
console.log("dispute references the rejection, tamper-binding verified:", result);
```

- [ ] **Step 3: Add the npm script**

In `package.json`, in the `scripts` block, after the existing `"example:agro"` line, add:

```json
    "example:dispute": "tsx examples/dispute.ts"
```

(Ensure the preceding line keeps its trailing comma and this is valid JSON.)

- [ ] **Step 4: Run the example**

Run: `npm run example:dispute`
Expected output (the final line):
`dispute references the rejection, tamper-binding verified: { ok: true }`

- [ ] **Step 5: Add a README surface note**

In `README.md`, find the list/section that documents the derivation-links API (search for `verifyDerivation`). Add a sibling bullet in the same style, e.g.:

```markdown
- **Cross-chain references / disputes** — `reference(rel, target)`, `parseReferences(claim)`, and `verifyReference(referencing, target, resolver)`: a tamper-binding pointer from one chain at a specific attestation on another (e.g. a party chain's `disputes` counter-claim against a contested lot attestation). The engine validates structure + tamper-binding; the `rel` is domain-owned. Runnable demo: `npm run example:dispute`.
```

- [ ] **Step 6: Build + commit**

Run: `npm run build`
Expected: no TypeScript errors.

Run: `npm test`
Expected: full suite green.

```bash
git add examples/dispute.ts package.json README.md
git commit -m "docs(core): runnable dispute example + cross-chain references README surface"
```

---

## Out of scope (follow-up plans)

Per spec §10–§11 and the §12 open questions, these are **separate plans** (each needs its own design resolution first):

- **Identity + erasure module (crypto-shred)** — spec §6.4. Open: package location (`packages/identity`?), exact API for the `keyId → party` registry and the shred operation, and how the "personal data only via `commitField`" guardrail is enforced. Resolve §12 questions, then plan.
- **agropass view / reverse-reference index** — spec §3.4. Open: the registry-layer reverse-index schema (an indexed `references` table keyed by target `(subject, attestationId)`) and its placement relative to `substrate-sql`. Registry-layer, Postgres-coupled.

This plan delivers the core primitive both of the above build on.

---

## Self-Review

**Spec coverage (this plan's slice — spec §5):**
- §5 "reuse `AttestationRef` and the internal `parseRef`" → Task 1 (extracted + exported).
- §5 "add a reserved relationship key `references` with a `rel` discriminator, parsed the way `derivedFrom` is" → Task 2 (`parseReferences`, `Reference`, `DISPUTES`).
- §5 "engine validates the ref is well-formed and tamper-binding; meaning of `rel` stays in the domain" → Task 3 (`verifyReference` checks structure + hash-exact tamper-binding, does not interpret `rel`).
- §5 "keep `derivedFrom`/`consumedIn` working unchanged" → Task 1 leaves them in place; `npm test` in Task 1 Step 5 proves it.
- §5 "no change to `verifyChain`, head-CAS, signing, or the substrate seam" → no task touches those files.
- Deltas 2 & 3 (spec §6.4, §3.4) → explicitly deferred above as separate plans, with their open §12 questions named.

**Placeholder scan:** No TBD/TODO; every code step shows full content; every run step states the expected result. Clean.

**Type consistency:** `AttestationRef` (Task 1) is consumed by `reference()`/`parseReferences()` (Task 2) and indirectly by `verifyReference` (Task 3) via `parseReferences`. `Reference = { rel, ref }` is defined once (Task 2) and consumed in Task 3's test + example. `verifyReference(referencing, target, resolvePublicKey)` signature is identical across its definition (Task 3 Step 3), its tests (Task 3 Step 1), the export (Task 3 Step 5), and the example (Task 4). Failure-reason strings match between the type union and every returned object.

# Symblon Disclosure Primitives Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add field commitments and verifiable presentations to `@symblon/core` so an owner can prove current ownership and selectively disclose committed fields, verifiable by anyone with zero trust in the operator.

**Architecture:** Two pure additions on top of the existing attestation engine. (1) A `commitments` map on each attestation — `field → hash(canonicalize({value,salt}))` — covered by `payloadHash`, so commitments are signed and tamper-evident; raw `(value, salt)` openings live in custody. (2) A `Presentation`: a short-lived, signed bundle that discloses chosen openings and is verified against the subject's chain — checking expiry, that the chain verifies, that the signer is the chain's *current* controller, the signature, and that each opening matches the chain's current commitment.

**Tech Stack:** TypeScript (strict, `exactOptionalPropertyTypes`, `noUncheckedIndexedAccess`), ESM, `@noble/curves` (ed25519) + `@noble/hashes` (sha256), `zod`, `vitest`. Pure functions only — no I/O, no `Date.now()`/random inside (salts, nonces, times, ids passed in).

**Scope:** This is **Plan 1 of 2** for the engine extensions (spec §11). It covers Extensions **1 (field commitments)** and **2 (verifiable presentation)** — the pure, unblocking pair. Extensions **3 (two-party transfer)** and **4 (recovery-authorized `custody_change`)**, which modify `verify-chain.ts`'s control-flow, are deferred to **Plan 2** (`2026-06-03-symblon-custody-controlflow.md`). Ships as `@symblon/core` **v0.2.0**.

**Spec:** `docs/superpowers/specs/2026-06-03-hifipass-passport-registry-backbone-design.md` (§9 disclosure & proof links, §11 extensions 1–2).

---

## File Structure

| File | Create/Modify | Responsibility |
|---|---|---|
| `commitments.ts` | Create | `commitField(value, salt)` + `verifyOpening(commitment, value, salt)` — pure commitment helpers |
| `types/attestation.ts` | Modify | add optional `commitments?: Record<string,string>` to `Attestation` |
| `build-attestation.ts` | Modify | include `commitments` in the hashed `content()` |
| `schemas/attestation.ts` | Modify | add `commitments` to `AttestationSchema` |
| `custody.ts` | Create | `parseNewController(claim)` — extracted shared custody-claim parser |
| `verify-chain.ts` | Modify | use `parseNewController` (behavior-preserving DRY refactor) |
| `chain-state.ts` | Create | `currentController(atts)` + `currentCommitments(atts)` — pure chain reads |
| `presentation.ts` | Create | `Presentation` types + `buildPresentation` + `verifyPresentation` |
| `index.ts` | Modify | export the new public symbols |
| `package.json` | Modify | version `0.1.1` → `0.2.0` |
| `README.md` | Modify | document the new API |
| `__tests__/commitments.test.ts` | Create | commitment helper tests |
| `__tests__/attestation-commitments.test.ts` | Create | commitments-on-attestation + tamper-evidence |
| `__tests__/custody.test.ts` | Create | `parseNewController` tests |
| `__tests__/chain-state.test.ts` | Create | `currentController` / `currentCommitments` tests |
| `__tests__/presentation.test.ts` | Create | presentation build/verify tests |

Each task is independently committable. Run the **full suite** (`npm test`) after each task — the existing **36 tests must stay green** throughout (the model change and refactor are designed to be regression-free).

---

### Task 1: Field commitments (`commitments.ts`)

**Files:**
- Create: `commitments.ts`
- Test: `__tests__/commitments.test.ts`

- [ ] **Step 1: Write the failing test**

Create `__tests__/commitments.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { commitField, verifyOpening } from "../commitments.js";

describe("commitField / verifyOpening", () => {
  it("is deterministic and 64-char lowercase hex", () => {
    const c1 = commitField("SN-12345", "salt-abc");
    const c2 = commitField("SN-12345", "salt-abc");
    expect(c1).toBe(c2);
    expect(c1).toMatch(/^[0-9a-f]{64}$/);
  });

  it("changes with a different salt (hiding) and with a different value", () => {
    const base = commitField("SN-12345", "salt-abc");
    expect(commitField("SN-12345", "salt-xyz")).not.toBe(base);
    expect(commitField("SN-99999", "salt-abc")).not.toBe(base);
  });

  it("commits structured values, not just strings", () => {
    const c = commitField({ price: 4200, currency: "CHF" }, "s");
    expect(verifyOpening(c, { price: 4200, currency: "CHF" }, "s")).toBe(true);
  });

  it("verifyOpening accepts the true opening and rejects wrong value/salt/commitment", () => {
    const c = commitField("SN-12345", "salt-abc");
    expect(verifyOpening(c, "SN-12345", "salt-abc")).toBe(true);
    expect(verifyOpening(c, "SN-00000", "salt-abc")).toBe(false);
    expect(verifyOpening(c, "SN-12345", "salt-xyz")).toBe(false);
    expect(verifyOpening("deadbeef", "SN-12345", "salt-abc")).toBe(false);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run __tests__/commitments.test.ts`
Expected: FAIL — cannot resolve `../commitments.js` (module does not exist).

- [ ] **Step 3: Write the implementation**

Create `commitments.ts`:

```ts
// commitments.ts
import { canonicalize } from "./canonicalize.js";
import { sha256Hex } from "./hash.js";

/**
 * Commit to a field value under a salt: lowercase-hex SHA-256 over the
 * canonicalized `{ value, salt }`. The salt is caller-supplied entropy (purity
 * rule — no randomness inside the engine); it hides the value and defeats
 * dictionary attacks on low-entropy fields. The raw `(value, salt)` opening is
 * held in custody and revealed in a Presentation.
 */
export function commitField(value: unknown, salt: string): string {
  return sha256Hex(canonicalize({ value, salt }));
}

/** True iff `(value, salt)` opens to `commitment`. */
export function verifyOpening(commitment: string, value: unknown, salt: string): boolean {
  return commitField(value, salt) === commitment;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run __tests__/commitments.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add commitments.ts __tests__/commitments.test.ts
git commit -m "feat(core): field commitment helpers (commitField, verifyOpening)"
```

---

### Task 2: Carry `commitments` on the attestation (model + hash + schema)

**Files:**
- Modify: `types/attestation.ts`
- Modify: `build-attestation.ts:7-19` (the `content()` function)
- Modify: `schemas/attestation.ts:18-30` (the `AttestationSchema`)
- Test: `__tests__/attestation-commitments.test.ts`

- [ ] **Step 1: Write the failing test**

Create `__tests__/attestation-commitments.test.ts`:

```ts
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

    // Swap the commitment after signing → payloadHash no longer matches.
    const tampered = { ...signed, commitments: { serial: commitField("SN-EVIL", "s") } };
    expect(await verifyAttestation(tampered, resolverFor(k))).toEqual({
      ok: false,
      reason: "payload-hash-mismatch",
    });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run __tests__/attestation-commitments.test.ts`
Expected: FAIL — `commitments` is not a known property of `AttestationInput` (TS error) / the tamper test fails because `commitments` is not part of the hashed content yet.

- [ ] **Step 3a: Add `commitments` to the `Attestation` type**

In `types/attestation.ts`, inside the `Attestation` type, add the field immediately **before** `prevHash`:

```ts
  /** Domain assurance vocab (hifipass: 'channel' | 'receipt' | 'self'). */
  assurance?: string | undefined;
  /** Optional field commitments: field name → lowercase-hex SHA-256 of
   *  canonicalize({ value, salt }). Covered by payloadHash, so signed and
   *  tamper-evident. Raw (value, salt) openings live in custody and are
   *  revealed via a Presentation. */
  commitments?: Record<string, string> | undefined;
  /** Real-world event time (passed in). */
  occurredAt: string;
```

(`UnsignedAttestation` and `AttestationInput` are `Omit`-derived, so they inherit `commitments` automatically.)

- [ ] **Step 3b: Include `commitments` in the hashed content**

In `build-attestation.ts`, add `commitments` to the object returned by `content()` (place it after `assurance`):

```ts
function content(a: AttestationInput): Record<string, unknown> {
  return {
    id: a.id,
    subject: a.subject,
    issuer: a.issuer,
    type: a.type,
    claim: a.claim,
    assurance: a.assurance,
    commitments: a.commitments,
    occurredAt: a.occurredAt,
    recordedAt: a.recordedAt,
    prevHash: a.prevHash,
  };
}
```

> Why this is regression-safe: `canonicalize` drops keys whose value is `undefined` (`obj[k] !== undefined`). For commitment-less attestations `a.commitments` is `undefined`, so the `commitments` key is omitted and the canonical string — hence `payloadHash` — is **identical to before**. The existing 36 tests are unaffected.

- [ ] **Step 3c: Add `commitments` to the Zod schema**

In `schemas/attestation.ts`, add the field to `AttestationSchema` immediately **before** `payloadHash`:

```ts
  assurance: z.string().min(1).optional(),
  commitments: z.record(z.string().regex(/^[0-9a-f]{64}$/)).optional(),
  occurredAt: z.string().min(1),
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run __tests__/attestation-commitments.test.ts`
Expected: PASS (2 tests).

Run: `npm run typecheck`
Expected: PASS — no errors. (The schema-type drift guard at the bottom of `schemas/attestation.ts` must still hold. `z.record(z.string()).optional()` infers `Record<string,string> | undefined`, matching `commitments?: Record<string,string> | undefined`. If — and only if — the drift `satisfies` complains about `commitments` the way it already does for `claim`, extend the existing `Omit<…, "claim">` in **both** guard lines to `Omit<…, "claim" | "commitments"> & { claim?: unknown; commitments?: Record<string,string> }`. Only do this if typecheck actually fails on `commitments`.)

Run: `npm test`
Expected: PASS — all existing tests **plus** the new ones (38 total).

- [ ] **Step 5: Commit**

```bash
git add types/attestation.ts build-attestation.ts schemas/attestation.ts __tests__/attestation-commitments.test.ts
git commit -m "feat(core): carry signed, tamper-evident field commitments on attestations"
```

---

### Task 3: Extract `parseNewController` (DRY refactor, behavior-preserving)

**Files:**
- Create: `custody.ts`
- Modify: `verify-chain.ts:55-82` (the `custody_change` block)
- Test: `__tests__/custody.test.ts`

This extracts the inline custody-claim guard so both `verify-chain.ts` and the new `chain-state.ts` (Task 4) share one parser. `verifyChain`'s observable behavior is **unchanged**.

- [ ] **Step 1: Write the failing test**

Create `__tests__/custody.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { parseNewController } from "../custody.js";

const HEX64 = "a".repeat(64);

describe("parseNewController", () => {
  it("parses a well-formed custody_change claim", () => {
    expect(parseNewController({ newController: { keyId: "device-1", publicKey: HEX64 } }))
      .toEqual({ keyId: "device-1", publicKey: HEX64 });
  });

  it("returns null for missing/empty/malformed shapes", () => {
    expect(parseNewController(null)).toBeNull();
    expect(parseNewController({})).toBeNull();
    expect(parseNewController({ newController: null })).toBeNull();
    expect(parseNewController({ newController: { keyId: "", publicKey: HEX64 } })).toBeNull();
    expect(parseNewController({ newController: { keyId: "device-1", publicKey: "xyz" } })).toBeNull();
    expect(parseNewController({ newController: { keyId: "device-1" } })).toBeNull();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run __tests__/custody.test.ts`
Expected: FAIL — cannot resolve `../custody.js`.

- [ ] **Step 3a: Write `custody.ts`**

Create `custody.ts`:

```ts
// custody.ts
const HEX64 = /^[0-9a-f]{64}$/;

/** The validated payload a custody_change hands control to. */
export type NewController = { keyId: string; publicKey: string };

/**
 * Parse & validate a `custody_change` claim's `newController`, or `null` if the
 * claim is malformed. `publicKey` must be 64-char lowercase hex; `keyId` must be
 * a non-empty string.
 */
export function parseNewController(claim: unknown): NewController | null {
  if (claim === null || typeof claim !== "object") return null;
  const nc = (claim as Record<string, unknown>)["newController"];
  if (nc === null || typeof nc !== "object") return null;
  const r = nc as Record<string, unknown>;
  const keyId = typeof r["keyId"] === "string" ? r["keyId"] : null;
  const publicKey = typeof r["publicKey"] === "string" ? r["publicKey"] : null;
  if (!keyId || !keyId.length || !publicKey || !HEX64.test(publicKey)) return null;
  return { keyId, publicKey };
}
```

- [ ] **Step 3b: Refactor `verify-chain.ts` to use it**

In `verify-chain.ts`, add the import near the top:

```ts
import { parseNewController } from "./custody.js";
```

Replace the entire `custody_change` block (the current `if (a.type === CUSTODY_CHANGE) { … }`, the inline `HEX64`/`nc`/`newKeyId`/`newPublicKey` guard plus the bind) with:

```ts
    // 5. A custody_change (signed by the outgoing controller, just verified)
    //    hands control to the new key for all subsequent links.
    if (a.type === CUSTODY_CHANGE) {
      // 5a. Validate the claim shape before trusting any field.
      const nc = parseNewController(a.claim);
      if (!nc) {
        return { ok: false, brokenIndex: i, reason: "malformed-custody-claim" };
      }
      // 5b. Bind: if the resolver knows the new key, it must match the signed claim.
      const newPub = await resolvePublicKey(nc.keyId);
      if (newPub !== null && bytesToHex(newPub) !== nc.publicKey) {
        return { ok: false, brokenIndex: i, reason: "controller-key-mismatch" };
      }
      activeKeyId = nc.keyId;
    }
```

(The `bytesToHex` import already present in `verify-chain.ts` is still used. No other change.)

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run __tests__/custody.test.ts`
Expected: PASS (2 tests).

Run: `npm test`
Expected: PASS — the existing `verify-chain` custody tests (`malformed-custody-claim`, `controller-key-mismatch`, the handover test) stay green, proving the refactor preserved behavior.

- [ ] **Step 5: Commit**

```bash
git add custody.ts verify-chain.ts __tests__/custody.test.ts
git commit -m "refactor(core): extract parseNewController; reuse in verifyChain (no behavior change)"
```

---

### Task 4: Chain reads — `currentController` + `currentCommitments` (`chain-state.ts`)

**Files:**
- Create: `chain-state.ts`
- Test: `__tests__/chain-state.test.ts`

Pure reads over a **structurally valid** chain (the caller runs `verifyChain` first). `currentController` mirrors `verifyChain`'s controller tracking (genesis signer, switched at `custody_change`); `currentCommitments` folds each link's `commitments`, later overriding earlier.

- [ ] **Step 1: Write the failing test**

Create `__tests__/chain-state.test.ts`:

```ts
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
      commitments: { price: commitField(120, "p2") }, // overrides price
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
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run __tests__/chain-state.test.ts`
Expected: FAIL — cannot resolve `../chain-state.js`.

- [ ] **Step 3: Write `chain-state.ts`**

Create `chain-state.ts`:

```ts
// chain-state.ts
import { parseNewController } from "./custody.js";
import { CUSTODY_CHANGE, type Attestation } from "./types/attestation.js";

/**
 * The current controller keyId of a (structurally valid) chain: the genesis
 * signer, switched at each `custody_change`. Returns `null` for an empty chain.
 * Assumes the chain has already passed `verifyChain` — this is a pure read,
 * not a verification.
 */
export function currentController(atts: Attestation[]): string | null {
  let controller: string | null = null;
  for (const a of atts) {
    if (controller === null) controller = a.proof.keyId;
    if (a.type === CUSTODY_CHANGE) {
      const nc = parseNewController(a.claim);
      if (nc) controller = nc.keyId;
    }
  }
  return controller;
}

/**
 * The effective commitment map of a chain: each attestation's `commitments`
 * merged in order, later entries overriding earlier ones. Pure read.
 */
export function currentCommitments(atts: Attestation[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const a of atts) {
    if (a.commitments) {
      for (const k of Object.keys(a.commitments)) out[k] = a.commitments[k]!;
    }
  }
  return out;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run __tests__/chain-state.test.ts`
Expected: PASS (5 tests).

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add chain-state.ts __tests__/chain-state.test.ts
git commit -m "feat(core): currentController + currentCommitments chain reads"
```

---

### Task 5: Verifiable presentation (`presentation.ts`)

**Files:**
- Create: `presentation.ts`
- Test: `__tests__/presentation.test.ts`

- [ ] **Step 1: Write the failing test**

Create `__tests__/presentation.test.ts`:

```ts
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

/** A genesis mint committing the serial, signed by `owner`. */
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

    // old owner can no longer present
    const stale = await buildPresentation(
      { subject, nonce: "n1", expiresAt: FUTURE, disclosed: [] },
      signerFor(owner),
      NOW,
    );
    expect(await verifyPresentation(stale, chain, resolve, NOW)).toEqual({ ok: false, reason: "not-current-controller" });

    // new owner can
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
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run __tests__/presentation.test.ts`
Expected: FAIL — cannot resolve `../presentation.js`.

- [ ] **Step 3: Write `presentation.ts`**

Create `presentation.ts`:

```ts
// presentation.ts
import { ed25519 } from "@noble/curves/ed25519";
import { hexToBytes, utf8ToBytes } from "@noble/hashes/utils";
import { canonicalize } from "./canonicalize.js";
import { sha256Hex } from "./hash.js";
import { verifyOpening } from "./commitments.js";
import { verifyChain } from "./verify-chain.js";
import { currentController, currentCommitments } from "./chain-state.js";
import type { Attestation, Proof, Subject } from "./types/attestation.js";
import type { PublicKeyResolver, Signer } from "./types/seams.js";

/** One revealed field: its name, value, and the salt that opens its commitment. */
export type DisclosedField = { name: string; value: unknown; salt: string };

/** Caller input to `buildPresentation` (controllerKeyId comes from the signer). */
export type PresentationInput = {
  subject: Subject;
  /** Freshness, caller-supplied (purity rule). */
  nonce: string;
  /** ISO-8601 expiry, caller-supplied. */
  expiresAt: string;
  disclosed: DisclosedField[];
};

/** A signed, short-lived proof of current ownership + selective disclosure. */
export type Presentation = {
  subject: Subject;
  controllerKeyId: string;
  nonce: string;
  expiresAt: string;
  disclosed: DisclosedField[];
  proof: Proof;
};

export type PresentationFailureReason =
  | "expired"
  | "subject-mismatch"
  | "chain-invalid"
  | "not-current-controller"
  | "unverifiable"
  | "bad-signature"
  | "unknown-field"
  | "opening-mismatch";

export type PresentationVerification =
  | { ok: true }
  | { ok: false; reason: PresentationFailureReason };

/** The bytes a presentation's proof signs: canonicalize of its content (sans proof). */
function presentationHash(p: Omit<Presentation, "proof">): string {
  return sha256Hex(
    canonicalize({
      subject: p.subject,
      controllerKeyId: p.controllerKeyId,
      nonce: p.nonce,
      expiresAt: p.expiresAt,
      disclosed: p.disclosed,
    }),
  );
}

/**
 * Build + sign a presentation. The signer IS the claimed current controller;
 * `created` (ISO time) is passed in — purity rule.
 */
export async function buildPresentation(
  input: PresentationInput,
  signer: Signer,
  created: string,
): Promise<Presentation> {
  const unsigned = { ...input, controllerKeyId: signer.keyId };
  const signature = await signer.sign(presentationHash(unsigned));
  return {
    ...unsigned,
    proof: { type: "ed25519-jcs-2022", keyId: signer.keyId, created, signature },
  };
}

/**
 * Verify a presentation against the subject's chain, with zero trust in the
 * presenter:
 *   1. not expired (vs the passed-in `now`),
 *   2. the chain is about this subject and itself verifies,
 *   3. the signer is the chain's CURRENT controller,
 *   4. the signature over the presentation content is valid,
 *   5. every disclosed field opens to the chain's current commitment for it.
 * `now` (ISO time) is passed in — purity rule.
 */
export async function verifyPresentation(
  p: Presentation,
  chain: Attestation[],
  resolvePublicKey: PublicKeyResolver,
  now: string,
): Promise<PresentationVerification> {
  // 1. Freshness.
  if (Date.parse(now) > Date.parse(p.expiresAt)) {
    return { ok: false, reason: "expired" };
  }

  // 2. The chain must be about this subject and verify end-to-end.
  if (
    chain.length === 0 ||
    chain[0]!.subject.scheme !== p.subject.scheme ||
    chain[0]!.subject.id !== p.subject.id
  ) {
    return { ok: false, reason: "subject-mismatch" };
  }
  const cv = await verifyChain(chain, resolvePublicKey);
  if (!cv.ok) return { ok: false, reason: "chain-invalid" };

  // 3. The signer must be the chain's current controller.
  if (p.controllerKeyId !== currentController(chain) || p.proof.keyId !== p.controllerKeyId) {
    return { ok: false, reason: "not-current-controller" };
  }

  // 4. Signature over the presentation content.
  const pub = await resolvePublicKey(p.controllerKeyId);
  if (pub === null) return { ok: false, reason: "unverifiable" };
  const valid = ed25519.verify(hexToBytes(p.proof.signature), utf8ToBytes(presentationHash(p)), pub);
  if (!valid) return { ok: false, reason: "bad-signature" };

  // 5. Every disclosed field opens to the chain's current commitment.
  const commits = currentCommitments(chain);
  for (const d of p.disclosed) {
    const c = commits[d.name];
    if (c === undefined) return { ok: false, reason: "unknown-field" };
    if (!verifyOpening(c, d.value, d.salt)) return { ok: false, reason: "opening-mismatch" };
  }

  return { ok: true };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run __tests__/presentation.test.ts`
Expected: PASS (7 tests).

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add presentation.ts __tests__/presentation.test.ts
git commit -m "feat(core): verifiable presentation (buildPresentation, verifyPresentation)"
```

---

### Task 6: Public API, version, docs

**Files:**
- Modify: `index.ts`
- Modify: `package.json:3` (version)
- Modify: `README.md` (API table + a short disclosure note)

- [ ] **Step 1: Write the failing test**

Append to `__tests__/smoke.test.ts` a check that the new symbols are exported from the package entry point:

```ts
import { describe, it, expect } from "vitest";
import * as core from "../index.js";

describe("@symblon/core public API", () => {
  it("exports the disclosure primitives", () => {
    expect(typeof core.commitField).toBe("function");
    expect(typeof core.verifyOpening).toBe("function");
    expect(typeof core.currentController).toBe("function");
    expect(typeof core.currentCommitments).toBe("function");
    expect(typeof core.buildPresentation).toBe("function");
    expect(typeof core.verifyPresentation).toBe("function");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run __tests__/smoke.test.ts`
Expected: FAIL — `core.commitField` etc. are `undefined` (not yet exported).

- [ ] **Step 3a: Add the exports**

In `index.ts`, append:

```ts
export { commitField, verifyOpening } from "./commitments.js";
export { currentController, currentCommitments } from "./chain-state.js";
export {
  buildPresentation,
  verifyPresentation,
  type DisclosedField,
  type Presentation,
  type PresentationInput,
  type PresentationVerification,
  type PresentationFailureReason,
} from "./presentation.js";
```

(`parseNewController`/`custody.ts` stays internal — not exported.)

- [ ] **Step 3b: Bump the version**

In `package.json`, change line 3:

```json
  "version": "0.2.0",
```

- [ ] **Step 3c: Document the new API**

In `README.md`, add these rows to the **API** table (after `computeMerkleRoot`):

```markdown
| `commitField(value, salt)` / `verifyOpening(commitment, value, salt)` | commit a private field to a salted hash; verify an opening |
| `currentController(atts)` / `currentCommitments(atts)` | read a verified chain's current controller key / effective commitment map |
| `buildPresentation(input, signer, created)` | build + sign a short-lived proof-of-ownership + selective disclosure |
| `verifyPresentation(p, chain, resolve, now)` | verify a presentation: fresh, chain valid, signer is current controller, openings match commitments |
```

And add a short subsection after the API table:

```markdown
### Selective disclosure

Private fields are stored as **salted commitments** on the attestation (`commitments: { field: hash }`) — covered by `payloadHash`, so signed and tamper-evident. The raw `(value, salt)` openings live in custody. An owner builds a short-lived **Presentation** disclosing a chosen subset; any verifier checks it is fresh, that the chain verifies, that the presenter is the chain's *current* controller, and that each opening matches its committed hash — with zero trust in the operator.
```

- [ ] **Step 4: Run everything to verify it passes**

Run: `npm test`
Expected: PASS — full suite (existing 36 + new commitments/attestation/custody/chain-state/presentation/api tests).

Run: `npm run build`
Expected: PASS — `dist/` emits `commitments.js`, `custody.js`, `chain-state.js`, `presentation.js` (+ `.d.ts`) alongside the rest.

- [ ] **Step 5: Commit**

```bash
git add index.ts package.json README.md __tests__/smoke.test.ts
git commit -m "feat(core): export disclosure primitives; release v0.2.0"
```

---

## Self-Review

**Spec coverage (§9 disclosure & proof links, §11 extensions 1–2):**
- §9 "salted commitment on the attestation, openings in custody" → Tasks 1–2. ✅
- §9 "verifiable presentation: openings + signature by current controller; verifier checks signature · current head · openings match commitments · not expired" → Task 5 (`verifyPresentation` checks expiry, chain-valid, current-controller, signature, opening match). ✅
- §9 "field-level granularity" → `disclosed: DisclosedField[]` discloses an arbitrary subset. ✅
- §11 Extension 1 (field commitments) → Tasks 1–2. ✅
- §11 Extension 2 (verifiable presentation) → Task 5 (+ Task 4 reads). ✅
- §11 Extensions 3 (two-party transfer) & 4 (recovery) → **out of scope, deferred to Plan 2** (stated up front). ✅ (no gap — intentional)

**Placeholder scan:** none — every step has complete code/commands and expected output.

**Type consistency:** `commitField(value, salt)` / `verifyOpening(commitment, value, salt)` used identically in Tasks 1, 2, 4, 5. `currentController`/`currentCommitments` signatures match between Task 4 (definition) and Task 5 (use). `Presentation`/`DisclosedField`/`PresentationInput` consistent between Task 5 definition and its tests. `parseNewController` returns `NewController | null`, consumed the same way in `verify-chain.ts` and `chain-state.ts`. The `commitments?: Record<string,string>` field name is identical across the type, `content()`, the schema, and all reads.

**Regression safety:** the model change (Task 2) is hash-invariant for commitment-less attestations (canonicalize drops `undefined`); the refactor (Task 3) is behavior-preserving. The existing 36 tests must stay green after every task — each task's Step 4 runs `npm test`.

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-06-03-symblon-disclosure-primitives.md`. Two execution options:

1. **Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration.
2. **Inline Execution** — Execute tasks in this session using executing-plans, batch execution with checkpoints.

Which approach?

# @symblon/core

A **pure provenance engine**: signed, hash-linked, append-only attestation chains for any physical or digital object. No UI, no framework, no I/O — just the cryptographic core and a clean data model. It powers **hifipass** (provenance for hi-fi gear) and is domain-neutral by design, so the same engine serves any Digital Product Passport use case (e.g. food/agriculture traceability).

Tamper-evidence **without a blockchain**: each record carries the hash of the one before it and an Ed25519 signature, so rewriting any past record breaks every link after it — detectable by math, not trust. Public-ledger anchoring is an optional future layer the engine is already shaped for; it is off by default.

## Install

```bash
npm install @symblon/core
# or as a git dependency, pinned to a release tag:
npm install github:zerostorypoints/symblon#v0.3.0
# crypto deps (@noble/curves, @noble/hashes, zod) come with it
```

> Ships compiled ESM (`dist/*.js`) with type declarations (`dist/*.d.ts`) — consumable by any TypeScript or JavaScript project. Build it with `npm run build`; the published artifact is `dist/`, regenerated automatically on publish/install via the `prepare` script.

## Quickstart

```ts
import {
  buildAttestation, signAttestation, verifyChain,
  type Signer, type PublicKeyResolver,
} from "@symblon/core";

// You own key custody (a KMS/enclave signer) and key lookup (a registry).
const signer: Signer = { keyId: "platform:v1", sign: async (msg) => /* hex sig */ "" };
const resolve: PublicKeyResolver = async (keyId) => /* pubkey bytes | null */ null;

const genesis = await signAttestation(
  buildAttestation({
    id: crypto.randomUUID(),
    subject: { scheme: "example.unit", id: "amp-h120:<hashed-serial>" },
    issuer: { scheme: "example.platform", id: "platform", keyId: signer.keyId },
    type: "mint",
    claim: { owner_user_id: "alice" },
    assurance: "channel",
    occurredAt: new Date().toISOString(),
    recordedAt: new Date().toISOString(),
    prevHash: null, // genesis
  }),
  signer,
  new Date().toISOString(),
);

const result = await verifyChain([genesis /* …rest of chain */], resolve);
// { ok: true } | { ok: false, brokenIndex, reason }
```

A complete, runnable walkthrough (mint → transfer → custody handover → tamper detection) lives in [`examples/basic-passport.ts`](examples/basic-passport.ts):

```bash
npm install
npm run example
```

## The model

- **Attestation** — one signed link in a subject's chain: `{ id, subject, issuer, type, claim, assurance?, occurredAt, recordedAt, prevHash, payloadHash, proof }`. `payloadHash` is SHA-256 over the canonicalized content (everything except the proof); `proof` is an Ed25519 signature over that hash.
- **Subject** `{ scheme, id }` — what the passport is about. The engine treats it as opaque; the *domain* owns the scheme (`hifisync.unit`, `gs1.gtin-lot`, …).
- **Chain** — attestations ordered genesis → head, each `prevHash` pointing at the previous `payloadHash`.
- **`custody_change`** — the one reserved event the engine understands: it hands control to a new key (signed by the *outgoing* controller). This is what makes a passport's custody migrate (custodial → self-sovereign) as just another append, with no change to the engine.

### The two seams (you inject these; the engine knows no implementation)

| Seam | Responsibility | Custodial example | Sovereign example |
|---|---|---|---|
| `Signer` | produce a signature | platform KMS key | owner's device key |
| `IntegritySubstrate` | append/read the chain | Supabase table | Hypercore / Autobase (P2P) |

Plus `PublicKeyResolver` `(keyId) => publicKey | null`, injected into verification so the engine stays I/O-free.

## API

| Export | What it does |
|---|---|
| `buildAttestation(input)` | assemble an unsigned attestation + compute its `payloadHash` |
| `signAttestation(unsigned, signer, created)` | attach the Ed25519 `proof` |
| `verifyAttestation(a, resolve)` | verify one record's hash + signature |
| `verifyChain(atts, resolve)` | verify a whole chain; track the controller; switch it at `custody_change`; return first broken link |
| `computeMerkleRoot(hashes)` | Merkle root over payload hashes (anchor-ready, dormant) |
| `commitField(value, salt)` / `verifyOpening(commitment, value, salt)` | commit a private field to a salted hash; verify an opening |
| `currentController(atts)` / `currentCommitments(atts)` | read a verified chain's current controller key / effective commitment map |
| `buildPresentation(input, signer, created)` | build + sign a short-lived proof-of-ownership + selective disclosure |
| `verifyPresentation(p, chain, resolve, now)` | verify a presentation: fresh, chain valid, signer is current controller, openings match commitments |
| `attestationRef(a)` | the tamper-binding pointer `{ subject, attestationId, payloadHash }` at one attestation |
| `parseDerivedFrom(claim)` / `parseConsumedIn(claim)` | parse + validate the reserved derivation-link claim keys |
| `verifyDerivation(output, inputs, resolve)` | verify a transformation: output genesis's `derivedFrom` refs ↔ each input chain's `consumedIn` record, bidirectionally hash-pinned |
| `reference(rel, target)` / `parseReferences(claim)` / `verifyReference(referencing, target, resolve)` | a tamper-binding pointer from one chain at a specific attestation on another (e.g. a party chain's `disputes` counter-claim against a contested lot attestation); the engine validates structure + tamper-binding; the `rel` is domain-owned. Demo: `npm run example:dispute` |
| `canonicalize(value)` / `sha256Hex(s)` | deterministic JSON + hashing primitives |
| `AttestationSchema` | Zod schema mirroring the `Attestation` type |

**Verification failure reasons** (`verifyChain`): `prev-hash-mismatch`, `wrong-signer`, `payload-hash-mismatch`, `bad-signature`, `unverifiable`, `malformed-custody-claim`, `controller-key-mismatch`.

### Selective disclosure

Private fields are stored as **salted commitments** on the attestation (`commitments: { field: hash }`) — covered by `payloadHash`, so signed and tamper-evident. The raw `(value, salt)` openings live in custody. An owner builds a short-lived **Presentation** disclosing a chosen subset; any verifier checks it is fresh, that the chain verifies, that the presenter is the chain's *current* controller, and that each opening matches its committed hash — with zero trust in the operator.

### Derivation links — transformations

One subject produced from others (N raw batches → 1 finished batch; a refurbished unit → its donor). The output chain's **genesis claim** carries `derivedFrom: AttestationRef[]` pinning the consumed input states (id + payloadHash); each input chain then appends a reserved **`transformation`** attestation whose claim's `consumedIn` pins the output genesis. Both halves are hash-pinned with no circularity, because the genesis is created first.

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

await verifyDerivation([genesis], [[a1, a2], [b1, b2]], resolve); // { ok: true }
```

`verifyDerivation` is pure (all chains passed in) and checks: the output chain verifies; its genesis declares ≥ 1 refs; the input chains match the refs 1:1, verify, contain the pinned states, and record the consumption after them. Failure reasons: `output-chain-invalid`, `missing-derivation`, `input-chain-mismatch`, `input-chain-invalid`, `reference-mismatch`, `consumption-missing` — with `inputSubjectId` naming the offending input. Quantity conservation is deliberately **not** checked — mass balance is registry-layer. A complete fruit-traceability walkthrough (committed prices/suppliers → transformation → tamper detection → auditor disclosure) lives in [`examples/agro-batch.ts`](examples/agro-batch.ts) (`npm run example:agro`); the design is the agropass backbone spec, §7.

## Scripts

```bash
npm test            # vitest — the full engine suite
npm run typecheck   # tsc --noEmit (strict typecheck)
npm run build       # emit dist/ — compiled ESM + .d.ts
npm run example     # run examples/basic-passport.ts
npm run example:agro # run examples/agro-batch.ts (derivation links)
npm run example:dispute # run examples/dispute.ts (cross-chain references)
```

> Uses npm. pnpm works too, but pnpm 10/11 blocks dependency build scripts by
> default — run `pnpm approve-builds` once (to allow `esbuild`) after installing.

## Design principles

Pure functions only, no I/O, no `Date.now()`/random inside (times and ids are passed in). Named exports, `type` over `interface`, Zod schemas mirror types, kebab-case files, strict TypeScript (`noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`). Cryptography via audited `@noble/*` libraries — never hand-rolled.

## Status & deferred

Implemented: the full attestation model, signing/verification, controller-tracking chain verification with custody handover, field commitments + verifiable presentations, cross-chain derivation links (`verifyDerivation`), an anchor-ready Merkle root, and a compiled `dist` build (ESM + `.d.ts`). Deferred by design: W3C Verifiable Credentials / GS1 EPCIS export adapters, public-ledger anchoring, and a Hypercore/Autobase substrate for the sovereign tier.

## License

Apache-2.0 © 2026 Piotr Dziubecki

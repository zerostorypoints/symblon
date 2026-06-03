# @symblon/core

A **pure provenance engine**: signed, hash-linked, append-only attestation chains for any physical or digital object. No UI, no framework, no I/O — just the cryptographic core and a clean data model. It powers **hifipass** (provenance for hi-fi gear) and is domain-neutral by design, so the same engine serves any Digital Product Passport use case (e.g. food/agriculture traceability).

Tamper-evidence **without a blockchain**: each record carries the hash of the one before it and an Ed25519 signature, so rewriting any past record breaks every link after it — detectable by math, not trust. Public-ledger anchoring is an optional future layer the engine is already shaped for; it is off by default.

## Install

```bash
# private git dependency, pinned to a release tag:
npm install github:piotr-dziubecki/symblon#v0.1.1
# installs as @symblon/core; builds dist on install (prepare);
# crypto deps (@noble/curves, @noble/hashes, zod) come with it
```

> Ships compiled ESM (`dist/*.js`) with type declarations (`dist/*.d.ts`) — consumable by any TypeScript or JavaScript project. Build it with `npm run build`; the published artifact is `dist/`, regenerated automatically on publish via `prepublishOnly`.

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
| `canonicalize(value)` / `sha256Hex(s)` | deterministic JSON + hashing primitives |
| `AttestationSchema` | Zod schema mirroring the `Attestation` type |

**Verification failure reasons** (`verifyChain`): `prev-hash-mismatch`, `wrong-signer`, `payload-hash-mismatch`, `bad-signature`, `unverifiable`, `malformed-custody-claim`, `controller-key-mismatch`.

### Selective disclosure

Private fields are stored as **salted commitments** on the attestation (`commitments: { field: hash }`) — covered by `payloadHash`, so signed and tamper-evident. The raw `(value, salt)` openings live in custody. An owner builds a short-lived **Presentation** disclosing a chosen subset; any verifier checks it is fresh, that the chain verifies, that the presenter is the chain's *current* controller, and that each opening matches its committed hash — with zero trust in the operator.

## Scripts

```bash
npm test            # vitest — the full engine suite
npm run typecheck   # tsc --noEmit (strict typecheck)
npm run build       # emit dist/ — compiled ESM + .d.ts
npm run example     # run examples/basic-passport.ts
```

> Uses npm. pnpm works too, but pnpm 10/11 blocks dependency build scripts by
> default — run `pnpm approve-builds` once (to allow `esbuild`) after installing.

## Design principles

Pure functions only, no I/O, no `Date.now()`/random inside (times and ids are passed in). Named exports, `type` over `interface`, Zod schemas mirror types, kebab-case files, strict TypeScript (`noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`). Cryptography via audited `@noble/*` libraries — never hand-rolled.

## Status & deferred

Implemented: the full attestation model, signing/verification, controller-tracking chain verification with custody handover, an anchor-ready Merkle root, and a compiled `dist` build (ESM + `.d.ts`). Deferred by design: W3C Verifiable Credentials / GS1 EPCIS export adapters, public-ledger anchoring, and a Hypercore/Autobase substrate for the sovereign tier.

## License

Apache-2.0 © 2026 Piotr Dziubecki

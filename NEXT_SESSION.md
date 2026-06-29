# Next session — state & plan

_Last updated: 2026-06-11_

## Where this repo stands

`@symblon/core` **v0.3.0** — the pure provenance engine.

- **v0.3.0 (2026-06-11): derivation links** — agriculture backbone spec #1 shipped. Cross-chain transformation primitive (`derivedFrom`/`consumedIn` reserved claim keys + `attestationRef` + pure `verifyDerivation`), runnable `npm run example:agro`. Design: `docs/superpowers/specs/2026-06-11-agriculture-registry-backbone-design.md` (§7), plan: `docs/superpowers/plans/2026-06-11-derivation-links.md`. Tag + push `v0.3.0` pending.
- **v0.2.0: disclosure primitives** — field commitments + verifiable presentations.

- Complete and tested: **36 tests**, strict TypeScript clean (`npm run build`), runnable example (`npm run example`).
- Ships a compiled `dist` build (ESM `.js` + `.d.ts`) via `npm run build`; `exports`/`main`/`types` point at `dist/`.
- **Distribution = private git dependency** (tagged releases). Consumers install `github:zerostorypoints/symblon#v0.1.1`; `prepare` builds `dist` on install. No registry.
- **CI** runs typecheck + 36 tests + build on push/PR (GitHub Actions, Node 24) — green.
- **Extracted from the hifisync monorepo on 2026-06-03; the monorepo copy was removed.** This repo is now the single source of truth for the engine.
- **Not published** to any registry and **not wired** into any consumer (deliberate, this session).

## Why this exists (the big picture)

**hifipass** is a progressive-custody provenance product — custodial → self-sovereign, in the style of Privy's embedded wallets, with all cryptography hidden from users. Two products share this one engine:

- **hifipass** — provenance for hi-fi gear (consumer, Pro/Ultra subscription).
- a future **fruit / agriculture** passport — full-lifecycle traceability (B2B, EU-regulated).

The full design and the detailed implementation plans live in the **hifisync** repo (not here):

- Design: `docs/superpowers/specs/2026-06-03-hifipass-passport-core-design.md`
- Plan 1 — this engine (**DONE**): `docs/superpowers/plans/2026-06-03-passport-core-engine.md`
- Plan 2 — hifisync Phase 0 integration (**NOT STARTED**): `docs/superpowers/plans/2026-06-03-hifipass-phase0-custodial.md`

## Next session — prioritized

### 1. Distribution — unblocks every consumer
Other repos consume this engine, so decide and ship the distribution path:

- [x] **Compiled `dist` build** — `npm run build` emits ESM `dist/*.js` + `.d.ts`; `exports`/`main`/`types` point at `dist/`; `prepare` rebuilds (also enables git-dep installs). _(Done 2026-06-03.)_
- [x] **Distribution = private git dependency, tagged** _(decided 2026-06-03)_ — consumers install `github:zerostorypoints/symblon#v0.1.1`. GitHub Packages registry was declined (its scope-must-match-owner rule would force a rename to `@piotr-dziubecki/*` or a `hifipass` org); revisit only if a non-git consumer needs it.
- [x] **CI** — GitHub Actions runs typecheck + 36 tests + build on push/PR (Node 24). Green.

### 2. First consumer — hifisync Phase 0 (Plan 2)
- Lives in the **hifisync** repo, not here. Add this engine as a dependency — `"@symblon/core": "github:zerostorypoints/symblon#v0.1.1"` — replacing the old `@hifisync/passport-core` workspace package (now removed). Imports/API are identical.
- **Blocked on** account-model spec #1 (the `entitlements` table): Plan 2's Pro gate (`assertActivePro`) is fail-closed until entitlements exist. Build entitlements first.
- Then follow Plan 2: `passport_attestations` table + `device_passports` projection + platform-KMS `Signer` + Supabase `IntegritySubstrate` + Pro-gated mint/transfer.

### 3. Engine roadmap — deferred surface (build when a consumer needs it)
- [x] **Multi-input transformations (derivation links)** — shipped in v0.3.0 (agriculture backbone spec #1). Next agro step is spec #2: the agriculture registry on the SQL substrate (see the agriculture backbone spec §12 for the full sequence).
- [ ] **`toVerifiableCredential` / `toEpcisEvent`** export adapters — W3C VC / GS1 EPCIS, agro/retail-driven (EPCIS `TransformationEvent` maps 1:1 to derivation links). Note: food is outside the first ESPR/DPP wave — the regulatory anchor is Reg. 178/2002 Art. 18 (see agriculture backbone spec §1).
- [ ] **Public-ledger Merkle anchoring** — `computeMerkleRoot` already exists; add an anchor receipt + a verifier that proves "anchored before time T."
- [ ] **Hypercore / Autobase `IntegritySubstrate`** — for the sovereign tier (P2P) and the fruit project's multi-writer chains.

> **Storage substrates — specs written 2026-06-04** (in `docs/superpowers/specs/`). Turns the two storage bullets above into a concrete, sequenced workstream of reusable **engine-side** adapters behind the one `IntegritySubstrate` seam:
> - `2026-06-04-storage-substrates-overview.md` — **start here**: Phase 0 (harden `append` to an atomic head-CAS + a shared `@symblon/substrate-conformance` suite + in-memory reference adapter), packaging (npm-workspaces monorepo), and the build order. **Revises §2 below:** the Supabase substrate should be a reusable engine-side package, not hifisync-internal, now that symblon serves hifipass *and* agrocontracts.
> - `2026-06-04-substrate-sql.md` — Phase 1, Postgres/Supabase (custodial, ship first).
> - `2026-06-04-substrate-pear.md` — Phase 2, Hypercore/Autobase (sovereign P2P); read its §4 design risk first.
> - `2026-06-04-substrate-anchor.md` — Phase 3, public-ledger Merkle anchoring (add-on).
>
> Recommended next step: brainstorm → plan **Phase 0 + Phase 1** (contract + conformance + SQL adapter) — the minimum to put a product on real storage.

### 4. Custody ladder Phase 1 / 2 — the product headline (later, gated on mobile)
- **Phase 1** device-bound keys (secure enclave) + **assisted / MPC recovery** — recovery UX is the dominant work.
- **Phase 2** sovereign self-custody (Ultra tier) on a P2P substrate.
- The engine already supports the migration (`custody_change` event + controller tracking in `verifyChain`); these phases add `Signer` / `IntegritySubstrate` implementations and the recovery product — **not** engine rewrites.

## Housekeeping
- [ ] Remove the trivial `__tests__/smoke.test.ts` (a scaffold artifact).
- [x] **Renamed `@hifipass/passport-core` → `@symblon/core`** (2026-06-03) — domain-neutral, ownable brand (`symblon.com` + npm `@symblon` free; the split-token *symbolon* metaphor fits two-party transfer / commitment-opening match). GitHub repo `hifipass` → `symblon`; frees the name "hifipass" for the hi-fi **registry product**.
- [x] **License = Apache-2.0** (2026-06-03) — switched from MIT for the explicit patent grant; `LICENSE` is the canonical Apache-2.0 text.
- [x] **Placed under the `zerostorypoints` GitHub org** (2026-06-03) — `zerostorypoints/symblon`, part of the zerostorypoints.com product portfolio. `main` + tags (`v0.1.0`/`v0.1.1`/`v0.2.0`) pushed; repo still **private**.
- [ ] **Open-source the core** — flip `zerostorypoints/symblon` public, claim the npm org `@symblon`, then `npm publish --access public @symblon/core`. (CI/Actions are free for public org repos; no Vercel involved — the engine is a library.)

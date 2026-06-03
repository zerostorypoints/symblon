# Next session — state & plan

_Last updated: 2026-06-03_

## Where this repo stands

`@hifipass/passport-core` **v0.1.0** — the pure provenance engine.

- Complete and tested: **36 tests**, strict TypeScript clean (`npm run build`), runnable example (`npm run example`).
- Ships a compiled `dist` build (ESM `.js` + `.d.ts`) via `npm run build`; `exports`/`main`/`types` point at `dist/`. **Not yet published** to a registry.
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

- [x] **Compiled `dist` build** — `npm run build` emits ESM `dist/*.js` + `.d.ts`; `exports`/`main`/`types` point at `dist/`; `prepublishOnly` rebuilds. _(Done 2026-06-03.)_
- [ ] **Publish `@hifipass/passport-core` privately** — GitHub Packages (same account) or a private npm scope — **or** consume via git URL. Pick one; document the install command.
- [ ] **Add CI** — a GitHub Action running `npm test` + `npm run build` on push/PR.

### 2. First consumer — hifisync Phase 0 (Plan 2)
- Lives in the **hifisync** repo, not here. It imports this engine via the distribution chosen in step 1 (replacing the old `@hifisync/passport-core` workspace package, now removed).
- **Blocked on** account-model spec #1 (the `entitlements` table): Plan 2's Pro gate (`assertActivePro`) is fail-closed until entitlements exist. Build entitlements first.
- Then follow Plan 2: `passport_attestations` table + `device_passports` projection + platform-KMS `Signer` + Supabase `IntegritySubstrate` + Pro-gated mint/transfer.

### 3. Engine roadmap — deferred surface (build when a consumer needs it)
- [ ] **`toVerifiableCredential` / `toEpcisEvent`** export adapters — W3C VC / GS1 EPCIS for EU Digital Product Passport compliance (fruit-driven).
- [ ] **Public-ledger Merkle anchoring** — `computeMerkleRoot` already exists; add an anchor receipt + a verifier that proves "anchored before time T."
- [ ] **Hypercore / Autobase `IntegritySubstrate`** — for the sovereign tier (P2P) and the fruit project's multi-writer chains.

### 4. Custody ladder Phase 1 / 2 — the product headline (later, gated on mobile)
- **Phase 1** device-bound keys (secure enclave) + **assisted / MPC recovery** — recovery UX is the dominant work.
- **Phase 2** sovereign self-custody (Ultra tier) on a P2P substrate.
- The engine already supports the migration (`custody_change` event + controller tracking in `verifyChain`); these phases add `Signer` / `IntegritySubstrate` implementations and the recovery product — **not** engine rewrites.

## Housekeeping
- [ ] Remove the trivial `__tests__/smoke.test.ts` (a scaffold artifact).
- [ ] Decide whether to rename to a **domain-neutral** scope (e.g. `@provenance/passport-core`) before publishing, so the fruit project doesn't import a hi-fi-flavored package name.

# Prompt: agropass showcase for symblon-web

> Self-contained prompt for a session in `/Users/piotrdziubecki/Projects/symblon-web`.
> Written 2026-06-11 in the symblon repo, right after `@symblon/core` v0.3.0 (derivation links) was implemented.

---

Build an **alternative showcase** for symblon.com: an **agropass scenario** (fruit-batch traceability) alongside the existing hifipass-flavored demo, running the **real `@symblon/core` engine** client-side like the current one does.

## Context you need

- This repo (symblon-web) is the Astro marketing + live-demo site for the symblon provenance engine. The current demo is a seven-step hi-fi passport scenario: `src/demo/scenario.ts` (framework-agnostic, unit-tested) rendered by the lazy-hydrated Svelte island `src/islands/Demo.svelte`, styled by the "Schematic Terminal" design system (`src/styles/global.css`; steel ground + grid, cyan = structure, green = verified). Read `docs/superpowers/specs/2026-06-04-symblon-web-design.md` first and mirror its conventions.
- The engine gained a new primitive in **v0.3.0: derivation links** — cross-chain transformations (N input subjects → 1 output subject). New exports: `TRANSFORMATION`, `attestationRef`, `parseDerivedFrom`, `parseConsumedIn`, `verifyDerivation`. The canonical usage walkthrough is `examples/agro-batch.ts` in the engine repo (`github.com/zerostorypoints/symblon`) — copy its scenario shape, not its code style; this repo has its own harness (`src/demo/harness.ts`).
- The design rationale lives in the engine repo: `docs/superpowers/specs/2026-06-11-agropass-registry-backbone-design.md` (the agropass backbone, anchored on a real Polish soft-fruit producer's requirements). Skim §3 (batch subjects), §4 (event vocabulary), §5 (public vs committed fields), §7 (derivation links), §8 (three disclosure audiences) — the showcase should dramatize exactly those.
- **Prerequisite:** bump the engine dependency from `github:zerostorypoints/symblon#v0.2.0` to `#v0.3.0`. If the `v0.3.0` tag is not pushed yet, stop and ask before working around it.

## The story the showcase tells

A fruit producer's passport, batch-level, B2B-confidential. Suggested steps (adapt count/wording to the existing demo's step pattern):

1. **Delivery PZ-101** — raw blueberry batch arrives from a farm. Genesis `delivery_received` on subject `agro.batch / producer-77:1011125-09561`. Public claim: `{ species, origin: "PL", quality: "101" }`. **Committed** (salted hashes, never cleartext): supplier (`"Farm Kowalski, GGN …"`) and price (PLN/kg). Show the commitments as opaque hex next to the readable public fields — that contrast is the point.
2. **Delivery PZ-102** — second raw batch, different farm, different price.
3. **Transformation ZP-77** — production: a finished-good batch (`Borówka 250g KRAJ POCHODZENIA POLSKA`) is born. Its genesis claim carries `derivedFrom: [attestationRef(pz101head), attestationRef(pz102head)]`; then each raw chain appends a `TRANSFORMATION` attestation whose `consumedIn` pins the new genesis. Emphasize the ordering: genesis first, consumptions after — both halves hash-pinned, no circularity.
4. **Verify the lineage** — `verifyDerivation([fgChain], [[rawA…], [rawB…]], resolver)` → green. This is the new v0.3.0 primitive; make it the hero moment.
5. **Tamper** — silently upgrade one delivery's quality grade (claim edit), re-run `verifyDerivation` → red, with `inputSubjectId` naming the exact batch. The recall story: an auditor finds the lie in seconds.
6. **Auditor disclosure** — `buildPresentation`/`verifyPresentation` opening **only the price** of one raw batch; the supplier commitment stays closed. One primitive, field-level choice.
7. **Consumer view** — the public-tier projection (species, origin, quality, dates, lineage *shape*: "derived from 2 batches"), i.e. what a QR on the label resolves to. No keys, no openings.

## Requirements

- Keep the existing hi-fi demo fully working; the agropass scenario is an *alternative*, not a replacement. Choose the integration consciously (a scenario toggle inside the island vs. a second island/page section) — propose it during brainstorming and follow this repo's spec → plan → implement workflow (superpowers skills).
- The scenario must be a framework-agnostic module in `src/demo/` with unit tests mirroring the existing scenario's test style (vitest, real engine, deterministic — locked timestamp constants, no `Date.now()`).
- Match the Schematic Terminal design language; agro content may introduce its own accent only if the design system already supports it — don't invent a new palette ad hoc.
- Copy on the page should land the positioning from the agropass spec: the engine is the *trust layer under the producer's ERP* — "same engine, different domain" is the headline of this showcase (hi-fi: units + custody; agro: batches + transformations).
- Definition of done: `npm test` green (existing + new scenario tests), `npm run build` green, demo verified in the browser (`npm run dev`), both showcases reachable.

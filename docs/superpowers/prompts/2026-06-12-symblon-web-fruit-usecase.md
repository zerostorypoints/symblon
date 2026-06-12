# Prompt: fruit / agriculture use case for symblon-web

> Self-contained prompt for a session in `/Users/piotrdziubecki/Projects/symblon-web`.
> Written 2026-06-12 in the symblon engine repo, after `@symblon/core` v0.3.0 (derivation links) shipped.
> Supersedes `2026-06-11-symblon-web-agropass-showcase.md`.

---

Add the **fruit / agriculture use case** to symblon.com — the second proof that the engine is domain-neutral. Two deliverables: (A) a zero-JS **marketing section** telling the agropass story, and (B) an **interactive agropass demo scenario** running the real `@symblon/core` engine client-side, alongside the existing hi-fi demo. The headline of both: **same engine, different domain** — hi-fi is units + custody; agriculture is batches + transformations.

## Prerequisite — check before any work

The demo needs `@symblon/core` **v0.3.0** (it introduced derivation links). Check availability in this order:

1. `npm view @symblon/core version` → if `0.3.0`+, switch the dependency to `"@symblon/core": "^0.3.0"`.
2. Otherwise `git ls-remote https://github.com/zerostorypoints/symblon refs/tags/v0.3.0` → if present, bump the existing git dependency to `github:zerostorypoints/symblon#v0.3.0`.
3. If **neither** exists yet, STOP and ask — the release hasn't been pushed/published; don't work around it.

## Context you need

- **This repo (symblon-web)** is the Astro marketing + live-demo site for the symblon provenance engine. Current demo: a seven-step hi-fi passport scenario in `src/demo/scenario.ts` (framework-agnostic, unit-tested, deterministic — locked timestamp constants, no `Date.now()`), rendered by the lazy-hydrated Svelte island `src/islands/Demo.svelte`, with zero-JS marketing sections in `src/components/`. Design system: "Schematic Terminal" (`src/styles/global.css` — steel ground + grid; cyan = structure, green = verified). Read `docs/superpowers/specs/2026-06-04-symblon-web-design.md` first and mirror its conventions and copy voice.
- **The design source** is the agropass backbone spec in the engine repo (public): `docs/superpowers/specs/2026-06-11-agropass-registry-backbone-design.md` at `github.com/zerostorypoints/symblon` (locally: `/Users/piotrdziubecki/Projects/symblon`). The canonical engine-usage walkthrough is `examples/agro-batch.ts` there — copy its scenario shape, not its code style; this repo has its own harness (`src/demo/harness.ts`).

## The agropass model in brief (from the spec — the content both deliverables dramatize)

- **agropass is a trust layer under a fruit producer's ERP, not an ERP.** The ERP keeps stock, prices, planning; agropass receives five traceability moments — delivery receipt, quality inspection, transformation (production), dispatch, correction — and gives back lineage that buyers, auditors, and consumers can verify **without trusting the producer's database**. Anchored on a real Polish soft-fruit producer's requirements (blueberry / raspberry / strawberry).
- **Subjects are batches** (raw, finished, waste), keeping the producer's existing semantic batch codes.
- **Two data tiers:** public (species, variety, origin country, quality class, dates, lineage *shape*) vs **committed** salted-hash commitments (prices, supplier identity, weights) — B2B confidentiality is the producer's #1 sensitivity; a buyer who learns which farm supplied a batch can cut the producer out.
- **Derivation links (v0.3.0, the new primitive):** the finished batch's genesis claim carries `derivedFrom: [attestationRef(...)]` pinning the consumed input states; each input chain then appends a reserved `TRANSFORMATION` attestation whose `consumedIn` pins that genesis. `verifyDerivation(output, inputs, resolver)` checks both halves bidirectionally; failures name the offending input via `inputSubjectId`. New exports: `TRANSFORMATION`, `attestationRef`, `parseDerivedFrom`, `parseConsumedIn`, `verifyDerivation`.
- **Three disclosure audiences,** one primitive: buyer per shipment (origin + quality, prices/suppliers stay closed), auditor recall (EU food law Reg. 178/2002 Art. 18 — walk the lineage cone in minutes, open exactly the recalled scope), consumer QR (public tier only).

## Deliverable A — marketing use-case section

A zero-JS Astro section presenting the fruit use case next to the hi-fi one: the problem (recalls demand provable lineage; buyers and auditors must verify without trusting the producer; prices and farm identities must stay confidential), how the engine answers it (batch chains, derivation links, salted commitments + selective presentations), and the "same engine, two domains" framing. Keep the existing sections' tone and length discipline; this is a use case, not a whitepaper.

## Deliverable B — interactive demo scenario

A second scenario module in `src/demo/` (framework-agnostic, vitest-tested like the existing one). Suggested steps (adapt count/wording to the existing demo's step pattern):

1. **Delivery PZ-101** — raw blueberry batch genesis (`delivery_received`, subject like `agro.batch / producer-77:1011125-09561`). Public claim `{ species, origin: "PL", quality: "101" }`; **committed**: supplier ("Farm Kowalski, GGN …") and price (PLN/kg). Show commitments as opaque hex beside readable public fields — that contrast is the point.
2. **Delivery PZ-102** — second batch, different farm, different price.
3. **Transformation ZP-77** — finished batch (`Borówka 250g KRAJ POCHODZENIA POLSKA`) born: genesis with `derivedFrom` both deliveries, then `consumedIn` records appended to each raw chain. Emphasize the ordering (genesis first, consumptions after — both halves hash-pinned, no circularity).
4. **Verify lineage** — `verifyDerivation` → green. The v0.3.0 hero moment.
5. **Tamper** — silently upgrade one delivery's quality grade; re-verify → red, `inputSubjectId` names the exact batch. The recall story: the lie is found in seconds.
6. **Auditor disclosure** — presentation opening **only the price** of one batch; the supplier commitment stays closed.
7. **Consumer view** — the public-tier projection (species, origin, quality, dates, "derived from 2 batches"), i.e. what a QR on the label resolves to.

## Requirements

- The existing hi-fi demo keeps working untouched; the fruit scenario is an *addition*. Choose the integration consciously (scenario toggle inside the island vs. a second island/section) — propose it during brainstorming and follow this repo's spec → plan → implement workflow (superpowers skills).
- Deterministic scenario module + tests mirroring the existing scenario's style (real engine, locked timestamps).
- Match the Schematic Terminal design language; don't invent a new palette ad hoc.
- Definition of done: `npm test` green (existing + new), `npm run build` green, verified in the browser (`npm run dev`), both use cases reachable from the page.

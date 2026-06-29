# Prompt: agriculture use case for symblon-web (lineage + multi-actor disputes)

> Self-contained prompt for a fresh session in `/Users/piotrdziubecki/Projects/symblon-web`.
> Written 2026-06-28 in the symblon engine repo, after `@symblon/core` **v0.4.0** (cross-chain references + the `@symblon/agriculture` domain layer) shipped.
> **Supersedes** `2026-06-12-symblon-web-fruit-usecase.md` — that prompt covered derivation links only; this one adds the multi-actor **dispute / counter-claim** beat, which is the new headline.

---

Add the **agriculture (fruit) use case** to symblon.com — the second proof that the engine is domain-neutral. Two deliverables: (A) a zero-JS **marketing section** telling the agricultural-traceability story, and (B) an **interactive agriculture demo** running the real `@symblon/core` engine client-side, alongside the existing hi-fi demo. The headline: **same engine, different domain, and now multi-party trust** — hi-fi is units + custody; agriculture is batches + transformations **and disputes between actors who don't trust each other (or the operator).**

## Prerequisite — check before any work

The demo needs `@symblon/core` **v0.4.0** (cross-chain references). The repo currently pins `"@symblon/core": "github:zerostorypoints/symblon#v0.2.0"` — two releases behind. Check and bump:

1. `git ls-remote https://github.com/zerostorypoints/symblon refs/tags/v0.4.0` → if present (it should be), set the dependency to `"@symblon/core": "github:zerostorypoints/symblon#v0.4.0"` and reinstall.
2. If the tag is missing, STOP and ask — don't work around it.

> **`@symblon/agriculture` is a private, unpublished workspace package — you cannot install it.** It is the canonical *reference implementation* of the agriculture domain semantics (in the engine repo at `packages/agriculture/`). This repo's demo **reimplements those thin semantics on its own harness** using only `@symblon/core`, exactly as the existing hi-fi demo reimplements its scenario shape. Mirror the agriculture layer's logic; don't depend on the package.

## Context you need (this repo — symblon-web)

- Astro marketing + live-demo site for the symblon engine. Current demo: a hi-fi passport scenario in `src/demo/scenario.ts` (framework-agnostic, vitest-tested, deterministic — locked timestamp constants, no `Date.now()`), with `src/demo/harness.ts` + `src/demo/format.ts`, rendered by the lazy-hydrated Svelte island `src/islands/Demo.svelte` (helpers: `CheckRow.svelte`, `HashChip.svelte`, `JsonBlock.svelte`). Zero-JS marketing in `src/components/*.astro` (incl. `UseCases.astro`).
- Design system: **"Schematic Terminal"** (`src/styles/global.css` — steel ground + grid; cyan = structure, green = verified). Read `docs/superpowers/specs/2026-06-04-symblon-web-design.md` first and mirror its conventions and copy voice.
- **The design source** is the engine repo (public, `github.com/zerostorypoints/symblon`, locally `/Users/piotrdziubecki/Projects/symblon`):
  - Trust model (the dispute story): `docs/superpowers/specs/2026-06-26-agriculture-trust-model-design.md`
  - Backbone (batches, disclosure, derivation): `docs/superpowers/specs/2026-06-11-agriculture-registry-backbone-design.md`
  - Reference implementation to mirror: `packages/agriculture/src/` (`subjects.ts`, `dispute.ts`, `verify-dispute.ts`) + its tests (the end-to-end dispute scenario with a real custody handoff). Engine usage walkthroughs: `examples/agro-batch.ts` (derivation) and `examples/dispute.ts` (cross-chain reference).

## The agriculture model in brief (what the deliverables dramatize)

The agriculture registry is a **trust layer under a fruit producer's ERP, not an ERP.** The producer ships packaged crops (e.g. blueberries) to wholesalers/retailers; the agriculture registry makes the lineage and the disputes **tamper-evident and verifiable without trusting the producer's database — or the platform operator.** Anchored on a real Polish soft-fruit producer (agrocontracts is the prospect).

Two **chain roles**, both ordinary `@symblon/core` chains distinguished by subject scheme:
- **Lot chains** (`agriculture.lot`) — the goods, custody baton-passed grower → wholesaler → retailer via the engine's `custody_change`. One continuous track-and-trace timeline.
- **Party chains** (`agriculture.party`) — each actor's own sovereign ledger, where it records statements about chains it does not control.

Two **acts** the demo can dramatize (build both, or sequence — decide during brainstorming):

### Act 1 — lineage / transformation (v0.3.0 derivation links)
Batches (raw → finished → waste) keep the producer's semantic batch codes. The finished batch's genesis carries `derivedFrom: [attestationRef(...)]` pinning the consumed input states; each input chain appends a reserved `TRANSFORMATION` attestation whose `consumedIn` pins that genesis. `verifyDerivation(output, inputs, resolver)` checks both halves; failures name the offending input via `inputSubjectId`. Two data tiers: **public** (species, variety, origin country, quality class, dates, lineage *shape*) vs **committed** salted-hash commitments (prices, supplier identity, weights — B2B confidentiality is the producer's #1 sensitivity). Disclosure via `commitField`/`verifyOpening` + `buildPresentation`/`verifyPresentation`.

### Act 2 — multi-actor dispute (v0.4.0 cross-chain references) — THE NEW HEADLINE
When a wholesaler rejects a lot, the grower — no longer the lot's controller — **cannot edit the lot chain.** Instead the grower records a signed **counter-claim on its own party chain** that tamper-bindingly references the contested lot attestation (pinned by `payloadHash`). The lot chain is never mutated; the disagreement is a pinned cross-link. The operator cannot suppress it without a detectable signed gap on a chain the grower co-holds. This is the "place trust in our system" property: **the right to dispute is unconditional and not operator-revocable.** v1 is counter-claim-only — the system records the dispute, it does not adjudicate.

## Engine API (v0.4.0) — what the harness calls

- **Core, existing:** `buildAttestation`, `signAttestation`, `verifyChain`, `CUSTODY_CHANGE`, `commitField`, `verifyOpening`, `buildPresentation`, `verifyPresentation`.
- **Derivation (v0.3.0):** `TRANSFORMATION`, `attestationRef`, `parseDerivedFrom`, `parseConsumedIn`, `verifyDerivation`.
- **Cross-chain references (v0.4.0):** `reference(rel, target)`, `DISPUTES`, `parseReferences(claim)`, `verifyReference(referencing, target, resolver)`, `attestationRef`, `parseRef`, `type Reference`, `type AttestationRef`.
- **agriculture domain semantics to MIRROR in this repo's harness** (from `@symblon/agriculture`, which you can't import — copy the thin logic): `LOT_SCHEME = "agriculture.lot"`, `PARTY_SCHEME = "agriculture.party"`, `lotSubject(id)`, `partySubject(id)`, `COUNTER_CLAIM = "counter_claim"`, `disputeClaim(contested, note?)` → `{ note?, references: [reference(DISPUTES, contested)] }`, `verifyDispute(partyChain, lotChain, resolver)` (= scheme checks + a `disputes` ref exists + `verifyReference` passes), `disputedRefs(claim)`.

## Deliverable A — marketing use-case section

A zero-JS Astro section presenting the agriculture use case next to the hi-fi one: the problem (recalls demand provable lineage; buyers/auditors must verify without trusting the producer; prices and farm identities must stay confidential; **returns/quality disputes today happen over WhatsApp photos and paper, and any actor must be able to dispute tamper-proofly**), how the engine answers it (batch chains + derivation links, salted commitments + selective presentations, **sovereign party chains + tamper-binding counter-claims**), and the "same engine, two domains, multi-party trust" framing. Match the existing sections' tone and length discipline — a use case, not a whitepaper. Extend/repurpose `UseCases.astro`.

## Deliverable B — interactive demo scenario(s)

Framework-agnostic, vitest-tested module(s) in `src/demo/` (real engine, locked timestamps), integrated into `Demo.svelte`. Choose integration consciously (scenario toggle inside the island vs. a second island/section) — propose during brainstorming.

**Act 2 dispute scenario (the headline) — suggested beats** (adapt to the existing demo's step pattern):
1. **Harvest** — grower creates lot `agriculture.lot / BB-123` (`harvest`, public `{ species: "blueberry", origin: "PL" }`).
2. **Custody handoff** — `custody_change` hands the lot to the wholesaler (real baton-pass; the wholesaler becomes sole writer). Show the controller switch.
3. **Rejection** — wholesaler appends `quality_rejection` (`{ grade: "C", reason: "mold" }`) to the lot chain. Show that the grower can no longer write here.
4. **Counter-claim** — grower records `counter_claim` on its OWN party chain `agriculture.party / grower-7`, with `disputeClaim(rejection, "Lot was sound at dispatch…")` pinning the rejection by `payloadHash`. Two chains, side by side.
5. **Verify dispute** — `verifyDispute(partyChain, lotChain, resolver)` → green. The v0.4.0 hero moment: a tamper-proof, operator-unsuppressable dispute.
6. **Tamper** — silently alter the rejection's content (or re-point the reference); re-verify → red. The lie is caught.

**Act 1 lineage scenario** — keep/port the 7-step transformation scenario from the superseded `2026-06-12-symblon-web-fruit-usecase.md` (delivery PZ-101/102 → transformation ZP-77 with `derivedFrom`/`consumedIn` → `verifyDerivation` green → tamper → auditor price-only presentation → consumer public view). Build it too, or sequence after Act 2 — your call during brainstorming.

## Requirements

- The existing hi-fi demo keeps working untouched; the agriculture use case is an *addition*.
- Deterministic scenario module(s) + tests mirroring the existing scenario's style (real engine, locked timestamps; no `Date.now()`).
- Match the Schematic Terminal design language; don't invent a new palette ad hoc.
- Follow this repo's **spec → plan → implement** workflow (superpowers skills: brainstorming → writing-plans → subagent-driven-development).
- **Definition of done:** `npm test` green (existing + new), `npm run build` green, verified in the browser (`npm run dev`), both use cases reachable from the page.

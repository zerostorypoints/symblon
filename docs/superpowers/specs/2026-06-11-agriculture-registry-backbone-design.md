# Agriculture passport registry — backbone design

**Status:** Backbone design (decision doc). Defines the trust / identity / disclosure model for the fruit / agriculture passport registry sitting on `@symblon/core`. Sibling of the hifipass backbone (`2026-06-03-hifipass-passport-registry-backbone-design.md`), which named the agriculture registry as a placeholder (§2, §14); this document fills that placeholder. **No code this session.**
**Date:** 2026-06-11
**Author:** Claude + Piotr (brainstorm session)
**Spec type:** Trust / identity / registry backbone (multi-spec decomposition)
**Anchor case:** the Szulc fruit producer's ERP requirements workbook (`System Szulc_04_09.xlsx`, analyzed 2026-06-11) — a real soft-fruit processor (blueberry / raspberry / strawberry) speccing batch-level traceability from farm delivery to retail dispatch.

> **Naming.** Earlier notes (`NEXT_SESSION.md`, storage-substrates overview) once call this product "agrocontracts." This spec standardizes on **agriculture**, parallel to hifipass.

---

## 1. Context & problem

hifipass proved the engine's shape on consumer hi-fi: **unit-level subjects, custody-centric lifecycle** (mint → transfer → recover). Agriculture is the second registry and stresses the engine on the axes hi-fi doesn't: **batch-level subjects, transformation-centric lifecycle** (N raw batches are consumed to produce one finished batch), and **B2B confidentiality** (prices and supplier identities are commercially lethal if leaked, while origin and certification must be provable to outsiders).

The anchor evidence is the Szulc workbook. It is a requirements spec for a fruit ERP, and its traceability core asks — verbatim — for what a provenance chain provides:

- *"Musi być zachowana ciągłość informacji o surowcu pierwotnym"* — continuity of original raw-material information must be preserved (on returns/corrections).
- *"Możliwość śledzenia wstecz surowców z jakich powstała pierwotna produkcja"* — trace back the raw materials behind the original production.
- Batch barcodes assigned at delivery (raw), at production-order creation (finished goods — an explicit retail-customer requirement: the code must exist *before* production so it can be printed on labels during packing), and for waste (parent code + `O` suffix, e.g. `Borówka II 1230126130101O`).
- GlobalGAP numbers (GGN) per delivery; "KRAJ POCHODZENIA POLSKA" on labels.
- An entire permissions sheet dedicated to hiding purchase prices and profit by role, plus per-document toggles ("Cena na WZ TAK/NIE").

The regulatory driver is **EU General Food Law (Reg. 178/2002, Art. 18)**: every food business must trace one step up and one step down, and produce that trace on demand (recalls). Retail chains (Biedronka, Kaufland) and GlobalGAP audits enforce the same chain-of-custody in practice. Food is outside the first ESPR / Digital Product Passport wave, but the GS1 EPCIS / W3C VC export adapters (§11) keep the agriculture registry aligned with where EU product-passport infrastructure is heading.

**What no ERP can give them:** the trace lives in the producer's own database. A buyer, auditor, or regulator verifying a recall must trust that database. the agriculture registry makes the same lineage **tamper-evident and verifiable by outsiders without trusting the producer** — that is the product.

## 2. Architecture — the layers

| Layer | What it is | Owns |
|---|---|---|
| **Core engine** (`@symblon/core`, this repo) | Domain-neutral provenance primitives | chains, signing, verification, custody, commitments, presentations, **derivation links (new, §7)** |
| **agriculture — the registry** | The agriculture passport: registry backend + public API + MCP | chains + public projections + commitments, the batch lookup service, the product/quality catalog, EPCIS/VC export |
| **Producer's ERP — the writer** | The producer's operational system (the thing the Szulc workbook is speccing) | all operations data (stock, prices, planning, costing); integrates the agriculture registry at the five traceability moments (§4) |
| **Verifiers** | Buyers, GlobalGAP/organic auditors, regulators, consumers | nothing — they verify presentations and public lookups |

Load-bearing rules:

- **The agriculture registry is a trust layer under the ERP, not an ERP.** The Szulc workbook is ~80% operations and finance (warehouses, costing, planning, accounting, alerts, packaging balances). All of that stays in the ERP, permanently. The agriculture registry receives only the five traceability events and gives back provable lineage. This was a conscious positioning decision (vs. agriculture-as-traceability-app, and vs. a dispatch-time snapshot gateway — rejected because a snapshot is self-reported, not chained).
- **The reuse lives in the core** (hifipass rule, inherited). The one new engine primitive (§7) must pass the *"core primitive, or domain concern?"* test — it does: derivation is "this subject was produced from those subjects," which hi-fi needs too (refurbishment, component builds).
- **The registry never holds private values or keys** (hifipass §3, inherited verbatim). Safe to publish, replicate, anchor.

## 3. Subjects & anchors — the batch model

The subject is a **batch**, in three flavors, all sharing one chain shape:

- **Raw batch** — born at farm delivery (the PZ moment). Genesis attestation = `delivery_received`.
- **Finished-good batch** — born at production-order creation (the ZP moment), *before* production runs (the retail labeling requirement above). Genesis = the output half of a `transformation` (§7).
- **Derived waste batch** — class-II material weighed after production, keeping parent lineage (the `O`-suffix codes). Genesis = a `transformation` output whose input is the parent batch.

**Anchor** = `hash(producer_id ‖ batch_code)`. Producers keep their existing semantic batch codes (Szulc's are date + quality code + variables) — no renumbering; the producer namespace prevents cross-producer collisions. The raw batch code is printed on pallet cards and labels, so lookup works exactly like hifipass's VIN service: present a batch code → get the public summary (§5), rate-limited.

Above batches sits a small **catalog** (the analog of hifipass's product catalog): species, variety, and the producer's quality-code vocabulary (e.g. Szulc's `101` = blueberry/market/red … `303` = strawberry/VIP/green). Catalog entries are public; they make public projections meaningful without exposing any per-batch sensitive data.

## 4. Event vocabulary — the domain schema

Five traceability moments, each an attestation type (engine treats them as opaque domain types; only `transformation` carries engine-recognized link structure):

| agriculture event | Szulc document | Claim payload (illustrative) | Commitments (typical) |
|---|---|---|---|
| `delivery_received` | PZ (przyjęcie) | species, variety, quality code, origin country, GGN, delivery date/time, packaging type | supplier identity, purchase price, physical & documented weights, delivery-doc set (WZ/CMR/FV/RR refs) |
| `quality_inspection` | protokół kontroli | quality color code, inspection date | waste % (planned/measured), inspector |
| `transformation` | ZP (zlecenie produkcyjne) | output product, packaging recipe ref, production date; **derivation links per §7** | quantities consumed/produced per input, labor data |
| `dispatch` | WZ + CMR | destination type, dispatch date, pallet list | buyer identity, sale price, vehicle/driver, CMR number |
| `correction` | WZK / zwroty / reklamacje | what is corrected (qty/price/return), reference to the corrected attestation | corrected values |

Corrections are **appends, never edits** — the Szulc requirement that returned goods re-enter stock *with original-batch continuity preserved* is exactly the append-only chain property; a return is a `correction` on the finished batch plus (if rematerialized as raw input) a `transformation` deriving a new batch from it.

Quality color codes, waste percentages, and document checklists are **claims**, not engine concepts. The engine never computes mass balance or waste math (§7).

## 5. The two data tiers

**Public tier** — cleartext on the registry, look-up-able by anyone with a batch code:

- batch exists for `(producer, batch code)`, species, variety, **country of origin**, quality class, key dates (delivery / production / dispatch), certifications (**GGN — public by producer policy, committed otherwise**; GGN already appears on retail labels in practice), **lineage shape** (this finished batch derives from N raw batches; this raw batch fed M productions — counts and dates, not contents), assurance level.
- PII-free and commercially inert by construction. Like hifipass's VIN tier, quasi-enumerability is accepted.

**Sensitive tier** — salted commitments only; openings live with the producer (custodial: in the agriculture registry's custody service on the producer's behalf, Phase 0):

- **prices** (purchase and sale — the producer's #1 stated sensitivity),
- **supplier identity** (a buyer who can read which farm supplied a batch can disintermediate the producer),
- weights and quantities, waste percentages, labor/cost data, buyer identity on dispatches, internal product descriptors (Szulc's "cecha" — explicitly "internal use, never on external documents"),
- delivery-document references (invoice numbers, CMR numbers).

The hifipass §3 rationale is inherited unchanged: only commitments make the registry safe to publish, replicate P2P, or anchor.

## 6. Identity, custody & assurance

- **Producer = a reusable identity key**, custodial in Phase 0 (the agriculture registry operator holds it, Privy-style; the producer's ERP calls the signing API). Same custody ladder as hifipass: the key can later migrate to producer-held infrastructure via `custody_change` with no chain rewrite.
- **Farms/suppliers start as attested data, not key-holders.** Szulc's Kontrahenci records become committed supplier fields in `delivery_received` claims. The ladder is open: a farm that adopts a key can **countersign** its deliveries, raising assurance — without re-architecting anything.
- **Dispatch is an event, not a custody change** in v1. The buyer receives goods and a verifiable presentation (§8), not control of the passport; the chain stays producer-curated. Multi-organization custody (buyer appends their own cold-chain / shelf events) is the N-party, multi-writer future — explicitly deferred (§10), and the reason the hifipass backbone's open question about "N-party, not two-party, handover" stays open rather than blocking v1.
- **Assurance vocabulary** (domain-owned, engine-opaque, parallel to hifipass's self/receipt/channel):
  - `self` — producer's own record, no supporting evidence committed.
  - `documented` — delivery-document set (WZ/CMR/FV/RR) committed into the attestation; an auditor can demand openings.
  - `countersigned` — the farm's own key co-signs the delivery. Gold tier; upgrades automatically as farms onboard.

## 7. Transformation — the derivation-link engine extension

The one new engine primitive. Today the chain is linear per subject; fruit production is a DAG: one ZP consumes several raw batches and produces one finished batch; one raw batch feeds several ZPs.

**Shape (design level):**

- The output batch's genesis attestation carries `derivedFrom: [{subject, attestationId, payloadHash}, …]` — one entry per input batch, pointing at a specific attestation on each input chain.
- Each input chain gets a `transformation` attestation appended carrying `consumedIn: {subject, attestationId}` pointing back at the output genesis.
- These links are **engine-recognized structure** (like `custody_change`), not opaque claim content.
- A new pure verifier — `verifyDerivation(outputChain, inputChains[])` — checks: every `derivedFrom` entry resolves to a real, verifying input chain containing the matching `consumedIn` half with matching hashes; both chains independently verify. No I/O; all chains passed in, like keys are today.

**What the engine does *not* do:** quantity conservation. Consumed/produced kilograms are committed fields on the transformation attestations; **mass-balance checking is registry-layer analytics** (and an auditor-scope disclosure, §8). This keeps the engine pure and keeps quantities private by default.

**Concurrency note:** several ZPs consuming one raw batch means several appends contending for that chain's head. This is exactly the atomic head compare-and-set hardening from the storage-substrates Phase 0 spec (`2026-06-04-storage-substrates-overview.md`) — the agriculture registry is the consumer that makes it non-optional.

**Domain-neutrality check:** "subject produced from subjects" serves hi-fi too (a refurbished unit derived from a donor unit; an amplifier built from serialized modules). It belongs in the core.

## 8. Selective disclosure — one primitive, three audiences

The v0.2.0 commitments + verifiable presentations ship unchanged; the agriculture registry defines the disclosure *policies*:

1. **Buyer, per shipment** — a WZ-scoped presentation: origin, variety, quality class, GGN, lineage shape, dispatch facts. Prices, supplier identities, and other batches' data stay committed. This is Szulc's "Cena na WZ TAK/NIE" toggle and role-based price hiding, done cryptographically instead of by UI permissions — and it works on parties *outside* the producer's systems.
2. **Auditor / recall** — the killer flow. Given a finished batch (or a customer complaint on a dispatched lot), the lineage cone is walked via derivation links and the producer (or its custodian, under regulatory duty) opens the relevant fields — suppliers, weights, documents — for exactly that cone. Art. 18's "produce the trace on demand" becomes minutes, verifiable, and scoped: the auditor sees the recalled cone, not the whole book of business. Mass-balance verification happens here, on opened quantities.
3. **Consumer, via QR** — the pallet-card / label barcode resolves to the public tier only: fruit, variety, Polish origin, certification, "harvested → packed" dates. No openings, no trust decisions.

## 9. Trust model & progression

Inherited from hifipass §13: **operator-trusted now, verifiable-ready always.** Phase 0 buyers trust the registry operator's lookup site to render lookups and verify presentations (Carfax-style). Because commitments and signatures are real from day one, the same bundles become self-verifiable by any third party with zero trust in the operator as keys move to producers (and eventually farms). No migration.

## 10. Scope / deferred

- **ERP territory — permanently out:** stock levels, reservations, production planning, costing/budgets, accounting reconciliation, packaging/pallet balance bookkeeping, alerting, order management. (The bulk of the Szulc workbook.)
- **Multi-organization custody / N-party chains** — buyer-side events (cold chain, shelf), farm-written chains; needs the multi-writer substrate (Hypercore/Autobase, Phase 2 of the substrates roadmap). Deferred.
- **Pallet-level subjects** — v1 models pallets as claim data on `dispatch` (pallet lists); promoting pallets/cartons to subjects (GS1 SSCC-style aggregation) is deferred until a buyer requires it.
- **Farmer self-custody & countersigning UX** — the ladder supports it; the product work is deferred.
- **Public-ledger anchoring** — notary only, per the substrate-anchor spec. Deferred.
- **Marketplace / commercial features** — out, same as hifipass.

## 11. Mapping to the Szulc requirements (anchor case)

| Szulc concept | agriculture primitive |
|---|---|
| Partia / kod kreskowy (batch barcode at delivery) | subject anchor `hash(producer ‖ batch_code)`, genesis `delivery_received` |
| PZ receipt (supplier, GGN, weights, doc checklist) | `delivery_received` claim + commitments; doc set drives `documented` assurance |
| Kontrola jakości (color codes 101–303, waste %) | `quality_inspection`; quality vocabulary in the catalog |
| ZP (input barcodes → output barcode, code exists pre-production) | `transformation` with derivation links; output genesis at ZP creation |
| Odpad with `O` suffix keeping parent code | derived waste batch — `transformation` from parent |
| WZ + CMR (buyer, vehicle, driver) | `dispatch`; buyer/logistics committed |
| WZK / zwroty with original-batch continuity | `correction` appends + re-derivation; append-only chain gives continuity for free |
| Uprawnienia sheet (hide prices/profit by role); "Cena na WZ TAK/NIE" | commitments + per-presentation disclosure choice (§8) |
| Global GAP GGN field | certification claim, public by producer policy |
| Karta paletowa (pallet card with barcode) | the QR/lookup entry point to the public tier |
| Raport Szefa / surowce-przetworzenie reports (full forward/backward trace) | lineage-cone walks over derivation links (the verifiable version) |
| Stock, costing, planning, budgets, alerts, packaging balances | **stays in the ERP** — out of scope by design |

## 12. Decomposition into specs (suggested order)

1. **Engine: derivation links** (§7) — the `derivedFrom`/`consumedIn` structure + `verifyDerivation`. *Depends on nothing; unblocks everything agro.*
2. **agriculture registry + batch lookup** — chains on the SQL substrate (substrates Phase 0 + 1 are prerequisites), public projections, catalog, rate-limited lookup API/MCP. *Depends on #1 and the substrate specs.*
3. **Writer API + Szulc pilot mapping** — the five-moment ingestion API, custodial signing, the PZ/ZP/WZ field mapping (§11). *Depends on #2.*
4. **Disclosure & verifier UX** — buyer presentation pages, auditor lineage-cone walk + openings, consumer QR page. *Depends on #2 (presentations already shipped in core v0.2.0).*
5. **EPCIS / VC export adapters** — `toEpcisEvent` (ObjectEvent/TransformationEvent/AggregationEvent), `toVerifiableCredential`. *Depends on #1; build when a consumer (retailer/regulator) asks.*

## 13. Open questions / risks

- **Batch-code semantics leak.** Producers' semantic codes (date + quality + "variables") may encode supplier numbers; anchors don't hide a code that is printed on the label. Pilot guidance: keep supplier-identifying components out of printed batch codes, or accept the leak knowingly.
- **GDPR on farms.** Many suppliers are natural persons (RR invoices). Supplier identity is committed, but openings + the supplier registry are PII in custody; deletion must destroy openings while chains stay verifiable (commitments remain). Same posture as hifipass §16, sharper here because supplier data is core, not edge.
- **Quantity privacy vs. mass balance.** Auditors verify kg conservation from opened commitments (§8); a dishonest producer could commit false quantities at write time. The chain proves *consistency and timing*, not physical truth — assurance levels and countersigning are the mitigation, and this limit must be stated honestly in product material.
- **Derivation fan-out performance.** Recall cones over busy raw batches (one batch → dozens of ZPs → hundreds of dispatches) need the registry to index links; `verifyDerivation`'s all-chains-passed-in purity must not force verifiers to fetch the world. Likely answer: registry serves the cone, verifier checks it — same progressive-trust posture as everything else.
- **Head contention on hot chains** (§7) — confirm substrates Phase 0 CAS semantics are sufficient under concurrent ZP writes; if not, this feeds the multi-writer (Autobase) case.
- **EPCIS mapping fidelity** — EPCIS TransformationEvent matches §7 1:1, but class- vs instance-level identification (LGTIN vs GTIN+serial) needs a decision in spec #5.
- **Naming** — "agriculture" vs the older "agrocontracts" mention; settle before anything public.

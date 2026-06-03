# HiFiPass passport registry — backbone design

**Status:** Backbone design (decision doc). Defines the shared trust / identity / disclosure model that the user-facing passport flows sit on. Establishes engine extensions and supersedes the in-hifisync custodial passport model. **No code this session.**
**Date:** 2026-06-03
**Author:** Claude + Piotr (brainstorm session)
**Spec type:** Trust / identity / registry backbone (multi-spec decomposition)

---

## 1. Context & problem

`@hifipass/passport-core` is a pure provenance engine: signed, hash-linked, append-only attestation chains per subject, with custody handover (`custody_change` + controller tracking), an `assurance` field, and a dormant Merkle root. It is domain-neutral by design.

We want a set of **user-facing passport scenarios** to sit on top of that engine:

1. **Browse the registry** — anyone can look up a unit, but sees only non-sensitive fields.
2. **Owner discloses full details** — selectively, under their own key.
3. **Prove current ownership to a buyer** — a short-lived, VIN-checker-style link.
4. **Transfer to a new owner** — owner-initiated, buyer must accept.
5. **Recovery** — hifisync as custodian helps a user who lost access.
6. **First registration** — by a manufacturer / distributor / retailer, or self.

These six are distinct flows over a **shared backbone**: who an owner is, what is public vs private, how ownership is proven, how custody moves, and how recovery works. This document defines that backbone. Each individual flow gets its own implementation spec later.

This design **consciously evolves** the existing hifisync account/actor model (in the **`hifisync` repo**: `docs/superpowers/specs/2026-06-01-account-actor-model-design.md`, §7 + §9). That spec modelled passports as a simpler **Phase-0 custodial table set** inside hifisync's own DB (`device_passports`, `passport_transfers`) and explicitly **deferred** the hard parts to its "spec #9" (§12: *one passport per physical unit, raw-vs-hashed serial, ownership-dispute / conflicting-claim resolution*). This backbone **resolves those deferred questions** and lifts the passport out of hifisync into a standalone registry. The mapping is in §12; the supersession is deliberate and was confirmed with the user.

## 2. Architecture — the layers

| Layer | What it is | Owns |
|---|---|---|
| **Core engine** (`passport-core`, this repo) | Domain-neutral provenance primitives | chains, signing, verification, custody handover, commitments, presentations, recovery semantics |
| **hifipass — the registry** | The *hi-fi* passport: registry backend + public API + MCP, built on the engine | the public projection + commitments, the VIN-like lookup service, anchoring |
| **agropass — a sibling registry** | A *fruit / agriculture* passport on the same engine | its own registry + domain schema (out of scope here; named so the backbone stays reusable) |
| **hifisync — the app + custodian** | The hi-fi consumer app, tightly integrated with hifipass | owner accounts, key custody + signing, **private field values**, the key↔person map, recovery custodianship, all owner UX |

Load-bearing rules that fall out:

- **The reuse lives in the core, not in hifipass.** hifipass is hi-fi-specific; agropass is the parallel proof that the engine is the general-purpose part. Every backbone decision is tested against *"core primitive, or domain concern?"* and pushed as low as it can go, so agropass inherits it.
- **hifipass is a neutral, multi-writer registry**, not "hifisync's backend exposed." Manufacturers / distributors / retailers are B2B actors who will never be hifisync consumer-app users; they integrate hifipass directly via its API/MCP. hifisync is the first privileged client, not the only one.
- **The registry never holds private values or keys.** See §3 — this is forced by the substrate ambition, not a preference.

## 3. The two data tiers (the public/private split)

Every passport's data is split into two tiers, and *which tier a field lives in is the whole privacy model.*

**VIN-grade public tier** — stored in cleartext on the registry, look-up-able by anyone with the serial:
- passport exists for `(product, serial)`, product **model**, **purchase year**, current **owner pseudonym key**, **number of transfers**, **assurance level**, public **timeline** (mint + transfer dates).
- None of this is PII. Like a VIN, it being semi-public — even enumerable in the worst case — is acceptable.

**Sensitive tier** — stored on the registry only as **commitments** (salted hashes); raw values live in custody (hifisync):
- raw serial, the owner's real identity (the key↔person map), receipts, service history, price, invoices, anything personal.

**Why commitments, not access-controlled cleartext:** the registry must be safe to make public, replicate (P2P), or anchor to a ledger. You cannot put private values or PII on a public/immutable substrate. So a general-purpose registry can *only* ever hold opaque chains + public projections + commitments. This is robust even if hifipass stays a centralized service forever, and mandatory if it ever decentralizes. The "manufacturer-seeded secret" idea (an earlier option) was only ever protecting the *anchor* from enumeration; once privacy lives entirely in this committed tier, we no longer need it (see §5).

## 4. Identity — a reusable pseudonymous key

An owner is a **persistent identity = one reusable keypair** they sign with across many passports (wallet-like). The registry's notion of "current owner" is the **current controller public key** the engine already tracks; it is pseudonymous. hifisync privately maps that key ↔ a real account.

- **Custody climbs, identity stays.** In Phase 0 (custodial) hifisync holds the key *for* the owner (platform KMS, crypto hidden — Privy-style). As the owner climbs the custody ladder the *same identity key* migrates to their own device — same public key, custody just changes hands. (The engine already supports this migration; no rewrite.)
- **Accepted cost — public correlation.** Because one key signs many passports, a registry reader can see "these items share one owner" (pseudonymous, like an Ethereum address holding several NFTs). Not *who*, just *same someone*. This was a conscious choice in favour of a reusable identity; the alternative (per-passport keys) was rejected.
- **Payoff — recovery and collection.** One identity means "your collection" is natural, and recovering one key restores the **whole collection** at once (see §10). The reusable-identity choice actively simplifies recovery.

## 5. The anchor, the catalog, and the VIN lookup service

**Two levels.** *product id* = the catalog model/SKU (shared across all units of a model); *serial* = the specific unit. A passport is about a **unit = (product id, serial)**. So there is a small **product catalog** (models, registerable by manufacturers) above **units** (the passport subjects).

**The anchor is a commitment derived from the unit.** The subject id = `hash(product_id ‖ serial)` (the engine README already gestures at this: `amp-h120:<hashed-serial>`). The raw serial lives in custody and is revealed by disclosure (§9). The public "unit identifier" shown in browse is a non-sensitive reference (model + a public passport id), never the raw serial.

**Lookup is a VIN-like service — no manufacturer cooperation required.** We cannot change manufacturer behaviour, so discovery must work off `(product id + serial)` alone, exactly like punching a VIN into Carfax. hifipass.com exposes a rate-limited lookup API/MCP: present a serial → get the public summary. We accept that low-entropy serials make the public tier quasi-enumerable; that is fine because the public tier is PII-free by construction (§3).

**The anchor makes registration idempotent.** Because the subject id is deterministic from `(product, serial)`, *registration and "reuse from custody" are the same operation — mint-or-claim on the anchor:*
- compute the anchor, look it up;
- **doesn't exist** → mint genesis;
- **already exists** (e.g. manufacturer pre-registered it, or it sits in escrow) → the user **claims** it, never duplicates.
- **One physical unit ⇒ exactly one passport, ever.** (This is hifisync §12's deferred "serial dedupe," resolved.)

**Decentralization stays a notary, not a requirement.** The lookup is an operator-run service. If a ledger ever enters, it only **anchors the Merkle root** for tamper-evidence (the engine's dormant `computeMerkleRoot` is exactly that hook). Lookup stays a service; the chain is just a notary.

## 6. Registration & assurance

First registration is a `mint` (genesis attestation). **Authenticity is layered via the engine's `assurance` field**, because a plain serial can be cloned and the registry cannot cryptographically prove genuineness on its own:

- `self` — owner self-registers. Lowest assurance. The system works at this level today, with zero third-party integration.
- `receipt` — backed by a proof-of-purchase (receipt scan; a moderation-queue item in hifisync; receipt images are PII → GDPR handling).
- `channel` — minted with a distributor/manufacturer code, or a manufacturer's own genesis attestation. Highest assurance, the gold tier — and it **upgrades automatically** if a manufacturer ever opts in.

The firewall from hifisync §2/§5 holds: **assurance = certainty of ownership/authenticity, never device quality.**

## 7. Transfer — two-party, with a custody fallback

Only the current owner can hand a passport on — that is `custody_change` signed by the outgoing controller, which the engine already enforces (it rejects anyone else with `controller-key-mismatch`). Prior owners **stay in the record** because the chain is append-only; that history is a feature (a buyer sees "3 owners, last transfer 2024-08," like a VIN history, while the people behind the keys stay private).

Transfer has **three outcomes**:

1. **Accept (happy path)** — seller **proposes** a transfer to the buyer's identity key; it takes effect only once the buyer **signs acceptance**. This two-party handshake prevents handing a passport to a wrong/dead key or spamming someone with unwanted items. *(New engine primitive — see §11; the engine's `custody_change` is one-sided today.)*
2. **Decline / no-show → release to custody** — the buyer won't or can't accept, but the seller still needs *off* the record (they sold the box). The seller **releases** the passport into **custodial / escrow** state; the owner is detached and the passport becomes "unclaimed." Mechanically this is a `custody_change` to an escrow key.
3. **Claim from custody** — later, the real holder proves possession (§8) and custody moves from escrow to them.

**The unification:** "unclaimed, held by a custodian" is the *same* state a passport sits in right after a manufacturer registers it and before the first owner claims it. So registration (§6), abandonment, and recovery (§10) all flow through one state, with different entry points. One primitive, not three.

**Escrow custody.** hifisync is **custodian-of-record** (single controller key, keeping the engine's single-controller model intact), but **release of an escrowed passport requires manufacturer co-approval for high-value items** — modelled as app-layer policy for v1 (hifisync only signs the release after the issuer co-approves), upgradeable to true on-chain multisig later. The manufacturer is exactly who can help verify possession on a claim.

**Pro-gating (from hifisync §7, refined).** The two **write** actions are gated; reads are always free and the record persists regardless of Pro:
- **mint = Pro**, **claim = Pro** — the sale funnels the buyer into Pro at claim time (new users get a trial; lapsed users resubscribe — "a month of Pro is trivial against device value").
- **release / transfer-out = free** — a lapsed owner who physically sold the box must still be able to release it (to the buyer or to escrow) without resubscribing, or we trap people and orphan devices. *(This refines the slightly ambiguous §7 wording.)*
- **Marketplace (listings / for-sale / discovery) is explicitly deferred** (hifisync §7/§11, "Guardrail 7" change). "Buy/sell" here means the ownership handover only.

## 8. Claim authorization — evidence, graded by assurance

Knowing a serial (from a photo or a listing) is *not* possessing the device, and we have no manufacturer-seeded secret to prove possession. So claiming an unclaimed/escrow passport is **adjudicated by the custodian on evidence**, and the strength of that evidence sets the passport's assurance level (§6):

- **Custodian-adjudicated evidence (baseline)** — claimant submits proof (receipt / photos / serial) to hifisync; hifisync (plus manufacturer co-approval for high-value, §7) approves and signs the release. Needs zero third-party integration. Routes through hifisync's existing `passport_attestation` moderation queue.
- **Receipt / retailer-anchored (upgrade)** — a verifiable purchase raises assurance to `receipt`/`channel` when available.
- **Challenge window (dispute backstop)** — a provisional claim opens a window in which a prior owner or rival claimant can contest, escalated to the custodian. *(This is hifisync §12's deferred "ownership-dispute / conflicting-claim resolution," resolved.)*

## 9. Selective disclosure & proof links — one verifiable presentation

"Owner discloses full details" (#2) and "short-lived VIN-check link" (#3) are **one primitive**: selective disclosure bound to a proof of *current* ownership.

- **At mint/update**, each private field is stored as a **salted commitment** `commit(field) = hash(value ‖ salt)` inside the signed attestation (tamper-evident, on-chain). The openings `(value, salt)` live in custody. The registry never sees raw values.
- **A proof link is a signed bundle** the owner generates: (a) the **openings** for the subset of fields they choose to reveal, and (b) a **signature by the current controller key** over `{anchor, nonce, expiry, disclosed openings}`.
- **Any verifier checks four things:** the signature is valid; that key is the **current head/controller** of the chain (current owner, not a past one); each opening hashes to the on-registry commitment; it hasn't expired.
- **Field-level granularity** — per-field commitments let the owner reveal exactly what they choose ("serial + service history, not price"). UX defaults to "reveal full details," with per-field opt-out. (Chosen over all-or-nothing.)
- **Progressive verification** — today the link opens a hifipass.com page that runs the check and renders the result (buyer trusts the operator, Carfax-style); later the *same* signed bundle is verifiable by any third party with **zero trust in hifipass**, because the commitments were embedded from day one. No rebuild.
- **Replay** — owner-generated + short expiry is the default (a leaked link works only until expiry). Buyer-supplied-nonce challenge-response is an available upgrade, not needed for v1.

This is the W3C "verifiable presentation" shape the engine's proof block already gestures at (`ed25519-jcs-2022`, "upgradeable to a full W3C cryptosuite").

## 10. Recovery — the custodian as a fenced guardian

The engine only lets the **current controller** sign a `custody_change`. Recovery means the owner *lost* that key, so by definition a **recovery authority** must move custody without it — and the same power could *steal* the passport. The design is therefore about **guardrails**.

- **Recovery policy** per identity: a set of guardians + a threshold. Default = `{hifisync}`, 1-of-1. Generalizes to social/MPC as k-of-n.
- **Recovery-authorized `custody_change`** — a guardian-signed controller rotation the engine accepts when the policy is satisfied: the one sanctioned exception to "only the current controller signs." *(New engine primitive — see §11.)*
- **Three non-negotiable guardrails:**
  1. **Identity verification** — the custodian confirms the account owner off-chain before acting.
  2. **Time-lock / notice window** — a recovery is announced and delayed (e.g. 7 days); if the old key resurfaces in that window it can **cancel**. This stops silent theft.
  3. **On-chain transparency** — the recovery is itself an append ("control rotated via recovery on date X, by guardian hifisync"). Append-only history makes a malicious recovery visible and provable.
- **Batched by identity** — one recovery re-binds the reusable identity key across *all* the owner's passports at once; the custodian holds the key↔account↔passports map, so it knows the set.
- **Phase-0 reality** — while hifisync *holds* the key (custodial), recovery is just **account recovery**: reauthenticate, regain the held key — no chain event. The guardian primitive sits dormant until self-custody, exactly like `custody_change` does today.
- **Sovereign upgrade** — multi-guardian / social (k-of-n: hifisync + manufacturer + a trusted contact) is the **Ultra / sovereign-tier** option, so the owner is not locked to hifisync forever. Deferred.

## 11. Engine extensions required (`passport-core`)

The backbone needs four additions to the pure engine, each domain-neutral so agropass inherits them:

1. **Two-party transfer** — a propose→accept pair where custody moves only when *both* the outgoing controller and the incoming key have signed. (Today `custody_change` is one-sided.)
2. **Recovery-authorized `custody_change`** — a controller rotation authorized by a passport's **recovery policy** (guardian set + threshold) instead of the current controller. Verification must understand the recovery policy and the guardian signatures.
3. **Field commitments** — helpers to commit `(value, salt)` → hash and to verify an opening against a commitment, plus a place in the attestation for the commitment set.
4. **Verifiable presentation** — build/verify a signed disclosure bundle (`{anchor, nonce, expiry, openings, controller signature}`) and check it against a chain's current head + the registry's commitments.

Everything else (escrow, claim adjudication, the VIN lookup service, Pro-gating, the product catalog) is **domain/registry/app concern**, not engine.

## 12. Mapping to — and supersession of — hifisync §9

This backbone is the natural resolution of what hifisync §12 left open for "spec #9." The concepts line up:

| This backbone | hifisync §9 |
|---|---|
| `assurance` (channel/receipt/self) | `attestation_level` (channel/receipt/self) — identical |
| Owner = reusable identity **key** | `current_owner_user_id` = the *custodial private mapping* of that key → user |
| Anchor `hash(product ‖ serial)`, one-per-unit | `serial` (raw or hashed) + "one passport per physical unit" (§12 deferred) |
| Append-only chain (`custody_change`) | `passport_transfers` append-only |
| Receipt-adjudicated claim | `passport_attestation` moderation queue (§6.2) |
| Two-party handshake + escrow + custodian-adjudicated claim | §12 deferred: "ownership-dispute / conflicting-claim resolution" |

**Three conscious evolutions beyond §9** (confirmed with the user):
1. **Owner = key, not a user FK** — the custody-ladder identity; the user FK becomes hifisync's private mapping.
2. **A separate hifipass registry** — vs passports living inside hifisync's DB.
3. **Public VIN lookup + selective disclosure + escrow** — none of which §9 has.

The design doc therefore **supersedes/extends** hifisync §9's passport rows; hifisync becomes a **client + custodian** of the hifipass registry rather than the passport's system of record. hifisync's `device_passports` / `passport_transfers` become a **custodial projection / read-model** over the registry chain (as NEXT_SESSION's Plan 2 already framed: "`passport_attestations` table + `device_passports` projection").

## 13. Trust model & progression

The whole backbone is **operator-trusted now, verifiable-ready always.** In the custodial phase the buyer trusts hifipass.com to render lookups, disclosures, and proof links correctly (Carfax-style). But because commitments are embedded from day one and the proof bundle is a real signed object, the *same data* becomes self-verifiable — by any third party, with zero trust in the operator — as keys move to users. No migration, no rebuild. This mirrors how the engine already shipped `custody_change` dormant, ready for the climb.

## 14. Scope / deferred

- **Marketplace** — listings / for-sale / discovery on passports (hifisync §7/§11; "Guardrail 7" change). Out.
- **agropass** — the sibling fruit registry; named here only to keep the backbone reusable. Its own spec cycle.
- **P2P / blockchain substrate** — only ever as a Merkle-root **notary**; the lookup stays an operator service.
- **Multi-guardian / MPC recovery** — sovereign / Ultra-tier upgrade (§10).
- **On-chain multisig escrow** — v1 uses app-layer manufacturer co-approval (§7).
- **W3C VC / GS1 EPCIS export adapters** — engine roadmap, build when a consumer needs it.
- **Buyer-challenge anti-replay** for proof links (§9) — upgrade, not v1.

## 15. Decomposition into specs (suggested order)

1. **Engine extensions** (§11) — field commitments + verifiable presentation first (pure, unblock disclosure), then two-party transfer, then recovery-authorized custody_change. *Depends on nothing.*
2. **hifipass registry + VIN lookup** — the public projection + commitment storage, the anchor, the rate-limited lookup API/MCP, the product catalog. *Depends on #1 (commitments).*
3. **Registration & mint-or-claim** — idempotent anchor flow, assurance levels, the manufacturer/retailer write path. *Depends on #1, #2.*
4. **Transfer + escrow + claim adjudication** — two-party handshake, release-to-custody, custodian-adjudicated claims, challenge window, Pro-gating. *Depends on #1, #2, #3, and hifisync entitlements.*
5. **Disclosure + proof links** — the verifiable-presentation UX, operator-rendered verifier page. *Depends on #1, #2.*
6. **Recovery** — recovery policy, guardian flow, time-lock + transparency; Phase-0 account-recovery realization. *Depends on #1, #2; gated on self-custody for the on-chain path.*

## 16. Open questions / risks

- **Salt management** — per-field salts must live in custody and survive recovery (they are part of the openings); losing salts makes commitments unopenable. Define storage + recovery of the opening set.
- **Anchor entropy** — `hash(product ‖ serial)` over low-entropy serials is offline-guessable if the public tier is ever fully replicated; acceptable because the tier is PII-free, but worth restating in the registry spec so it is a conscious posture, not an accident.
- **High-value threshold** — the manufacturer-co-approval-on-release rule (§7) needs a "high-value" definition and a fallback when the manufacturer is not integrated.
- **Time-lock UX** — a 7-day recovery notice window is safe but slow; define the channel that notifies a resurfaced key and the cancel path (§10).
- **Engine purity** — recovery policy + two-party transfer add state the verifier must track; confirm they stay expressible without breaking the engine's no-I/O, pure-function discipline (policies passed in, like keys are today).
- **agropass divergence** — confirm the four engine extensions are genuinely domain-neutral before agropass relies on them (e.g. multi-writer fruit chains may want N-party, not two-party, handover).
- **GDPR** — receipt/photo evidence (§8) and the key↔person map (§4) are PII in custody; deletion-on-account-delete must not break chain verifiability (commitments stay; openings are destroyed).

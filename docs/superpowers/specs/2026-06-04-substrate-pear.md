# `@symblon/substrate-pear` — Hypercore/Autobase IntegritySubstrate — design

**Status:** Design (decision doc). **Phase 2.** Depends on Phase 0. The genuinely novel adapter — read §4 (design risk) carefully.
**Date:** 2026-06-04
**Author:** Claude + Piotr (brainstorm, symblon-web session)
**Parent:** `2026-06-04-storage-substrates-overview.md`

---

## 1. Goal & trust model

The **sovereign / trustless** tier: no server. Each owner holds their chain in a peer-to-peer append-only log, replicated over the Holepunch/Pear stack. This is the "self-custody" endpoint of the custody ladder (NEXT_SESSION §4 Phase 2) and the multi-writer story for the agriculture project.

## 2. Building blocks (Holepunch / Pear)

- **Hypercore** — a single-writer, signed, append-only log. 1:1 with one owner's contiguous slice of a subject's chain.
- **Autobase** — linearizes multiple Hypercores (multiple writers) into one deterministic causal log. Needed because custody hands a subject from one owner-key to another over time → successive writers.
- **Hyperbee** — ordered key/value over a Hypercore; use for the `subject → autobase` index and for the key registry.
- **Hyperswarm / HyperDHT** — peer discovery + replication, keyed by a topic derived from the subject anchor.

## 3. Mapping `IntegritySubstrate` onto it

- A **passport = one Autobase** whose inputs are the successive controllers' Hypercores. Its discovery topic = `hash(subject)` (the subject anchor).
- `append(att)` → append to the **local writer's** Hypercore (the current controller's). Enforce head-CAS against the linearized head before writing.
- `readChain(subject)` → the Autobase **linearized view**, materialized as `Attestation[]` genesis→head.
- `head(subject)` → the linearized tip's `payloadHash` (or null).
- **Custody handover** = add the new owner's Hypercore as an Autobase writer, authorized by the outgoing controller's signed `custody_change` (which the engine already produces and `verifyChain` already validates). The Autobase "add-writer" is gated on that attestation.
- `PublicKeyResolver` → keys announced as records (in a Hyperbee or as the first record of each writer core); resolve by reading the replicated registry.

## 4. The central design risk — and why it's tractable

The engine expects a **strict linear chain** (`prevHash` links, one head). Autobase linearizes a **DAG** (concurrent writers). Naively these conflict.

**The resolving insight:** the engine rule *"only the current controller may sign the next link"* means that, in correct operation, **only one writer is ever the active appender at a time** — custody is strictly sequential. So there is no concurrent fork to resolve: the DAG is effectively a line. That demotes Autobase from "conflict resolver" to **"replication + writer-set-change transport"**:
- Normal appends: single active writer → linear, no merge.
- Handover: the writer set changes (old → new core), authorized on-chain.

**Therefore the plan should ENFORCE single-active-writer** rather than rely on Autobase to merge forks: reject (don't auto-merge) any linearization that isn't a single `prevHash` line, and surface it as a `HeadConflictError`/`forked-chain` error. A genuine fork then means misbehavior (a key signed two next-links) — which is exactly a fault the system should *detect*, not silently merge.

**Open design questions to settle in the Phase-2 plan:**
1. Does Autobase's deterministic linearization, constrained to single-active-writer, always reproduce the engine's `prevHash` order? (Prototype + property-test against the conformance suite.)
2. Offline/partition: an owner appends offline, then re-syncs — does head-CAS at merge time correctly reject a stale branch? (Should, by the same rule.)
3. Bootstrapping trust: how a fresh peer discovers the *genuine* genesis core for a subject (DHT topic = `hash(subject)`, but multiple cores could claim it — genesis signer + key registry disambiguate).
4. Key custody on-device (secure enclave `Signer`) — interplay with Phase-1/2 of the custody ladder.

## 5. Testing
- Pass `@symblon/substrate-conformance` over an in-process multi-peer harness (two Hypercores + an Autobase).
- Add P2P-specific tests: replicate across two peers; perform a custody handover (add writer); assert the linearized chain `verifyChain`-clean on both peers; assert a forged second-next-link is rejected as a fork.

## 6. Scope / non-goals
- No engine changes (the single-active-writer rule is already the engine's behavior; this adapter *enforces* it on the P2P side).
- Recovery (k-of-n guardians, time-locked rotation) is a *product/engine-extension* concern (NEXT_SESSION §4), not this substrate — though this substrate is where sovereign recovery would eventually surface.

## 7. Recommendation
Prototype the single-active-writer Autobase mapping against the conformance suite **before** committing to the full adapter — question §4.1 is the make-or-break. If linearization fights the linear model, fall back to "Hypercore-per-subject with an explicit handover record that points to the successor core" (a hand-rolled linear P2P log) instead of Autobase.

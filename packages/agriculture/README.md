# @symblon/agriculture

The agriculture domain layer on top of [`@symblon/core`](../../README.md) — the agriculture / fruit-traceability registry's chain semantics. It applies the engine's domain-neutral primitives with agricultural-traceability meaning; the engine validates structure and tamper-binding, this layer owns the semantics.

Design: [`docs/superpowers/specs/2026-06-26-agriculture-trust-model-design.md`](../../docs/superpowers/specs/2026-06-26-agriculture-trust-model-design.md).

## What's here (v1)

Two chain roles, both ordinary `@symblon/core` chains distinguished by subject scheme:

- **Lot chains** (`agriculture.lot`) — the goods, custody baton-passed grower → wholesaler → retailer via the engine's `custody_change`. One continuous track-and-trace timeline; the existing engine, unchanged.
- **Party chains** (`agriculture.party`) — each actor's own sovereign ledger, where it records statements about chains it does not control.

The **dispute (counter-claim) flow**: once custody has moved, a grower can no longer write to the lot chain — so a dispute is recorded on the grower's *own* party chain as a signed counter-claim that tamper-bindingly references (pins by `payloadHash`) the contested lot attestation. The lot chain is never mutated; the disagreement is a pinned cross-link. v1 is **counter-claim only** — the system records the dispute, it does not adjudicate.

## API

```ts
import {
  lotSubject, partySubject,            // scheme-stamped subjects
  COUNTER_CLAIM,                        // agriculture domain dispute event type
  disputeClaim,                        // build a counter-claim claim
  CounterClaimClaimSchema,             // Zod validation for the claim shape
  disputedRefs,                        // extract the disputed refs from a claim
  verifyDispute,                       // verify a party-chain dispute against a lot chain
} from "@symblon/agriculture";

// The disputing party records a counter-claim on ITS OWN chain, referencing the
// contested lot attestation (the engine pins it by payloadHash):
const claim = disputeClaim(rejection, "Lot was sound at dispatch; dispute the mold finding");

// A verifier confirms the whole thing: both chains verify, the schemes are right,
// and the disputes-reference resolves hash-exact onto the lot chain.
const result = await verifyDispute(growerPartyChain, lotChain, resolvePublicKey);
// → { ok: true } | { ok: false, reason }
```

`verifyDispute` wraps the engine's `verifyReference` and adds the agriculture domain semantics the engine deliberately omits: the `agriculture.party` / `agriculture.lot` scheme roles and the `disputes` relationship (the engine carries `rel` but never interprets it).

## Test / typecheck

```bash
npm test -w @symblon/agriculture        # the runnable end-to-end dispute scenario lives in the tests
npm run typecheck -w @symblon/agriculture
```

The verify-dispute test is the runnable narrative: a grower harvests a lot, hands custody to a wholesaler (real `custody_change`), the wholesaler records a quality rejection, and the grower files a counter-claim on its sovereign chain that `verifyDispute` confirms.

## Out of scope (deferred, per spec §6.4 / §3.4)

Identity + erasure (crypto-shred) module and the registry reverse-reference index — each needs its own design pass before implementation.

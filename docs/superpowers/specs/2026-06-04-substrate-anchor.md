# `@symblon/anchor` — public-ledger Merkle anchoring — design

**Status:** Design (decision doc). **Phase 3.** Add-on; composes with the SQL or Pear substrate. Depends on Phase 0.
**Date:** 2026-06-04
**Author:** Claude + Piotr (brainstorm, symblon-web session)
**Parent:** `2026-06-04-storage-substrates-overview.md`

---

## 1. Goal & what it buys

Periodically publish a **Merkle root** over batches of attestation `payloadHash`es to a public ledger, and keep an inclusion proof per attestation. This is **not** on-chain storage — chains stay in their SQL/Pear substrate; only roots go public.

What hash-links alone *cannot* do: they detect a rewrite, but an operator with full control could rewrite an entire chain *consistently* (and backdate it). Anchoring pins the chain's state in **external, public time** — a verifier can prove "this attestation existed and the chain hadn't been altered as of block/timestamp T," with zero trust in the operator. This is the roadmap item in `NEXT_SESSION.md` §3 ("public-ledger Merkle anchoring … prove 'anchored before time T'").

`computeMerkleRoot(hashes)` already exists in `@symblon/core` (anchor-ready, dormant) — this package adds the receipt, the publisher, and the verifier.

## 2. Mechanics

- **Batch:** collect `payloadHash`es (leaves) — either per-subject (each chain's records) or a global batch across many subjects on a cadence (cheaper, fewer anchors). Compute `root = computeMerkleRoot(orderedLeaves)`.
- **Publish:** post `root` to the chosen ledger; get back a `txRef` (and eventually a confirmed block/time).
- **Receipt** (stored alongside the chain, in the substrate or a sidecar table/core):
  ```ts
  type AnchorReceipt = {
    root: string;
    leaves: string[];          // ordered payloadHashes in the batch
    txRef: string;             // ledger transaction / OTS proof reference
    anchoredAt?: string;       // confirmed ISO time once the tx settles
  };
  ```
- **Verify** (`verifyAnchor(payloadHash, receipt, ledger)`):
  1. recompute the Merkle inclusion proof for `payloadHash` against `receipt.root`;
  2. confirm `receipt.root` is the one recorded at `receipt.txRef` on the ledger;
  3. read the ledger's timestamp/block for `txRef` → "anchored before time T."

## 3. Ledger target (decision)

| Option | Cost | Pros | Cons |
|---|---|---|---|
| **OpenTimestamps → Bitcoin** | free | no gas, strong neutral timestamp, simple | ~hours to confirm; proof format is OTS |
| **EVM contract** (e.g. an `anchors` contract emitting `Anchored(root, time)`) | gas per anchor | programmable, queryable, fast finality | costs money, chain choice/politics |

**Recommendation:** ship **OpenTimestamps first** (free, trust-minimized, enough for "existed before T"); add an EVM publisher behind the same `AnchorPublisher` interface only if a consumer needs programmable/queryable anchors. Keep the publisher pluggable.

```ts
export type AnchorPublisher = {
  publish(root: string): Promise<{ txRef: string }>;
  resolve(txRef: string): Promise<{ root: string; anchoredAt: string } | null>;
};
```

## 4. Composition & cadence
- Orthogonal to where chains live — wraps any `IntegritySubstrate`. A small scheduler batches new `payloadHash`es since the last anchor and publishes on a cadence (e.g. hourly/daily) or per-N-records.
- Per-subject vs global batching is a cost/granularity tradeoff — global batching is cheaper; per-subject receipts are simpler to serve. **Open question** — default to global batch with per-leaf inclusion proofs.

## 5. Scope / non-goals
- Off by default; opt-in per deployment. Tamper-evidence works without it; anchoring is the trust-minimized upgrade.
- No engine change beyond using the existing `computeMerkleRoot`.

## 6. Open questions
1. OpenTimestamps vs EVM as the first publisher (§3) — recommend OTS.
2. Batching granularity + cadence (§4).
3. Where receipts live (substrate sidecar table/core vs a dedicated store).

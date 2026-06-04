# `@symblon/substrate-sql` — Postgres/Supabase IntegritySubstrate — design

**Status:** Design (decision doc). **Phase 1.** Depends on Phase 0 (overview spec).
**Date:** 2026-06-04
**Author:** Claude + Piotr (brainstorm, symblon-web session)
**Parent:** `2026-06-04-storage-substrates-overview.md`

---

## 1. Goal & trust model

The **custodial, ship-first** adapter: an operator (hifipass / agrocontracts) holds the chains in Postgres (Supabase in practice). Operator-trusted for *availability and access control*; **not** for integrity (the chain self-verifies). This is what a real product runs on day one. Matches the "custodial-hold, disclose-on-demand" model (the chain is private; the owner discloses it + a `Presentation` to a chosen verifier).

## 2. Data model

```sql
-- one row per attestation; the chain for a subject is its rows ordered by seq
create table attestations (
  subject_scheme text not null,
  subject_id     text not null,
  seq            integer not null,              -- 0 = genesis, monotonic per subject
  payload_hash   text not null,                 -- = attestation.payloadHash
  prev_hash      text,                          -- null at genesis; = prior row's payload_hash
  attestation    jsonb not null,                -- the full Attestation object
  created_at     timestamptz not null default now(),
  primary key (subject_scheme, subject_id, seq),
  unique (subject_scheme, subject_id, payload_hash)
);
create index on attestations (subject_scheme, subject_id, seq);

-- key registry behind PublicKeyResolver
create table keys (
  key_id      text primary key,
  public_key  bytea not null,                   -- ed25519 pubkey bytes (32)
  created_at  timestamptz not null default now()
);
```

`head(subject)` = `payload_hash` of the max-`seq` row (or `null`). No separate `heads` table — derived from `max(seq)`; the `(subject, seq)` PK is what enforces ordering and concurrency (§3). *(Open question: a denormalized `heads` table avoids a max() scan at very high volume — defer until measured.)*

## 3. Append — atomic head-CAS (the core mechanic)

`append(att)` runs one transaction:
1. `SELECT max(seq), <head payload_hash> FROM attestations WHERE subject = …` (or none → genesis).
2. Validate: genesis requires `att.prevHash === null` and no existing rows; non-genesis requires `att.prevHash === currentHead`. Mismatch → throw `HeadConflictError`.
3. `INSERT … (seq = prevSeq+1, …)`.
4. The **`primary key (subject, seq)`** makes two racing inserts at the same `seq` collide — one commits, the other gets a unique-violation, which the adapter maps to `HeadConflictError`. This is the optimistic-concurrency guarantee with no app-level locking. (Alternative: `pg_advisory_xact_lock(hashtext(subject))` for pessimistic serialization — simpler reasoning, slightly less throughput; pick one in the plan.)

Optional verify-on-write: run `verifyAttestation(att, resolve)` + `wrong-signer`/`prev-hash` checks before INSERT.

## 4. Read & access control

- `readChain(subject)` = `SELECT attestation FROM … WHERE subject = … ORDER BY seq`. Return the parsed `Attestation[]`; the caller runs `verifyChain`.
- **RLS / access:** because ownership + history are private (custodial-hold), reads are gated — the operator's API authorizes who may `readChain` a given subject (the current owner, or a buyer the owner disclosed to). A public "lookup" projection (serial, manufacturing date, model, assurance) is a separate, RLS-open view derived from the genesis claim, *not* the full chain. Spec the projection view in the consumer; the substrate just stores + serves the chain.

## 5. `PublicKeyResolver`

`(keyId) => SELECT public_key FROM keys WHERE key_id = $1` → `Uint8Array | null`. Keys are inserted when an actor first appears (mint issuer, each `custody_change` newController). Consider a `registerKey(keyId, pub)` helper exported alongside the substrate.

## 6. API shape (sketch)

```ts
export function createSqlSubstrate(opts: { sql: SqlClient }): IntegritySubstrate & {
  resolver: PublicKeyResolver;
  registerKey(keyId: string, publicKey: Uint8Array): Promise<void>;
};
```
Driver-agnostic over a thin `SqlClient` (so it works with `postgres`, `pg`, or the Supabase client). Provide a Supabase preset.

## 7. Testing
- Pass `@symblon/substrate-conformance` against a real Postgres (Testcontainers or a disposable Supabase branch in CI). The concurrency test (§3.5 of overview) is the important one here — assert exactly one of N parallel appends wins.

## 8. Open questions
1. Optimistic (unique-violation) vs pessimistic (advisory lock) concurrency — recommend optimistic; confirm under load.
2. `heads` denormalization — defer.
3. Where the public-lookup projection lives (consumer vs a view shipped here) — lean consumer-side (domain-specific).
4. Multi-writer/replication: this adapter is single-primary (writes to primary, read replicas for scale). True multi-master is the Pear tier, not this.

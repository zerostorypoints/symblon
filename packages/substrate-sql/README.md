# @symblon/substrate-sql

Postgres/Supabase [`IntegritySubstrate`](../../types/seams.ts) for
[`@symblon/core`](../../README.md). Custodial, ship-first storage: an operator
holds the attestation chains in Postgres. Operator-trusted for **availability
and access control** — **not** for integrity (the chain self-verifies via
`verifyChain`).

## Usage

```ts
import { Pool } from "pg";
import { createSqlSubstrate, fromPg, createSchema } from "@symblon/substrate-sql";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const sql = fromPg(pool);
await createSchema(sql); // or run the DDL via your migration tool

const store = createSqlSubstrate({ sql });
await store.registerKey(keyId, publicKeyBytes);
await store.append(attestation);           // throws HeadConflictError on a head race
const chain = await store.readChain(subject);
const ok = await verifyChain(chain, store.resolver);
```

## Concurrency

`append` is an optimistic compare-and-set: it reads the head, fast-fails a stale
`prevHash` with `HeadConflictError`, then inserts at `seq = head.seq + 1`. Two
writers racing off the same head both target the same `seq`; the
`primary key (subject_scheme, subject_id, seq)` lets exactly one commit and the
loser's unique violation maps to `HeadConflictError`. No app-level locking.

## Driver-agnostic

The adapter talks to a thin `SqlClient` (`query(text, params) => rows`).
`fromPg` wraps a `pg` `Pool`/`Client`. For **Supabase**, connect `pg` (or any
Postgres driver) to your project's Postgres connection string and wrap it the
same way — the adapter uses raw SQL, not the supabase-js REST client.

## Testing

`__tests__/sql.conformance.test.ts` runs the shared
`@symblon/substrate-conformance` suite against real Postgres. Set
`SYMBLON_TEST_DATABASE_URL` to target a specific database, or leave it unset to
spin up a throwaway Postgres via Testcontainers (needs Docker).

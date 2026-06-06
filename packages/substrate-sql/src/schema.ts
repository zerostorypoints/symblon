// schema.ts
import type { SqlClient } from "./client.js";

/**
 * DDL for the substrate's tables. Idempotent (`if not exists`).
 *
 * - `attestations`: one row per link; a subject's chain is its rows ordered by
 *   `seq`. The `primary key (subject_scheme, subject_id, seq)` enforces ordering
 *   AND optimistic concurrency (two racing inserts at the same seq collide).
 * - `keys`: the `PublicKeyResolver` backing store (ed25519 pubkey bytes).
 */
export const SCHEMA_SQL = `
create table if not exists attestations (
  subject_scheme text not null,
  subject_id     text not null,
  seq            integer not null,
  payload_hash   text not null,
  prev_hash      text,
  attestation    jsonb not null,
  created_at     timestamptz not null default now(),
  primary key (subject_scheme, subject_id, seq),
  unique (subject_scheme, subject_id, payload_hash)
);
create index if not exists attestations_subject_seq_idx
  on attestations (subject_scheme, subject_id, seq);
create table if not exists keys (
  key_id      text primary key,
  public_key  bytea not null,
  created_at  timestamptz not null default now()
);
`;

/** Create the substrate schema if absent. Safe to call repeatedly. */
export async function createSchema(sql: SqlClient): Promise<void> {
  await sql.query(SCHEMA_SQL);
}

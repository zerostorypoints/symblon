// substrate.ts
import {
  HeadConflictError,
  verifyAttestation,
  type Attestation,
  type IntegritySubstrate,
  type PublicKeyResolver,
  type Subject,
} from "@symblon/core";
import { isUniqueViolation, type SqlClient } from "./client.js";

type HeadRow = { seq: number; payload_hash: string };
type AttestationRow = { attestation: Attestation };

/** The shape `createSqlSubstrate` returns: the seam + the key registry.
 *  Structurally mirrors `KeyedSubstrate` in @symblon/substrate-conformance, but is
 *  defined locally on purpose so this production adapter carries no dependency on the
 *  test-only conformance package. */
export type SqlSubstrate = IntegritySubstrate & {
  resolver: PublicKeyResolver;
  registerKey(keyId: string, publicKey: Uint8Array): Promise<void>;
};

async function readHead(sql: SqlClient, subject: Subject): Promise<HeadRow | null> {
  const rows = await sql.query<HeadRow>(
    `select seq, payload_hash from attestations
     where subject_scheme = $1 and subject_id = $2
     order by seq desc limit 1`,
    [subject.scheme, subject.id],
  );
  return rows[0] ?? null;
}

/**
 * Postgres/Supabase `IntegritySubstrate`. Append is an optimistic compare-and-set:
 * read the head, fast-fail a stale/duplicate `prevHash`, then `INSERT` at
 * `seq = head.seq + 1`. Two writers racing off the same head both target the
 * same seq; the `(subject, seq)` primary key lets exactly one commit and maps
 * the loser's unique violation to `HeadConflictError`.
 */
export function createSqlSubstrate(opts: { sql: SqlClient; verifyOnWrite?: boolean }): SqlSubstrate {
  const { sql, verifyOnWrite = false } = opts;
  const self: SqlSubstrate = {
    async append(attestation) {
      const subject = attestation.subject;
      const current = await readHead(sql, subject);
      const currentHead = current ? current.payload_hash : null;
      if (attestation.prevHash !== currentHead) {
        throw new HeadConflictError(subject, attestation.prevHash, currentHead);
      }
      if (verifyOnWrite) {
        const v = await verifyAttestation(attestation, self.resolver);
        if (!v.ok) throw new Error(`verify-on-write rejected attestation: ${v.reason}`);
      }
      const nextSeq = current ? current.seq + 1 : 0;
      try {
        await sql.query(
          `insert into attestations
             (subject_scheme, subject_id, seq, payload_hash, prev_hash, attestation)
           values ($1, $2, $3, $4, $5, $6::jsonb)`,
          [
            subject.scheme,
            subject.id,
            nextSeq,
            attestation.payloadHash,
            attestation.prevHash,
            JSON.stringify(attestation),
          ],
        );
      } catch (err) {
        // Both the (subject, seq) PK and the (subject, payload_hash) unique index raise
        // SQLSTATE 23505. Map both to HeadConflictError: the PK collision is the intended
        // optimistic-concurrency race guard (two writers off the same head → exactly one
        // wins); the payload_hash collision is a defense-in-depth duplicate guard that the
        // prevHash fast-fail above almost always preempts.
        if (isUniqueViolation(err)) {
          // Best-effort re-read for a precise `actual` — must never mask the conflict.
          let actual: string | null = null;
          try {
            const now = await readHead(sql, subject);
            actual = now ? now.payload_hash : null;
          } catch {
            // ignore: `actual` stays null
          }
          throw new HeadConflictError(subject, attestation.prevHash, actual);
        }
        throw err;
      }
    },

    async readChain(subject) {
      const rows = await sql.query<AttestationRow>(
        `select attestation from attestations
         where subject_scheme = $1 and subject_id = $2
         order by seq asc`,
        [subject.scheme, subject.id],
      );
      return rows.map((r) => r.attestation);
    },

    async head(subject) {
      const current = await readHead(sql, subject);
      return current ? current.payload_hash : null;
    },

    resolver: async (keyId) => {
      const rows = await sql.query<{ public_key: Uint8Array }>(
        `select public_key from keys where key_id = $1`,
        [keyId],
      );
      const row = rows[0];
      return row ? new Uint8Array(row.public_key) : null;
    },

    async registerKey(keyId, publicKey) {
      await sql.query(
        `insert into keys (key_id, public_key) values ($1, $2)
         on conflict (key_id) do nothing`,
        [keyId, Buffer.from(publicKey)],
      );
    },
  };
  return self;
}

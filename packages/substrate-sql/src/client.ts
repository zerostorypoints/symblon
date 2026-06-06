// client.ts

/** Minimal, driver-agnostic SQL client. Parameters use `$1, $2, …` placeholders. */
export type SqlClient = {
  query<Row = Record<string, unknown>>(
    text: string,
    params?: readonly unknown[],
  ): Promise<Row[]>;
};

/** Postgres SQLSTATE for `unique_violation`. */
const UNIQUE_VIOLATION = "23505";

/** True if `err` is a Postgres unique-constraint violation (driver-independent:
 *  both `pg` and `postgres` surface the SQLSTATE on `err.code`). */
export function isUniqueViolation(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    (err as { code?: unknown }).code === UNIQUE_VIOLATION
  );
}

/** Wrap a `pg` `Pool` (or `Client`) as a `SqlClient`. */
export function fromPg(pg: {
  query: (text: string, params?: readonly unknown[]) => Promise<{ rows: unknown[] }>;
}): SqlClient {
  return {
    async query<Row = Record<string, unknown>>(text: string, params?: readonly unknown[]) {
      const result = await pg.query(text, params);
      return result.rows as Row[];
    },
  };
}

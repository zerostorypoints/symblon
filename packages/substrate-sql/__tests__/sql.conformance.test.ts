import { beforeAll, afterAll } from "vitest";
import { Pool } from "pg";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { runSubstrateConformance, type KeyedSubstrate } from "@symblon/substrate-conformance";
import { createSqlSubstrate } from "../src/substrate.js";
import { fromPg, type SqlClient } from "../src/client.js";
import { createSchema } from "../src/schema.js";

let container: StartedPostgreSqlContainer | undefined;
let pool: Pool;
let sql: SqlClient;

beforeAll(async () => {
  const url = process.env.SYMBLON_TEST_DATABASE_URL;
  if (url) {
    pool = new Pool({ connectionString: url, max: 16 });
  } else {
    container = await new PostgreSqlContainer("postgres:16-alpine").start();
    pool = new Pool({ connectionString: container.getConnectionUri(), max: 16 });
  }
  sql = fromPg(pool);
  await createSchema(sql);
});

afterAll(async () => {
  await pool?.end();
  await container?.stop();
});

// `max: 16` connections (> N=8) so the concurrency test races on real, separate
// connections; `truncate` isolates each test.
runSubstrateConformance(async (): Promise<KeyedSubstrate> => {
  await sql.query("truncate attestations, keys");
  return createSqlSubstrate({ sql });
});

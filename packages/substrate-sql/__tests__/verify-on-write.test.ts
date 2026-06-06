import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Pool } from "pg";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { makeEd25519Key, buildLink } from "@symblon/substrate-conformance";
import { createSqlSubstrate } from "../src/substrate.js";
import { fromPg, type SqlClient } from "../src/client.js";
import { createSchema } from "../src/schema.js";

let container: StartedPostgreSqlContainer | undefined;
let pool: Pool;
let sql: SqlClient;

beforeAll(async () => {
  const url = process.env.SYMBLON_TEST_DATABASE_URL;
  pool = url
    ? new Pool({ connectionString: url, max: 4 })
    : new Pool({
        connectionString: (container = await new PostgreSqlContainer(
          "postgres:16-alpine",
        ).start()).getConnectionUri(),
        max: 4,
      });
  sql = fromPg(pool);
  await createSchema(sql);
});
afterAll(async () => {
  await pool?.end();
  await container?.stop();
});

describe("verify-on-write", () => {
  it("rejects an attestation whose signer key is unregistered", async () => {
    await sql.query("truncate attestations, keys");
    const store = createSqlSubstrate({ sql, verifyOnWrite: true });
    const key = makeEd25519Key("unregistered");
    const genesis = await buildLink(key, { scheme: "vow.unit", id: "x" }, null, {
      id: "g",
      type: "mint",
      claim: {},
    });
    // key NOT registered → resolver returns null → verifyAttestation 'unverifiable'
    await expect(store.append(genesis)).rejects.toThrow();
    expect(await store.readChain({ scheme: "vow.unit", id: "x" })).toHaveLength(0);
  });
});

import { resolve } from "node:path";
import { Client } from "pg";
import { applyMigrations } from "@hirelane/db";

const BASE = process.env["TEST_DATABASE_URL"] ?? "postgres://hirelane:hirelane@localhost:5433/hirelane_test";

/** A migrated, empty, dedicated database for one test file (never hirelane_test, which the db package drops). */
export async function authTestDb(name: string): Promise<{ client: Client; close: () => Promise<void>; connect: () => Promise<Client>; url: string }> {
  if (!/@(localhost|127\.0\.0\.1)[:/]/.test(BASE)) throw new Error("refusing to run against a non-local database");
  if (!/^hirelane_[a-z_]+_test$/.test(name)) throw new Error("bad test database name");
  const admin = new Client({ connectionString: BASE });
  await admin.connect();
  const { rowCount } = await admin.query("SELECT 1 FROM pg_database WHERE datname = $1", [name]);
  if (!rowCount) await admin.query(`CREATE DATABASE ${name}`);
  await admin.end();
  const u = new URL(BASE);
  u.pathname = `/${name}`;
  const client = new Client({ connectionString: u.toString() });
  await client.connect();
  await client.query("DROP SCHEMA public CASCADE");
  await client.query("CREATE SCHEMA public");
  await applyMigrations(client, resolve(import.meta.dirname, "../../../../packages/db/migrations"));
  const connect = async () => {
    const extra = new Client({ connectionString: u.toString() });
    await extra.connect();
    return extra;
  };
  return { client, close: () => client.end(), connect, url: u.toString() };
}

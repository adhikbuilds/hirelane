import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EnvKeyProvider, generateMasterKey, LocalBlobStore } from "@hirelane/vault";
import type { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { purgeUserBlobs } from "../lib/auth/erasure";
import { deleteAccountFor, type AuthDeps } from "../lib/auth/session";
import { authTestDb } from "./helpers/auth-db";

let client: Client;
let close: () => Promise<void>;
let dir: string;
let store: LocalBlobStore;
const keys = new EnvKeyProvider({ HIRELANE_MASTER_KEY: generateMasterKey() });

beforeAll(async () => {
  ({ client, close } = await authTestDb("hirelane_erasure_test"));
  dir = await mkdtemp(join(tmpdir(), "hl-erasure-"));
  store = new LocalBlobStore(dir);
});
afterAll(async () => {
  await close();
  await rm(dir, { recursive: true, force: true });
});

const blobKeys = async (userId: string) =>
  (await client.query("SELECT blob_key FROM resumes WHERE user_id = $1 AND blob_key IS NOT NULL", [userId])).rows.map((r) => r.blob_key as string);

const deps = (over: Partial<AuthDeps> = {}): AuthDeps => ({
  db: (fn) => fn(client),
  keys,
  now: () => new Date("2030-01-01T10:00:00Z"),
  purgeBlobs: (userId) => purgeUserBlobs(userId, { blobKeys, store }).then(() => undefined),
  ...over,
});

async function userWithResumes(): Promise<{ userId: string; files: string[] }> {
  const userId = randomUUID();
  await client.query(
    `WITH u AS (INSERT INTO users (id, email, email_verified_at) VALUES ($1, $2, now()) RETURNING id)
     INSERT INTO consents (user_id, kind, granted, doc_version) SELECT id, 'age_18_plus', true, 'test' FROM u`,
    [userId, `erasure-${userId}@example.test`],
  );
  const rootId = randomUUID();
  const versionId = randomUUID();
  const files: string[] = [];
  for (const [id, parent] of [[rootId, null], [versionId, rootId]] as const) {
    const key = `resumes/${userId}/${id}`;
    await store.put(key, Buffer.from("sealed-bytes"));
    files.push(key);
    await client.query(
      `INSERT INTO resumes (id, user_id, parent_id, source, mime, size_bytes, file_hmac, blob_key, parse_status)
       VALUES ($1, $2, $3, 'upload', 'application/pdf', 12, $4, $5, 'uploaded')`,
      [id, userId, parent, `hmac-${id}`, key],
    );
  }
  return { userId, files };
}

describe("account delete erases stored resume files", () => {
  it("leaves nothing under resumes/<userId>/ and no rows after delete", async () => {
    const { userId, files } = await userWithResumes();
    for (const f of files) expect(existsSync(join(dir, f))).toBe(true);
    expect((await deleteAccountFor(deps(), userId)).deleted).toBe(true);
    for (const f of files) expect(existsSync(join(dir, f)), f).toBe(false);
    const left = await readdir(join(dir, "resumes", userId)).catch(() => []);
    expect(left).toEqual([]);
    expect((await client.query("SELECT 1 FROM resumes WHERE user_id = $1", [userId])).rowCount).toBe(0);
    expect((await client.query("SELECT 1 FROM users WHERE id = $1", [userId])).rowCount).toBe(0);
  });

  it("keeps the account (and its keys) when a file cannot be deleted, so the erasure can be retried", async () => {
    const { userId, files } = await userWithResumes();
    const failing = { delete: async () => { throw new Error("storage down"); } };
    const d = deps({ purgeBlobs: (u) => purgeUserBlobs(u, { blobKeys, store: failing }).then(() => undefined) });
    await expect(deleteAccountFor(d, userId)).rejects.toThrow("storage down");
    expect((await client.query("SELECT 1 FROM users WHERE id = $1", [userId])).rowCount).toBe(1);
    expect(await blobKeys(userId)).toHaveLength(files.length);
    expect((await deleteAccountFor(deps(), userId)).deleted).toBe(true);
    for (const f of files) expect(existsSync(join(dir, f))).toBe(false);
  });
});

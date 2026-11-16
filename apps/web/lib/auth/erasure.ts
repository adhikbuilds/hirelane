import { withAdmin } from "@hirelane/db";
import { localBlobStoreFromEnv, type BlobStore } from "@hirelane/vault";

/**
 * DPDP erasure of stored files. The users DELETE cascades every resumes row, after which no job can find the sealed
 * originals again, so the blobs must go first. Each blob_key (original and every version) is deleted; any failure
 * throws, and the caller aborts the account delete so the erasure can be retried with the keys still on the rows.
 */
export interface ErasureDeps {
  blobKeys: (userId: string) => Promise<string[]>;
  store: Pick<BlobStore, "delete">;
}

export async function purgeUserBlobs(userId: string, deps: ErasureDeps): Promise<number> {
  const keys = await deps.blobKeys(userId);
  for (const k of keys) await deps.store.delete(k);
  return keys.length;
}

/** Owner-role read: hirelane_auth has no grant on resumes, and should not. */
export const ownerBlobKeys = (userId: string): Promise<string[]> =>
  withAdmin(async (c) => {
    const r = await c.query("SELECT blob_key FROM resumes WHERE user_id = $1 AND blob_key IS NOT NULL", [userId]);
    return r.rows.map((x) => x.blob_key as string);
  });

export const defaultPurgeBlobs = (userId: string): Promise<void> =>
  purgeUserBlobs(userId, { blobKeys: ownerBlobKeys, store: localBlobStoreFromEnv() }).then(() => undefined);

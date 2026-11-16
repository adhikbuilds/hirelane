/**
 * Shared plumbing for the resume tasks (resume:extract, resume:render, resume:purge, resume:purge-sweep).
 *
 * CONTRACTS the services layer must match (nothing else in the repo defines them):
 *   - parsed_enc AAD ........ `resumes:<resume id>:<user id>`
 *   - sealed file AAD ....... `resumes:<resume id>:<user id>:file`
 *   - file_hmac purpose ..... `resume.file` (hmac over the PLAINTEXT file bytes)
 *   - blob key (render) ..... `resumes/<user id>/<resume id>`
 *   - parsed_enc before extract (upload): JSON `{ "fileName": "<original name>" }`; for a builder draft:
 *     JSON `{ "answers": <BuilderAnswers> }` (a bare answers object is also accepted).
 *   - parsed_enc after extract: JSON ParsedResumeDoc (see resume/pipeline.ts), text already masked.
 * Payloads are `{ resumeId }` only. Logs carry status codes only: never names, text, keys or error messages.
 */
import { withAdmin } from '@hirelane/db';
import {
  EnvKeyProvider,
  hmac,
  localBlobStoreFromEnv,
  open,
  seal,
  type BlobStore,
  type KeyProvider,
} from '../../../../packages/vault/src/index';

export const parsedAad = (id: string, userId: string): string => `resumes:${id}:${userId}`;
export const fileAad = (id: string, userId: string): string => `resumes:${id}:${userId}:file`;
export const FILE_HMAC_PURPOSE = 'resume.file';
export const blobKeyFor = (userId: string, id: string): string => `resumes/${userId}/${id}`;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Payload must be exactly `{ resumeId: <uuid> }`. Throws a message with no payload content. */
export function parseResumePayload(payload: unknown): string {
  const id = (payload as { resumeId?: unknown } | null)?.resumeId;
  if (typeof id !== 'string' || !UUID.test(id) || Object.keys(payload as object).length !== 1) throw new Error('resume task: invalid payload');
  return id.toLowerCase();
}

/** The subset of graphile-worker's JobHelpers these tasks use. */
export interface ResumeHelpers {
  logger: { info(m: string): void; warn(m: string): void; error(m: string): void };
  job?: { attempts: number; max_attempts: number };
  addJob(identifier: string, payload?: unknown, spec?: { jobKey?: string }): Promise<unknown>;
}

export const isLastAttempt = (h: ResumeHelpers): boolean => (h.job?.attempts ?? 1) >= (h.job?.max_attempts ?? 25);

// ---------------------------------------------------------------- vault

export interface ResumeVault {
  sealJson(value: unknown, aad: string): Promise<Buffer>;
  openJson(sealed: Buffer, aad: string): Promise<unknown>;
  putBlob(key: string, plaintext: Buffer, aad: string): Promise<void>;
  getBlob(key: string, aad: string): Promise<Buffer>;
  deleteBlob(key: string): Promise<void>;
  fileHmac(plaintext: Buffer): Promise<string>;
}

export function createResumeVault(blobs: BlobStore, keys: KeyProvider): ResumeVault {
  return {
    sealJson: (v, aad) => seal(keys, Buffer.from(JSON.stringify(v), 'utf8'), { aad }),
    openJson: async (sealed, aad) => JSON.parse((await open(keys, sealed, { aad })).toString('utf8')) as unknown,
    putBlob: async (key, plain, aad) => blobs.put(key, await seal(keys, plain, { aad })),
    getBlob: async (key, aad) => open(keys, await blobs.get(key), { aad }),
    deleteBlob: (key) => blobs.delete(key),
    fileHmac: (plain) => hmac(keys, FILE_HMAC_PURPOSE, plain),
  };
}

let vault: ResumeVault | undefined;
/** Built on first use from HIRELANE_MASTER_KEY and HIRELANE_STORAGE_DIR, so importing the task list needs no env. */
export function defaultVault(): ResumeVault {
  return (vault ??= createResumeVault(localBlobStoreFromEnv(), new EnvKeyProvider()));
}

// ---------------------------------------------------------------- repository

export interface Queryable {
  query(sql: string, params?: unknown[]): Promise<{ rows: Record<string, unknown>[]; rowCount: number | null }>;
}
/** Runs `fn` on one connection as the OWNER role. The worker writes extractor-owned columns, which hirelane_app cannot. */
export type Run = <T>(fn: (c: Queryable) => Promise<T>) => Promise<T>;
export const adminRun: Run = (fn) => withAdmin((c) => fn(c as unknown as Queryable));

export interface ExtractClaim { id: string; userId: string; blobKey: string; parsedEnc: Buffer | null }
export interface ExtractWrite {
  status: 'parsed' | 'needs_text' | 'rejected' | 'failed';
  rejectCode: string | null;
  pages: number | null;
  textLayer: string | null;
  producerFamily: string | null;
  health: unknown[];
  healthPassed: number;
  healthTotal: number;
  sensitiveKinds: string[];
  /** null keeps the existing parsed_enc. */
  parsedEnc: Buffer | null;
}
export interface DraftRow { id: string; userId: string; parsedEnc: Buffer }
export interface RenderWrite { blobKey: string; sizeBytes: number; fileHmac: string; parsedEnc: Buffer }
export interface PurgeTarget { id: string; userId: string; blobKey: string | null }

export interface ResumeRepo {
  claimExtract(id: string, now: Date): Promise<ExtractClaim | null>;
  finishExtract(c: ExtractClaim, w: ExtractWrite, now: Date): Promise<boolean>;
  releaseExtract(id: string, now: Date): Promise<void>;
  failExtract(id: string, code: string, now: Date): Promise<void>;
  loadDraft(id: string): Promise<DraftRow | null>;
  finishRender(d: DraftRow, w: RenderWrite, now: Date): Promise<boolean>;
  failRender(id: string, code: string, now: Date): Promise<void>;
  loadPurgeTree(id: string): Promise<PurgeTarget[]>;
  completePurge(targets: PurgeTarget[], now: Date): Promise<void>;
  /** `exclude` pages the sweep forward past ids it already tried. */
  dueForPurge(now: Date, limit: number, exclude: string[]): Promise<string[]>;
  supersedeSensitive(userId: string | null, now: Date): Promise<string[]>;
  /**
   * Stuck-job recovery. Resets rows left in 'extracting' for longer than `extractingMin` (the worker died mid-job) to
   * 'uploaded', then returns every live 'uploaded' row older than `uploadedMin` so the caller can re-enqueue extract.
   */
  reviveStuck(now: Date, opts: { uploadedMin: number; extractingMin: number; limit: number }): Promise<string[]>;
  /** Deletes idempotency_keys rows older than `hours`. They hold full response bodies (labels, skills, percentages). */
  purgeIdempotency(now: Date, hours: number): Promise<number>;
}

/** The child has a 10 s limit; five minutes is far past any live job. */
export const STUCK_EXTRACTING_MIN = 5;
export const STUCK_UPLOADED_MIN = 10;
export const IDEMPOTENCY_TTL_HOURS = 24;

/** A deleted resume must be purged at most this long after deletion, whatever purge_after says (PRD R8). */
export const PURGE_BOUND_HOURS = 24;
/** The sweep runs hourly, so rows are picked up one hour before the bound. */
export const SWEEP_PICKUP_HOURS = 23;
const SENSITIVE_IDS = "ARRAY['aadhaar','vid','pan']::text[]";

const buf = (v: unknown): Buffer | null => (v === null || v === undefined ? null : Buffer.isBuffer(v) ? v : Buffer.from(v as Uint8Array));

export function createPgRepo(run: Run = adminRun): ResumeRepo {
  return {
    claimExtract: (id, now) =>
      run(async (c) => {
        const { rows } = await c.query(
          `UPDATE resumes SET parse_status = 'extracting', updated_at = $2
            WHERE id = $1 AND parse_status = 'uploaded' AND deleted_at IS NULL AND purged_at IS NULL AND blob_key IS NOT NULL
        RETURNING id, user_id, blob_key, parsed_enc`,
          [id, now],
        );
        const r = rows[0];
        return r ? { id: String(r['id']), userId: String(r['user_id']), blobKey: String(r['blob_key']), parsedEnc: buf(r['parsed_enc']) } : null;
      }),

    finishExtract: (cl, w, now) =>
      run(async (c) => {
        const r = await c.query(
          `UPDATE resumes SET parse_status = $3, reject_code = $4, pages = $5, text_layer = $6, producer_family = $7,
                  health = $8::jsonb, health_passed = $9, health_total = $10, sensitive_kinds = $11::text[],
                  parsed_enc = COALESCE($12, parsed_enc), parsed_version = CASE WHEN $12::bytea IS NULL THEN parsed_version ELSE 1 END,
                  updated_at = $13
            WHERE id = $1 AND user_id = $2 AND parse_status = 'extracting'`,
          [cl.id, cl.userId, w.status, w.rejectCode, w.pages, w.textLayer, w.producerFamily, JSON.stringify(w.health), w.healthPassed, w.healthTotal, w.sensitiveKinds, w.parsedEnc, now],
        );
        return (r.rowCount ?? 0) === 1;
      }),

    releaseExtract: (id, now) =>
      run(async (c) => {
        await c.query(`UPDATE resumes SET parse_status = 'uploaded', updated_at = $2 WHERE id = $1 AND parse_status = 'extracting'`, [id, now]);
      }),

    failExtract: (id, code, now) =>
      run(async (c) => {
        await c.query(`UPDATE resumes SET parse_status = 'failed', reject_code = $2, updated_at = $3 WHERE id = $1 AND parse_status = 'extracting'`, [id, code, now]);
      }),

    loadDraft: (id) =>
      run(async (c) => {
        const { rows } = await c.query(
          `SELECT id, user_id, parsed_enc FROM resumes
            WHERE id = $1 AND source = 'builder' AND parse_status = 'draft' AND blob_key IS NULL
              AND deleted_at IS NULL AND purged_at IS NULL AND parsed_enc IS NOT NULL`,
          [id],
        );
        const r = rows[0];
        return r ? { id: String(r['id']), userId: String(r['user_id']), parsedEnc: buf(r['parsed_enc'])! } : null;
      }),

    finishRender: (d, w, now) =>
      run(async (c) => {
        const r = await c.query(
          `UPDATE resumes SET mime = 'application/pdf', size_bytes = $3, file_hmac = $4, blob_key = $5, parsed_enc = $6,
                  parsed_version = 0, parse_status = 'uploaded', updated_at = $7
            WHERE id = $1 AND user_id = $2 AND parse_status = 'draft' AND deleted_at IS NULL`,
          [d.id, d.userId, w.sizeBytes, w.fileHmac, w.blobKey, w.parsedEnc, now],
        );
        return (r.rowCount ?? 0) === 1;
      }),

    failRender: (id, code, now) =>
      run(async (c) => {
        await c.query(`UPDATE resumes SET parse_status = 'failed', reject_code = $2, updated_at = $3 WHERE id = $1 AND parse_status = 'draft'`, [id, code, now]);
      }),

    // Only a resume that is already soft-deleted can be purged by id: a stray job can never destroy a live resume.
    loadPurgeTree: (id) =>
      run(async (c) => {
        const { rows } = await c.query(
          `SELECT r.id, r.user_id, r.blob_key FROM resumes r
            WHERE r.purged_at IS NULL AND (r.id = $1 OR r.parent_id = $1)
              AND EXISTS (SELECT 1 FROM resumes p WHERE p.id = $1 AND p.deleted_at IS NOT NULL)`,
          [id],
        );
        return rows.map((r) => ({ id: String(r['id']), userId: String(r['user_id']), blobKey: r['blob_key'] === null ? null : String(r['blob_key']) }));
      }),

    // One UPDATE nulls everything derived from the file (parsed_enc, label, skills, file_hmac, blob_key) and sets purged_at
    // (resumes_purged_clean, resumes_purged_derived_clean). The blobs were deleted before this runs, so a failed run is retried
    // with the keys still on the rows.
    completePurge: (targets, now) =>
      run(async (c) => {
        if (targets.length === 0) return;
        await c.query('BEGIN');
        try {
          const { rows } = await c.query(
            `UPDATE resumes SET parsed_enc = NULL, label = NULL, skills = '{}', file_hmac = NULL, blob_key = NULL, purged_at = $2, deleted_at = COALESCE(deleted_at, $2),
                    purge_after = COALESCE(purge_after, $2), is_default = false, updated_at = $2
              WHERE id = ANY($1::uuid[]) AND purged_at IS NULL RETURNING id, user_id`,
            [targets.map((t) => t.id), now],
          );
          for (const r of rows) {
            await c.query(`INSERT INTO file_access_log (user_id, resume_id, action, at) VALUES ($1, $2, 'purge', $3)`, [r['user_id'], r['id'], now]);
          }
          await c.query('COMMIT');
        } catch (e) {
          await c.query('ROLLBACK');
          throw e;
        }
      }),

    // A live version under a deleted root is picked up through that root, so a version confirmed under a root that was deleted
    // after loadPurgeTree ran is still purged (loadPurgeTree collects the whole family of a deleted root).
    dueForPurge: (now, limit, exclude) =>
      run(async (c) => {
        const { rows } = await c.query(
          `SELECT id FROM (
             SELECT r.id, COALESCE(r.purge_after, r.deleted_at) AS due FROM resumes r
              WHERE r.purged_at IS NULL AND r.deleted_at IS NOT NULL AND (r.purge_after <= $1 OR r.deleted_at <= $2)
             UNION
             SELECT p.id, COALESCE(p.purge_after, p.deleted_at) AS due FROM resumes r JOIN resumes p ON p.id = r.parent_id
              WHERE r.purged_at IS NULL AND p.deleted_at IS NOT NULL AND (p.purge_after <= $1 OR p.deleted_at <= $2)
           ) t WHERE id <> ALL($4::uuid[])
           ORDER BY due, id LIMIT $3`,
          [now, new Date(now.getTime() - SWEEP_PICKUP_HOURS * 3600_000), limit, exclude],
        );
        return rows.map((r) => String(r['id']));
      }),

    // A ROOT resume holding a full Aadhaar/VID/PAN is "replaced" once the same student has a NEWER active ROOT that is
    // parsed or confirmed and holds none. Versions are excluded on both sides: a confirmed child version of the same
    // root (which services insert with empty sensitive_kinds) must never count as its parent's replacement. The old one is soft-deleted here, then purged like any other deletion.
    supersedeSensitive: (userId, now) =>
      run(async (c) => {
        const { rows } = await c.query(
          `UPDATE resumes r SET deleted_at = $1, purge_after = $1, is_default = false, updated_at = $1
            WHERE r.parent_id IS NULL AND r.deleted_at IS NULL AND r.purged_at IS NULL AND r.sensitive_kinds && ${SENSITIVE_IDS}
              AND ($2::uuid IS NULL OR r.user_id = $2::uuid)
              AND EXISTS (SELECT 1 FROM resumes n
                           WHERE n.user_id = r.user_id AND n.parent_id IS NULL AND n.id <> r.id AND n.deleted_at IS NULL AND n.purged_at IS NULL
                             AND n.created_at > r.created_at AND n.parse_status IN ('parsed', 'confirmed')
                             AND NOT (n.sensitive_kinds && ${SENSITIVE_IDS}))
        RETURNING r.id`,
          [now, userId],
        );
        const ids = rows.map((r) => String(r['id']));
        // The whole family goes with its root (as deleteResume does), so a live version cannot outlive it.
        if (ids.length > 0) {
          await c.query(
            `UPDATE resumes SET deleted_at = COALESCE(deleted_at, $1), purge_after = COALESCE(purge_after, $1), is_default = false, updated_at = $1
              WHERE parent_id = ANY($2::uuid[]) AND purged_at IS NULL`,
            [now, ids],
          );
        }
        return ids;
      }),

    reviveStuck: (now, o) =>
      run(async (c) => {
        const revived = await c.query(
          `UPDATE resumes SET parse_status = 'uploaded', updated_at = $1
            WHERE parse_status = 'extracting' AND deleted_at IS NULL AND updated_at < $2 RETURNING id`,
          [now, new Date(now.getTime() - o.extractingMin * 60_000)],
        );
        const { rows } = await c.query(
          `SELECT id FROM resumes
            WHERE parse_status = 'uploaded' AND deleted_at IS NULL AND purged_at IS NULL AND blob_key IS NOT NULL AND updated_at < $1
            ORDER BY updated_at, id LIMIT $2`,
          [new Date(now.getTime() - o.uploadedMin * 60_000), o.limit],
        );
        return [...new Set([...revived.rows, ...rows].map((r) => String(r['id'])))].slice(0, o.limit);
      }),

    purgeIdempotency: (now, hours) =>
      run(async (c) => {
        const r = await c.query(`DELETE FROM idempotency_keys WHERE created_at < $1`, [new Date(now.getTime() - hours * 3600_000)]);
        return r.rowCount ?? 0;
      }),
  };
}

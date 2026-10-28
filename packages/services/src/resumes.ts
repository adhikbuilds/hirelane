import { randomUUID } from 'node:crypto';
import { hmac, open, seal } from '@hirelane/vault';
import { z } from 'zod';
import { blobIdFromKey, blobKeyFor, FILE_HMAC_PURPOSE, parsedAad, resumeBlobAad } from './aad';
import type { ServiceCtx } from './ctx';
import { withUserTx } from './db';
import { EligibilityValues, FieldMeta, upsertEligibility } from './eligibility';
import { deriveFieldMeta } from './provenance';
import { mapPgError, notFound, ServiceError } from './errors';
import { ParsedResume } from './parsed';
import { idSchema, parseInput } from './schema';
import { openJson, sealJson } from './seal';

export const PDF_MIME = 'application/pdf';
export const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
export const MAX_RESUME_BYTES = 5 * 1024 * 1024;
export const RESUME_MIMES = [PDF_MIME, DOCX_MIME] as const;

/** `%PDF-` or `PK\x03\x04`, matched against the declared type. */
export function magicMatches(mime: string, head: Buffer): boolean {
  if (mime === PDF_MIME) return head.length >= 5 && head.subarray(0, 5).toString('latin1') === '%PDF-';
  if (mime === DOCX_MIME) return head.length >= 4 && head[0] === 0x50 && head[1] === 0x4b && head[2] === 0x03 && head[3] === 0x04;
  return false;
}

export interface ResumeSummary {
  id: string;
  parentId: string | null;
  label: string | null;
  source: 'upload' | 'builder';
  mime: string;
  sizeBytes: number | null;
  pages: number | null;
  textLayer: string | null;
  parseStatus: string;
  rejectCode: string | null;
  parsedVersion: number;
  healthPassed: number;
  healthTotal: number;
  sensitiveKinds: string[];
  skills: string[];
  confirmedAt: string | null;
  isDefault: boolean;
  createdAt: string;
  updatedAt: string;
}
export interface ResumeView extends ResumeSummary {
  health: unknown[];
  /** Opened, masked parse. Null until the extractor has run. */
  parsed: ParsedResume | null;
}

const iso = (d: unknown): string | null => (d instanceof Date ? d.toISOString() : null);

/**
 * A confirmed version is the same file as its root, so the file-derived facts (health, sensitive kinds, pages, text layer)
 * are read from the root: the runner computes them once, on the row it extracted. FROM also hides a version whose root
 * was deleted or replaced (the runner purges the whole family with the root).
 */
const FROM_FAMILY = `resumes r LEFT JOIN resumes p ON p.id = r.parent_id AND p.user_id = r.user_id`;
const LIVE = `r.user_id = $2 AND r.deleted_at IS NULL AND (r.parent_id IS NULL OR p.deleted_at IS NULL)`;
const SUMMARY_COLS = `r.id, r.parent_id, r.label, r.source, r.mime, r.size_bytes, COALESCE(p.pages, r.pages) AS pages,
  COALESCE(p.text_layer, r.text_layer) AS text_layer, r.parse_status, r.reject_code, r.parsed_version,
  COALESCE(p.health_passed, r.health_passed) AS health_passed, COALESCE(p.health_total, r.health_total) AS health_total,
  COALESCE(p.sensitive_kinds, r.sensitive_kinds) AS sensitive_kinds, r.skills, r.confirmed_at, r.is_default, r.created_at, r.updated_at`;

function summary(r: Record<string, unknown>): ResumeSummary {
  return {
    id: r['id'] as string,
    parentId: (r['parent_id'] as string | null) ?? null,
    label: (r['label'] as string | null) ?? null,
    source: r['source'] as 'upload' | 'builder',
    mime: r['mime'] as string,
    sizeBytes: r['size_bytes'] == null ? null : Number(r['size_bytes']),
    pages: r['pages'] == null ? null : Number(r['pages']),
    textLayer: (r['text_layer'] as string | null) ?? null,
    parseStatus: r['parse_status'] as string,
    rejectCode: (r['reject_code'] as string | null) ?? null,
    parsedVersion: Number(r['parsed_version']),
    healthPassed: Number(r['health_passed']),
    healthTotal: Number(r['health_total']),
    sensitiveKinds: (r['sensitive_kinds'] as string[]) ?? [],
    skills: (r['skills'] as string[]) ?? [],
    confirmedAt: iso(r['confirmed_at']),
    isDefault: r['is_default'] === true,
    createdAt: iso(r['created_at'])!,
    updatedAt: iso(r['updated_at'])!,
  };
}

// ---------- upload ----------

export const UploadInput = z.strictObject({
  mime: z.enum(RESUME_MIMES),
  fileName: z.string().max(255).nullable().optional(),
  label: z.string().trim().min(1).max(80).nullable().optional(),
});

/**
 * Stores a new resume as 'uploaded'. The caller (the route) has already capped the stream; size and magic bytes are
 * re-checked here so no other caller can skip them. Order: seal, blob put, insert, commit, then enqueue. A failed insert
 * removes the blob again. The original file name goes only into the sealed parsed_enc.
 */
export async function uploadResume(ctx: ServiceCtx, input: unknown, bytes: Buffer): Promise<{ id: string; status: 'uploaded' }> {
  const meta = parseInput(UploadInput, input);
  if (bytes.length === 0) throw new ServiceError('empty_file', 400);
  if (bytes.length > MAX_RESUME_BYTES) throw new ServiceError('file_too_large', 413);
  if (!magicMatches(meta.mime, bytes)) throw new ServiceError('bad_file_type', 415);

  const id = randomUUID();
  const key = blobKeyFor(ctx.userId, id);
  const fileHmac = await hmac(ctx.keys, FILE_HMAC_PURPOSE, bytes);
  const parsedEnc = await sealJson(ctx, parsedAad(ctx.userId, id), { v: 1, fileName: meta.fileName ?? null });
  await ctx.blobs.put(key, await seal(ctx.keys, bytes, { aad: resumeBlobAad(ctx.userId, id) }));
  try {
    await withUserTx(ctx, (c) =>
      c.query(
        `INSERT INTO resumes (id, user_id, label, source, mime, size_bytes, file_hmac, blob_key, parse_status, parsed_enc)
         VALUES ($1, $2, $3, 'upload', $4, $5, $6, $7, 'uploaded', $8)`,
        [id, ctx.userId, meta.label ?? null, meta.mime, bytes.length, fileHmac, key, parsedEnc],
      ),
    );
  } catch (e) {
    await ctx.blobs.delete(key).catch(() => undefined);
    throw mapPgError(e);
  }
  await enqueueOrFail(ctx, 'resume:extract', id);
  return { id, status: 'uploaded' };
}

async function enqueueOrFail(ctx: ServiceCtx, task: string, id: string): Promise<void> {
  try {
    await ctx.enqueue(task, { resumeId: id }, { jobKey: `${task}:${id}` });
  } catch (e) {
    if (e instanceof ServiceError) throw e;
    throw new ServiceError('queue_unavailable', 503);
  }
}

// ---------- read ----------

export async function listResumes(ctx: ServiceCtx): Promise<ResumeSummary[]> {
  try {
    return await withUserTx(ctx, async (c) => {
      const r = await c.query(`SELECT ${SUMMARY_COLS} FROM ${FROM_FAMILY} WHERE ${LIVE.replace('$2', '$1')} ORDER BY r.created_at DESC, r.id`, [ctx.userId]);
      return r.rows.map(summary);
    });
  } catch (e) {
    throw mapPgError(e);
  }
}

export const IdInput = z.strictObject({ id: idSchema });

export async function getResume(ctx: ServiceCtx, input: unknown): Promise<ResumeView> {
  const { id } = parseInput(IdInput, input);
  try {
    return await withUserTx(ctx, async (c) => {
      const r = await c.query(`SELECT ${SUMMARY_COLS}, COALESCE(p.health, r.health) AS health, r.parsed_enc FROM ${FROM_FAMILY} WHERE r.id = $1 AND ${LIVE}`, [id, ctx.userId]);
      const row = r.rows[0];
      if (!row) throw notFound();
      const parsed = row.parsed_enc ? ParsedResume.safeParse(await openJson(ctx, parsedAad(ctx.userId, id), row.parsed_enc)) : null;
      if (parsed && !parsed.success) throw new ServiceError('unreadable_record', 500);
      return { ...summary(row), health: row.health as unknown[], parsed: parsed ? parsed.data : null };
    });
  } catch (e) {
    throw mapPgError(e);
  }
}

// ---------- confirm ----------

export const ConfirmInput = z.strictObject({
  id: idSchema,
  /** The parsed_version the student saw. A re-extraction in between makes this stale (409). */
  parsedVersion: z.number().int().min(0).max(32000),
  label: z.string().trim().min(1).max(80).nullable().optional(),
  skills: z.array(z.string().trim().min(1).max(60)).max(200).optional(),
  eligibility: EligibilityValues,
  fieldMeta: FieldMeta.optional(),
});

/**
 * Confirm creates a NEW version row under the same root (HLD F1 step 5): a copy of the file identity, status
 * 'confirmed', the new version becomes the default, and eligibility_profiles is upserted in the same transaction.
 * health, sensitive_kinds, pages and text_layer stay on the root (the app role cannot write them); every read of the
 * version inherits them from the root. Nothing reaches matching
 * before this call.
 */
export async function confirmResume(ctx: ServiceCtx, input: unknown): Promise<ResumeSummary & { eligibilityConfirmedAt: string }> {
  const inp = parseInput(ConfirmInput, input);
  try {
    return await withUserTx(ctx, async (c) => {
      const src = (
        await c.query(
          `SELECT id, parent_id, label, source, mime, size_bytes, file_hmac, blob_key, parse_status, parsed_enc, parsed_version, skills
             FROM resumes WHERE id = $1 AND user_id = $2 AND deleted_at IS NULL FOR UPDATE`,
          [inp.id, ctx.userId],
        )
      ).rows[0];
      if (!src) throw notFound();
      if (src.parse_status !== 'parsed' && src.parse_status !== 'confirmed') throw new ServiceError('not_confirmable', 409);
      if (Number(src.parsed_version) !== inp.parsedVersion) throw new ServiceError('stale_parse', 409);
      if (!src.parsed_enc || !src.blob_key) throw new ServiceError('not_confirmable', 409);
      const root = (src.parent_id as string | null) ?? (src.id as string);
      // A root that was soft-deleted (the 24 h purge may already have loaded its tree) must not gain a new version.
      if (src.parent_id) {
        const live = await c.query('SELECT 1 FROM resumes WHERE id = $1 AND user_id = $2 AND deleted_at IS NULL FOR UPDATE', [root, ctx.userId]);
        if (!live.rowCount) throw notFound();
      }
      // Confirm never changes its source, so a second confirm from the same screen must see the version the first one made.
      const newer = await c.query('SELECT 1 FROM resumes WHERE user_id = $1 AND parent_id = $2 AND deleted_at IS NULL AND parsed_version > $3 LIMIT 1', [ctx.userId, root, inp.parsedVersion]);
      if (newer.rowCount) throw new ServiceError('stale_parse', 409);

      const parsed = ParsedResume.safeParse(await openJson(ctx, parsedAad(ctx.userId, src.id), src.parsed_enc));
      if (!parsed.success) throw new ServiceError('unreadable_record', 500);

      const newId = randomUUID();
      const now = ctx.now();
      const rootId = root;
      await c.query('UPDATE resumes SET is_default = false, updated_at = $2 WHERE user_id = $1 AND is_default AND deleted_at IS NULL', [ctx.userId, now]);
      await c.query(
        `INSERT INTO resumes (id, user_id, parent_id, label, source, mime, size_bytes, file_hmac, blob_key, parse_status, parsed_enc, parsed_version, skills, confirmed_at, is_default)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'confirmed', $10, $11, $12, $13, true)`,
        [
          newId,
          ctx.userId,
          rootId,
          inp.label === undefined ? src.label : inp.label,
          src.source,
          src.mime,
          src.size_bytes,
          src.file_hmac,
          src.blob_key,
          await sealJson(ctx, parsedAad(ctx.userId, newId), parsed.data),
          Number(src.parsed_version) + 1,
          inp.skills ?? src.skills,
          now,
        ],
      );
      // The client's fieldMeta is ignored: provenance is computed against the parse (see provenance.ts).
      const meta: FieldMeta = deriveFieldMeta(inp.eligibility, parsed.data);
      await upsertEligibility(c, ctx, inp.eligibility, meta, newId);
      const out = (await c.query(`SELECT ${SUMMARY_COLS} FROM ${FROM_FAMILY} WHERE r.id = $1 AND r.user_id = $2`, [newId, ctx.userId])).rows[0];
      return { ...summary(out), eligibilityConfirmedAt: now.toISOString() };
    });
  } catch (e) {
    throw mapPgError(e);
  }
}

// ---------- download ----------

export interface Download {
  bytes: Buffer;
  mime: string;
  /** A neutral name. The original file name stays sealed. */
  fileName: string;
}

/** Writes file_access_log in the same transaction as the read: no log row, no bytes; no bytes, no log row. */
export async function downloadResume(ctx: ServiceCtx, input: unknown, opts: { ipHash?: string | null } = {}): Promise<Download> {
  const { id } = parseInput(IdInput, input);
  try {
    return await withUserTx(ctx, async (c) => {
      const row = (
        await c.query(`SELECT r.mime, r.blob_key FROM ${FROM_FAMILY} WHERE r.id = $1 AND ${LIVE} AND r.purged_at IS NULL`, [id, ctx.userId])
      ).rows[0];
      if (!row?.blob_key) throw notFound();
      const blobId = blobIdFromKey(ctx.userId, row.blob_key as string);
      if (!blobId) throw notFound();
      await c.query("INSERT INTO file_access_log (user_id, resume_id, action, ip_hash) VALUES ($1, $2, 'download', $3)", [ctx.userId, id, opts.ipHash ?? null]);
      let sealed: Buffer;
      try {
        sealed = await ctx.blobs.get(row.blob_key as string);
      } catch {
        throw notFound();
      }
      const bytes = await open(ctx.keys, sealed, { aad: resumeBlobAad(ctx.userId, blobId) }).catch(() => {
        throw new ServiceError('unreadable_record', 500);
      });
      return { bytes, mime: row.mime as string, fileName: `resume-${id.slice(0, 8)}.${row.mime === PDF_MIME ? 'pdf' : 'docx'}` };
    });
  } catch (e) {
    throw mapPgError(e);
  }
}

// ---------- delete ----------

/**
 * Soft delete of the WHOLE resume family: a version shares its root's file, and the runner's purge deletes the blob of
 * the row it is given, so deleting one version alone would destroy the root's file. The root and all its versions get
 * deleted_at and purge_after together (CHECK); purge_after = now meets the 24 h bound. resume:purge is enqueued for the
 * root after commit (it collects the blob keys of the root and every version, deletes blobs first, then nulls rows).
 */
export async function deleteResume(ctx: ServiceCtx, input: unknown): Promise<{ id: string; deleted: true }> {
  const { id } = parseInput(IdInput, input);
  let root: string;
  try {
    root = await withUserTx(ctx, async (c) => {
      const now = ctx.now();
      const hit = (await c.query('SELECT COALESCE(parent_id, id) AS root FROM resumes WHERE id = $1 AND user_id = $2 AND deleted_at IS NULL FOR UPDATE', [id, ctx.userId])).rows[0];
      if (!hit) throw notFound();
      await c.query(
        `UPDATE resumes SET deleted_at = $3, purge_after = $3, is_default = false, updated_at = $3
          WHERE user_id = $2 AND deleted_at IS NULL AND (id = $1 OR parent_id = $1)`,
        [hit.root, ctx.userId, now],
      );
      return hit.root as string;
    });
  } catch (e) {
    throw mapPgError(e);
  }
  await enqueueOrFail(ctx, 'resume:purge', root);
  return { id, deleted: true };
}

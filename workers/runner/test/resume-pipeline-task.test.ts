import { randomUUID } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { verhoeffCheckDigit } from '@hirelane/engine';
import { EnvKeyProvider, generateMasterKey, MASTER_KEY_ENV, type BlobStore } from '../../../packages/vault/src/index';
import { createResumeExtractTasks } from '../src/tasks/resume-extract';
import { createResumeVault, fileAad, parsedAad, type ExtractClaim, type ExtractWrite, type ResumeRepo } from '../src/tasks/resume-common';
import type { ParsedResumeDoc } from '../src/resume/pipeline';
import * as fx from './fixtures/generate-resume-fixtures';

const base = '23456789012';
const AADHAAR = `${base}${verhoeffCheckDigit(base)}`;
const SPACED = `${AADHAAR.slice(0, 4)} ${AADHAAR.slice(4, 8)} ${AADHAAR.slice(8)}`;

function memBlobs(): BlobStore & { map: Map<string, Buffer> } {
  const map = new Map<string, Buffer>();
  return {
    map,
    put: async (k, d) => void map.set(k, d),
    get: async (k) => {
      const v = map.get(k);
      if (!v) throw new Error('missing');
      return v;
    },
    exists: async (k) => map.has(k),
    delete: async (k) => void map.delete(k),
  };
}

async function setup(opts: { bytes?: Uint8Array | null; prior?: unknown; supersede?: string[]; extract?: never } = {}) {
  const blobs = memBlobs();
  const vault = createResumeVault(blobs, new EnvKeyProvider({ [MASTER_KEY_ENV]: generateMasterKey() }));
  const id = randomUUID();
  const userId = randomUUID();
  const blobKey = `resumes/${userId}/${id}`;
  if (opts.bytes !== null) await vault.putBlob(blobKey, Buffer.from(opts.bytes ?? fx.textPdf()), fileAad(id, userId));
  const claim: ExtractClaim = { id, userId, blobKey, parsedEnc: opts.prior === undefined ? null : await vault.sealJson(opts.prior, parsedAad(id, userId)) };
  const writes: ExtractWrite[] = [];
  const repo = {
    claimExtract: vi.fn(async () => claim),
    finishExtract: vi.fn(async (_c: ExtractClaim, w: ExtractWrite) => (writes.push(w), true)),
    releaseExtract: vi.fn(async () => {}),
    failExtract: vi.fn(async () => {}),
    supersedeSensitive: vi.fn(async () => opts.supersede ?? []),
  } as unknown as ResumeRepo;
  const logs: string[] = [];
  const helpers = {
    logger: { info: (m: string) => logs.push(m), warn: (m: string) => logs.push(m), error: (m: string) => logs.push(m) },
    job: { attempts: 1, max_attempts: 25 },
    addJob: vi.fn(async () => {}),
  };
  const run = (p: unknown = { resumeId: id }, over: Partial<Parameters<typeof createResumeExtractTasks>[0]> = {}) =>
    createResumeExtractTasks({ repo, vault, now: () => new Date('2026-10-29T00:00:00Z'), ...over })['resume:extract']!(p, helpers as never);
  return { run, repo, vault, claim, writes, logs, helpers, blobs, id, userId };
}

describe('resume:extract', () => {
  it('rejects payloads that are not exactly { resumeId: uuid }', async () => {
    const t = await setup();
    for (const p of [null, {}, { resumeId: 'x' }, { resumeId: t.id, name: 'Asha' }, 'x', { id: t.id }]) await expect(t.run(p)).rejects.toThrow(/invalid payload/);
    expect(t.repo.claimExtract).not.toHaveBeenCalled();
  });

  it('is a no-op unless the row is still uploaded (claim returns null)', async () => {
    const t = await setup();
    (t.repo.claimExtract as ReturnType<typeof vi.fn>).mockResolvedValueOnce(null);
    await t.run();
    expect(t.repo.finishExtract).not.toHaveBeenCalled();
    expect(t.repo.failExtract).not.toHaveBeenCalled();
  });

  it('parses: seals the masked doc under the parsed_enc AAD and writes extractor columns', async () => {
    const t = await setup({ prior: { fileName: 'Asha_Example_Resume.pdf' } });
    await t.run();
    const w = t.writes[0]!;
    expect(w).toMatchObject({ status: 'parsed', rejectCode: null, textLayer: 'readable', pages: 1, healthTotal: 9 });
    expect(w.health).toHaveLength(9);
    const doc = (await t.vault.openJson(w.parsedEnc!, parsedAad(t.id, t.userId))) as ParsedResumeDoc;
    expect(doc.text).toContain('Asha Example');
    expect(doc.fileName).toBe('Asha_Example_Resume.pdf');
    // wrong AAD must not open
    await expect(t.vault.openJson(w.parsedEnc!, parsedAad(randomUUID(), t.userId))).rejects.toThrow();
  });

  it('carries builder answers from the prior parsed_enc into the parsed doc', async () => {
    const t = await setup({ prior: { fileName: 'A_B_Resume.pdf', answers: { name: 'Asha Example' } } });
    await t.run();
    const doc = (await t.vault.openJson(t.writes[0]!.parsedEnc!, parsedAad(t.id, t.userId))) as ParsedResumeDoc;
    expect(doc.builder).toEqual({ name: 'Asha Example' });
  });

  it('survives an unreadable prior parsed_enc (file name just becomes unknown)', async () => {
    const t = await setup();
    t.claim.parsedEnc = Buffer.from('not a vault object at all, definitely longer than the minimum header size');
    await t.run();
    expect(t.writes[0]!.status).toBe('parsed');
  });

  it('seals no Aadhaar value, flags the kind, and logs nothing but codes', async () => {
    const bytes = fx.docxFromDocumentXml(fx.docXml(['Asha Example', 'asha.example@example.test 90000 00001', `Aadhaar: ${SPACED}`, 'Skills', 'Python, SQL, Git']));
    const t = await setup({ bytes });
    await t.run();
    const w = t.writes[0]!;
    expect(w.sensitiveKinds).toContain('aadhaar');
    const sealedDoc = await t.vault.openJson(w.parsedEnc!, parsedAad(t.id, t.userId));
    expect(JSON.stringify(sealedDoc)).not.toContain(AADHAAR);
    expect(JSON.stringify(w.health)).not.toContain(AADHAAR);
    const log = t.logs.join('\n');
    for (const secret of ['Asha', 'example.test', AADHAAR, 'Python']) expect(log).not.toContain(secret);
    expect(t.helpers.addJob).not.toHaveBeenCalled();
  });

  it('a content rejection writes status rejected with the code and no parsed_enc', async () => {
    const t = await setup({ bytes: fx.fourPagePdf() });
    await t.run();
    expect(t.writes[0]).toMatchObject({ status: 'rejected', rejectCode: 'too_many_pages', pages: null, parsedEnc: null, healthPassed: 0, healthTotal: 0, health: [] });
  });

  it('an image-only PDF stops at needs_text with health issue 1 and no reject code', async () => {
    const t = await setup({ bytes: fx.imageOnlyPdf() });
    await t.run();
    const w = t.writes[0]!;
    expect(w).toMatchObject({ status: 'needs_text', rejectCode: null, parsedEnc: null, healthPassed: 0, healthTotal: 9 });
    expect((w.health[0] as { id: string }).id).toBe('ats_readable');
  });

  it('a replacement that parses clean enqueues an id-only purge for each superseded original', async () => {
    const old = randomUUID();
    const t = await setup({ supersede: [old] });
    await t.run();
    expect(t.repo.supersedeSensitive).toHaveBeenCalledWith(t.userId, expect.any(Date));
    expect(t.helpers.addJob).toHaveBeenCalledWith('resume:purge', { resumeId: old }, { jobKey: `resume:purge:${old}` });
  });

  it('does not look for superseded originals when the new resume itself holds an Aadhaar', async () => {
    const bytes = fx.docxFromDocumentXml(fx.docXml([`Aadhaar: ${SPACED}`, 'Skills', 'Python, SQL, Git']));
    const t = await setup({ bytes, supersede: [randomUUID()] });
    await t.run();
    expect(t.repo.supersedeSensitive).not.toHaveBeenCalled();
  });

  it('a missing or tampered blob fails the row for good (no stuck extracting, no retry loop)', async () => {
    const t = await setup({ bytes: null });
    await expect(t.run()).resolves.toBeUndefined();
    expect(t.repo.failExtract).toHaveBeenCalledWith(t.id, 'blob_unreadable', expect.any(Date));
    expect(t.repo.finishExtract).not.toHaveBeenCalled();
  });

  it('an unexpected error releases the claim and rethrows a message-free error so a retry can run', async () => {
    const t = await setup();
    const boom = vi.fn(async () => {
      throw new Error('secret pdf text Asha Example');
    });
    await expect(t.run(undefined, { extract: boom })).rejects.toThrow(/^resume:extract failed$/);
    expect(t.repo.releaseExtract).toHaveBeenCalledWith(t.id, expect.any(Date));
    expect(t.repo.failExtract).not.toHaveBeenCalled();
    expect(t.logs.join('\n')).not.toContain('Asha');
  });

  it('on the last attempt an unexpected error fails the row instead of leaving it extracting', async () => {
    const t = await setup();
    t.helpers.job = { attempts: 25, max_attempts: 25 };
    await expect(t.run(undefined, { extract: async () => Promise.reject(new Error('x')) })).resolves.toBeUndefined();
    expect(t.repo.failExtract).toHaveBeenCalledWith(t.id, 'internal_error', expect.any(Date));
  });

  it('does not overwrite a row that changed state while extracting (finish returns false)', async () => {
    const t = await setup();
    (t.repo.finishExtract as ReturnType<typeof vi.fn>).mockResolvedValueOnce(false);
    await t.run();
    expect(t.repo.supersedeSensitive).not.toHaveBeenCalled();
    expect(t.helpers.addJob).not.toHaveBeenCalled();
  });
});

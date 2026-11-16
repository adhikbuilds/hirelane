import { randomUUID } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { EnvKeyProvider, generateMasterKey, MASTER_KEY_ENV, type BlobStore } from '../../../packages/vault/src/index';
import { createResumeRenderTasks } from '../src/tasks/resume-render';
import { blobKeyFor, createResumeVault, fileAad, parsedAad, type DraftRow, type RenderWrite, type ResumeRepo } from '../src/tasks/resume-common';
import { runPipeline } from '../src/resume/pipeline';
import type { BuilderAnswers } from '../src/resume/render/index';

const answers: BuilderAnswers = {
  name: 'Asha Example',
  email: 'asha.example@example.test',
  phone: '90000 00001',
  education: [{ qualification: 'B.Tech Computer Science', institution: 'Example Institute of Technology', year: '2026', score: 'CGPA 8.2/10' }],
  skills: ['Python', 'SQL', 'Git'],
  projects: [{ title: 'Library tracker', link: 'https://github.com/asha-example/library', bullets: ['Built a REST API serving 1200 books', 'Cut latency by 40% with an index'] }],
};

async function setup(over: { draft?: unknown; noDraft?: boolean; finish?: boolean } = {}) {
  const map = new Map<string, Buffer>();
  const blobs: BlobStore = {
    put: async (k, d) => void map.set(k, d),
    get: async (k) => map.get(k)!,
    exists: async (k) => map.has(k),
    delete: async (k) => void map.delete(k),
  };
  const vault = createResumeVault(blobs, new EnvKeyProvider({ [MASTER_KEY_ENV]: generateMasterKey() }));
  const id = randomUUID();
  const userId = randomUUID();
  const draft: DraftRow = { id, userId, parsedEnc: await vault.sealJson(over.draft ?? { v: 1, answers }, parsedAad(id, userId)) };
  const finished: RenderWrite[] = [];
  const repo = {
    loadDraft: vi.fn(async () => (over.noDraft ? null : draft)),
    finishRender: vi.fn(async (_d: DraftRow, w: RenderWrite) => (finished.push(w), over.finish ?? true)),
    failRender: vi.fn(async () => {}),
  } as unknown as ResumeRepo;
  const logs: string[] = [];
  const helpers = {
    logger: { info: (m: string) => logs.push(m), warn: (m: string) => logs.push(m), error: (m: string) => logs.push(m) },
    job: { attempts: 1, max_attempts: 25 },
    addJob: vi.fn(async () => {}),
  };
  const run = (p: unknown = { resumeId: id }) =>
    createResumeRenderTasks({ repo, vault, now: () => new Date('2026-10-29T00:00:00Z') })['resume:render']!(p, helpers as never);
  return { run, repo, vault, map, finished, helpers, logs, id, userId };
}

describe('resume:render', () => {
  it('rejects bad payloads', async () => {
    const t = await setup();
    await expect(t.run({ resumeId: 'nope' })).rejects.toThrow(/invalid payload/);
    await expect(t.run({})).rejects.toThrow(/invalid payload/);
  });

  it('is a no-op when there is no builder draft to render', async () => {
    const t = await setup({ noDraft: true });
    await t.run();
    expect(t.map.size).toBe(0);
    expect(t.repo.finishRender).not.toHaveBeenCalled();
    expect(t.helpers.addJob).not.toHaveBeenCalled();
  });

  it('renders, seals the PDF under the file AAD, flips to uploaded, and enqueues resume:extract by id only', async () => {
    const t = await setup();
    await t.run();
    const key = blobKeyFor(t.userId, t.id);
    const w = t.finished[0]!;
    expect(w.blobKey).toBe(key);
    const sealed = t.map.get(key)!;
    expect(sealed.subarray(0, 3).toString()).toBe('HLV'); // stored sealed, never plain
    const pdf = await t.vault.getBlob(key, fileAad(t.id, t.userId));
    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
    expect(w.sizeBytes).toBe(pdf.length);
    expect(w.fileHmac).toMatch(/^[0-9a-f]{64}$/);
    expect(await t.vault.fileHmac(pdf)).toBe(w.fileHmac);
    const sealedMeta = (await t.vault.openJson(w.parsedEnc, parsedAad(t.id, t.userId))) as { fileName: string; answers: BuilderAnswers };
    expect(sealedMeta.fileName).toBe('Asha_Example_Resume.pdf');
    expect(sealedMeta.answers.name).toBe('Asha Example');
    expect(t.helpers.addJob).toHaveBeenCalledWith('resume:extract', { resumeId: t.id }, { jobKey: `resume:extract:${t.id}` });
  });

  it('what it stores passes the real extract pipeline: parsed, readable, 1 page, 9 of 9', async () => {
    const t = await setup();
    await t.run();
    const pdf = await t.vault.getBlob(blobKeyFor(t.userId, t.id), fileAad(t.id, t.userId));
    const o = await runPipeline(pdf, { fileName: 'Asha_Example_Resume.pdf' });
    expect(o).toMatchObject({ kind: 'parsed', textLayer: 'readable', pages: 1, healthPassed: 9 });
  });

  it('accepts a bare answers object as the draft body', async () => {
    const t = await setup({ draft: answers });
    await t.run();
    expect(t.finished).toHaveLength(1);
  });

  it('invalid answers fail the draft for good with a code, store nothing, and never log values', async () => {
    const t = await setup({ draft: { answers: { ...answers, email: 'secret@example.test', skills: [] } } });
    await expect(t.run()).resolves.toBeUndefined();
    expect(t.repo.failRender).toHaveBeenCalledWith(t.id, 'invalid_answers', expect.any(Date));
    expect(t.map.size).toBe(0);
    expect(t.logs.join('\n')).not.toContain('secret@example.test');
  });

  it('removes the blob and enqueues nothing if the row changed state while rendering', async () => {
    const t = await setup({ finish: false });
    await t.run();
    expect(t.map.size).toBe(0);
    expect(t.helpers.addJob).not.toHaveBeenCalled();
  });

  it('a transient error rethrows without the cause message; the last attempt fails the draft', async () => {
    const t = await setup();
    t.repo.finishRender = vi.fn(async () => {
      throw new Error('db down Asha Example');
    });
    await expect(t.run()).rejects.toThrow(/^resume:render failed$/);
    expect(t.map.size).toBe(0); // the orphan blob is cleaned up
    t.helpers.job = { attempts: 25, max_attempts: 25 };
    await expect(t.run()).resolves.toBeUndefined();
    expect(t.repo.failRender).toHaveBeenCalledWith(t.id, 'internal_error', expect.any(Date));
    expect(t.logs.join('\n')).not.toContain('Asha');
  });
});

describe('resume:render after the row is committed', () => {
  it('keeps the blob when the extract enqueue fails (the row points at it; resume:stuck-sweep re-queues)', async () => {
    const t = await setup();
    t.helpers.addJob = vi.fn(async () => {
      throw new Error('queue down');
    });
    await expect(t.run()).rejects.toThrow(/^resume:render failed$/);
    expect(t.finished).toHaveLength(1);
    expect(t.map.has(blobKeyFor(t.userId, t.id))).toBe(true);
  });
});

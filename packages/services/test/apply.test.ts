import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  AnswerInput,
  APPLICATION_STATUSES,
  applyAnswerAad,
  applyEvidenceAad,
  ApplicationSummarySchema,
  AutoApplyInput,
  inboundAad,
  ListApplicationsInput,
  makeHandle,
  parseInput,
  submitJobKey,
  SwipeInput,
  UNDO_WINDOW_SECONDS,
} from '../src';
import { answerAad } from '../src/aad';
import { idPayload } from '../src/schema';

describe('sealing conventions shared with the worker (workers/runner/src/tasks/apply-common.ts pins the same literals)', () => {
  it('binds every sealed value to its owner and row', () => {
    expect(applyAnswerAad('U', 'R')).toBe('applyans:U:R');
    expect(applyEvidenceAad('U', 'R')).toBe('applyev:U:R');
    expect(inboundAad('U', 'R')).toBe('inbound:U:R');
    expect(answerAad('U', 'R')).toBe('answer:U:R');
  });
  it('gives each kind of value its own AAD, so one cannot be opened as another', () => {
    expect(new Set([applyAnswerAad('U', 'R'), applyEvidenceAad('U', 'R'), inboundAad('U', 'R'), answerAad('U', 'R')]).size).toBe(4);
  });
});

describe('handles', () => {
  it('make a readable, valid, lower-case handle from the name', () => {
    for (let i = 0; i < 100; i++) expect(makeHandle('Rahul Kumar-Singh Jr.', 'x@example.test')).toMatch(/^rahul\.kumar\.[a-hj-km-np-z2-9]{3}$/);
    expect(makeHandle('Zoë Ñandú', 'x@example.test')).toMatch(/^zoe\.nandu\.[a-z0-9]{3}$/);
  });
  it('falls back to the email name, then to "student", and never starts with a reserved word', () => {
    expect(makeHandle(null, 'priya.nair+jobs@example.test')).toMatch(/^priyanair\.[a-z0-9]{3}$/);
    expect(makeHandle('日本語', '日@example.test')).toMatch(/^student\.[a-z0-9]{3}$/);
    expect(makeHandle('Admin Person', 'a@example.test')).toMatch(/^uadmin\.person\.[a-z0-9]{3}$/);
    expect(makeHandle('Mailey Joshi', 'a@example.test')).toMatch(/^umailey\.joshi\./);
  });
  it('always fits the database CHECK on handles', () => {
    const re = /^[a-z0-9][a-z0-9.]{1,38}[a-z0-9]$/;
    for (const name of ['A', 'Ab', 'x'.repeat(200), 'a b c d e f', "O'Brien", '   ', '1234 5678', 'A.B.C']) {
      const h = makeHandle(name, 'e@example.test');
      expect(h, name).toMatch(re);
      expect(h, name).not.toMatch(/\.\./);
    }
  });
});

describe('inputs are strict', () => {
  const id = randomUUID();
  it('swipe takes a job id and an optional resume id only', () => {
    expect(parseInput(SwipeInput, { jobId: id })).toEqual({ jobId: id });
    expect(parseInput(SwipeInput, { jobId: id, resumeId: id })).toEqual({ jobId: id, resumeId: id });
    for (const bad of [{}, { jobId: 'x' }, { jobId: id, extra: 1 }, null, 'str']) expect(() => parseInput(SwipeInput, bad), JSON.stringify(bad)).toThrow();
  });
  it('answers are trimmed, bounded and keyed by a safe token', () => {
    expect(parseInput(AnswerInput, { questionKey: 'notice_period', answer: '  30 days  ' }).answer).toBe('30 days');
    for (const bad of [{ questionKey: 'Notice Period', answer: 'x' }, { questionKey: 'a', answer: ' ' }, { questionKey: 'a', answer: 'x'.repeat(2001) }, { questionKey: 'a', answer: 'x', sensitive: 'yes' }]) {
      expect(() => parseInput(AnswerInput, bad), JSON.stringify(bad).slice(0, 50)).toThrow();
    }
  });
  it('consent is a strict boolean', () => {
    expect(parseInput(AutoApplyInput, { granted: false })).toEqual({ granted: false });
    for (const bad of [{}, { granted: 1 }, { granted: true, kind: 'terms' }]) expect(() => parseInput(AutoApplyInput, bad)).toThrow();
  });
  it('the tracker filter knows the statuses and a sane limit', () => {
    for (const s of APPLICATION_STATUSES) expect(parseInput(ListApplicationsInput, { status: s, limit: 100 }).status).toBe(s);
    for (const bad of [{ status: 'done' }, { limit: 0 }, { limit: 101 }, { limit: 1.5 }]) expect(() => parseInput(ListApplicationsInput, bad)).toThrow();
  });
});

describe('contracts', () => {
  it('the submit job is an id-only payload with one job key per application', () => {
    const id = randomUUID();
    expect(idPayload.safeParse({ applicationId: id }).success).toBe(true);
    expect(submitJobKey(id)).toBe(`apply:submit:${id}`);
  });
  it('the undo window is the 4 seconds the database enforces', () => {
    expect(UNDO_WINDOW_SECONDS).toBe(4);
  });
  it('a summary view refuses unknown keys, so a column can never leak by accident', () => {
    const base = {
      id: randomUUID(), status: 'ready', company: 'Acme', title: 'Dev', platform: 'lever', undoUntil: new Date().toISOString(), canUndo: true,
      blockedReason: null, fallback: null, needsYouCount: 0, lastReply: null, createdAt: new Date().toISOString(), submittedAt: null,
    };
    expect(ApplicationSummarySchema.safeParse(base).success).toBe(true);
    expect(ApplicationSummarySchema.safeParse({ ...base, apply_url: 'x' }).success).toBe(false);
  });
});

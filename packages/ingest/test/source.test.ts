import { afterEach, describe, expect, it, vi } from 'vitest';
import { SOURCE_KINDS, SHARE_PLATFORMS, campusDriveSource, sourceForPosting, userSharedSource } from '../src/source';

describe('sourceForPosting', () => {
  it('ATS boards: kind is the ats, label names the platform and company, url is the original posting', () => {
    expect(sourceForPosting({ ats: 'greenhouse', boardToken: 'cred', companyName: 'CRED', url: 'https://boards.greenhouse.io/cred/jobs/1' })).toEqual({
      sourceKind: 'greenhouse', sourceLabel: 'Greenhouse · CRED', sourceUrl: 'https://boards.greenhouse.io/cred/jobs/1',
    });
    expect(sourceForPosting({ ats: 'lever', boardToken: 'x', companyName: 'X', url: 'https://jobs.lever.co/x/1' }).sourceLabel).toBe('Lever · X');
    expect(sourceForPosting({ ats: 'ashby', boardToken: 'x', companyName: 'X', url: 'https://jobs.ashbyhq.com/x/1' }).sourceLabel).toBe('Ashby · X');
  });
  it('jsonld: label is the careers host; zoho: label is the posting host', () => {
    expect(sourceForPosting({ ats: 'jsonld', boardToken: 'careers.trelliscloud.in', companyName: 'Trellis', url: 'https://careers.trelliscloud.in/jobs/1' })).toEqual({
      sourceKind: 'jsonld', sourceLabel: 'careers.trelliscloud.in', sourceUrl: 'https://careers.trelliscloud.in/jobs/1',
    });
    expect(sourceForPosting({ ats: 'zoho_rss', boardToken: 'in-60012345678', companyName: 'T', url: 'https://trellis.zohorecruit.in/recruit/ViewJob.na?d=1' }).sourceLabel).toBe('trellis.zohorecruit.in');
  });
  it('kinds list is the closed set from the spec', () => {
    expect([...SOURCE_KINDS]).toEqual(['greenhouse', 'lever', 'ashby', 'jsonld', 'zoho_rss', 'campus_drive', 'user_shared']);
  });
});

describe('userSharedSource', () => {
  afterEach(() => vi.restoreAllMocks());

  it('stores only the url and the platform label', () => {
    expect(userSharedSource('https://www.reddit.com/r/developersIndia/comments/abc/hiring/', 'reddit')).toEqual({
      ok: true, fields: { sourceKind: 'user_shared', sourceLabel: 'Shared from Reddit', sourceUrl: 'https://www.reddit.com/r/developersIndia/comments/abc/hiring/' },
    });
    for (const p of SHARE_PLATFORMS) {
      const r = userSharedSource('https://example.com/x', p);
      expect(r.ok && r.fields.sourceLabel).toBe(p === 'other' ? 'Shared link' : `Shared from ${{ reddit: 'Reddit', whatsapp: 'WhatsApp', linkedin: 'LinkedIn', telegram: 'Telegram' }[p as string]}`);
    }
  });
  it('never touches the network', () => {
    const f = vi.spyOn(globalThis, 'fetch');
    userSharedSource('https://www.reddit.com/r/x/comments/1', 'reddit');
    expect(f).not.toHaveBeenCalled();
  });
  it('drops fragments and credentials-bearing, non-https, private and junk urls', () => {
    expect(userSharedSource('https://a.com/x#frag', 'other')).toMatchObject({ ok: true, fields: { sourceUrl: 'https://a.com/x' } });
    for (const bad of ['http://a.com/x', 'javascript:alert(1)', 'https://user:pw@a.com/x', 'https://localhost/x', 'https://127.0.0.1/x', 'https://10.0.0.5/x', 'not a url', '', 'https://a.com/' + 'x'.repeat(2100)]) {
      expect(userSharedSource(bad, 'reddit')).toMatchObject({ ok: false });
    }
  });
  it('rejects unknown platforms', () => {
    expect(userSharedSource('https://a.com/x', 'facebook' as never)).toEqual({ ok: false, reason: 'bad_platform' });
  });
});

describe('campusDriveSource', () => {
  it('labels with the college and keeps the https drive url', () => {
    expect(campusDriveSource('IIT Madras', 'https://placement.iitm.ac.in/drive/1')).toEqual({
      sourceKind: 'campus_drive', sourceLabel: 'Campus drive · IIT Madras', sourceUrl: 'https://placement.iitm.ac.in/drive/1',
    });
  });
});

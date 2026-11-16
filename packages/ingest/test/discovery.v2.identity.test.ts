import { describe, expect, it } from 'vitest';
import { verifyIdentity, isDistinctiveName } from '../src/discovery/v2/identity';

const ev = (o: Partial<Parameters<typeof verifyIdentity>[1]> = {}) => ({ boardNames: [], jobUrls: [], texts: [], ...o });

describe('isDistinctiveName', () => {
  it('multi-word or long names are distinctive; short single words are not', () => {
    expect(isDistinctiveName('Cashfree Payments')).toBe(true);
    expect(isDistinctiveName('Razorpay')).toBe(true);
    expect(isDistinctiveName('Bolt')).toBe(false);
    expect(isDistinctiveName('Stream')).toBe(false);
    expect(isDistinctiveName('Slice')).toBe(false);
    expect(isDistinctiveName('Fi Money')).toBe(true);
  });
});

describe('verifyIdentity', () => {
  it('distinctive name + matching board company_name is verified', () => {
    expect(verifyIdentity({ name: 'Cashfree Payments', domain: 'cashfree.com' }, ev({ boardNames: ['Cashfree Payments'] }))).toMatchObject({ status: 'verified', by: ['board_name'] });
  });
  it('company suffixes do not break the match', () => {
    expect(verifyIdentity({ name: 'Razorpay Software Pvt Ltd', domain: 'razorpay.com' }, ev({ boardNames: ['Razorpay'] })).status).toBe('verified');
  });
  it('a board that names a different company is a mismatch (token collision)', () => {
    const r = verifyIdentity({ name: 'Stream Finance India', domain: 'streamfinance.in' }, ev({ boardNames: ['Stream (getstream.io)'], jobUrls: ['https://job-boards.greenhouse.io/stream/jobs/1'] }));
    expect(r.status).toBe('mismatch');
  });
  it('short generic names need domain evidence: a name-only match is ambiguous, not verified', () => {
    const r = verifyIdentity({ name: 'Bolt', domain: 'bolt.in' }, ev({ boardNames: ['Bolt'], jobUrls: ['https://job-boards.greenhouse.io/bolt/jobs/1'] }));
    expect(r.status).toBe('ambiguous');
  });
  it('...and become verified when a job url is on the company domain', () => {
    const r = verifyIdentity({ name: 'Bolt', domain: 'bolt.in' }, ev({ boardNames: ['Bolt'], jobUrls: ['https://careers.bolt.in/open/1'] }));
    expect(r).toMatchObject({ status: 'verified', by: expect.arrayContaining(['domain']) });
  });
  it('...or when a description mentions the domain', () => {
    const r = verifyIdentity({ name: 'Bolt', domain: 'bolt.in' }, ev({ texts: ['Apply via bolt.in/careers today'] }));
    expect(r.status).toBe('verified');
  });
  it('a lookalike domain is not the domain (notbolt.in, bolt.in.evil.com)', () => {
    expect(verifyIdentity({ name: 'Bolt', domain: 'bolt.in' }, ev({ jobUrls: ['https://notbolt.in/x', 'https://bolt.in.evil.com/x'] })).status).toBe('ambiguous');
  });
  it('lever/ashby (no board name): a distinctive name in two or more descriptions verifies', () => {
    const t = ['Join Zerodha Broking and build', 'About Zerodha Broking: India largest'];
    expect(verifyIdentity({ name: 'Zerodha Broking', domain: 'zerodha.com' }, ev({ texts: t })).status).toBe('verified');
    expect(verifyIdentity({ name: 'Zerodha Broking', domain: 'zerodha.com' }, ev({ texts: [t[0]!] })).status).toBe('ambiguous');
  });
  it('no evidence at all is ambiguous', () => {
    expect(verifyIdentity({ name: 'Razorpay', domain: 'razorpay.com' }, ev()).status).toBe('ambiguous');
  });
  it('works without a domain', () => {
    expect(verifyIdentity({ name: 'Cashfree Payments' }, ev({ boardNames: ['Cashfree Payments'] })).status).toBe('verified');
  });
});

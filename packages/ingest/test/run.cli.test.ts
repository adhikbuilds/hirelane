import { describe, expect, it } from 'vitest';
import { parseArgs } from '../src/run/args';

describe('parseArgs', () => {
  it('parses --mode fixture and --mode=live', () => {
    expect(parseArgs(['--mode', 'fixture']).mode).toBe('fixture');
    expect(parseArgs(['--mode=live']).mode).toBe('live');
  });
  it('ignores a bare -- separator', () => {
    expect(parseArgs(['--', '--mode', 'fixture']).mode).toBe('fixture');
    expect(parseArgs(['--mode', 'fixture', '--']).mode).toBe('fixture');
  });
  it('defaults to HIRELANE_INGEST_MODE when unset, then fixture', () => {
    expect(parseArgs([], { HIRELANE_INGEST_MODE: 'live' }).mode).toBe('live');
    expect(parseArgs([], {}).mode).toBe('fixture');
  });
  it('rejects an unknown mode', () => {
    expect(() => parseArgs(['--mode', 'turbo'])).toThrow(/mode/);
  });
  it('collects --fixtures-dir and repeated --inject-status in fixture mode', () => {
    const a = parseArgs(['--mode', 'fixture', '--fixtures-dir', '/x', '--inject-status', 'ashby:openai=500', '--inject-status=lever:cred=429']);
    expect(a.fixturesDir).toBe('/x');
    expect(a.inject).toEqual({ 'ashby:openai': 500, 'lever:cred': 429 });
  });
  it('refuses fixture-only options in live mode', () => {
    expect(() => parseArgs(['--mode', 'live', '--inject-status', 'ashby:openai=500'])).toThrow(/fixture/);
    expect(() => parseArgs(['--mode', 'live', '--fixtures-dir', '/x'])).toThrow(/fixture/);
  });
  it('rejects unknown flags', () => {
    expect(() => parseArgs(['--nope'])).toThrow(/unknown/);
  });
  it('parses --concurrency', () => {
    expect(parseArgs(['--concurrency', '3']).concurrency).toBe(3);
    expect(() => parseArgs(['--concurrency', '0'])).toThrow();
  });
});

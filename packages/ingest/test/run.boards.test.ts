import { describe, expect, it } from 'vitest';
import { loadBoardConfig, slugify } from '../src/run/boards';

describe('slugify', () => {
  it.each([
    ['Airbyte', 'airbyte'],
    ['Hello World, Inc.', 'hello-world-inc'],
    ['  Zoho/Corp  ', 'zoho-corp'],
    ['Crème Brûlée', 'creme-brulee'],
  ])('%s -> %s', (i, o) => expect(slugify(i)).toBe(o));
});

describe('loadBoardConfig', () => {
  it('loads the verified boards from boards.json', () => {
    const b = loadBoardConfig();
    expect(b.length).toBeGreaterThanOrEqual(100);
    for (const x of b) {
      expect(x.verifiedAt).toBeInstanceOf(Date);
      expect(x.slug).toMatch(/^[a-z0-9-]+$/);
    }
  });
  it('has unique ats:token and unique slugs', () => {
    const b = loadBoardConfig();
    expect(new Set(b.map((x) => `${x.ats}:${x.token}`)).size).toBe(b.length);
    expect(new Set(b.map((x) => x.slug)).size).toBe(b.length);
  });
  it('contains the three recon-verified boards', () => {
    const keys = loadBoardConfig().map((x) => `${x.ats}:${x.token}`);
    for (const k of ['ashby:openai', 'ashby:benchling', 'ashby:temporal']) expect(keys).toContain(k);
  });
});

import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { loadBoardConfig } from '../src/run/boards';

const dir = fileURLToPath(new URL('../fixtures/logos/', import.meta.url));
const manifest = JSON.parse(readFileSync(`${dir}manifest.json`, 'utf8')) as Record<string, { source: string; url?: string; domain: string; recordedAt: string }>;

describe('committed fixture logos', () => {
  it('cover exactly the five mini boards, each with source and date', () => {
    expect(Object.keys(manifest).sort()).toEqual(['airtable', 'benchling', 'cred', 'openai', 'temporal']);
    for (const m of Object.values(manifest)) expect(Number.isNaN(Date.parse(m.recordedAt))).toBe(false);
  });
  it('domains match boards.json', () => {
    const cfg = new Map(loadBoardConfig().map((b) => [b.slug, b.domain]));
    for (const [slug, m] of Object.entries(manifest)) expect(cfg.get(slug)).toBe(m.domain);
  });
  it.each(Object.entries(manifest))('%s: fetched means a 64x64 PNG from its own domain, monogram means no file', async (slug, m) => {
    const file = `${dir}${slug}.png`;
    if (m.source === 'monogram') return expect(existsSync(file)).toBe(false);
    const meta = await sharp(readFileSync(file)).metadata();
    expect([meta.format, meta.width, meta.height]).toEqual(['png', 64, 64]);
    const host = new URL(m.url!).hostname;
    expect(host === m.domain || host.endsWith(`.${m.domain}`)).toBe(true);
  });
});

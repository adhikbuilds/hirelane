import { describe, expect, it } from "vitest";

/**
 * Acceptance against a running dev server (reuses :3001). Skipped when the server or its data is absent,
 * so CI without a web process stays green. Run `pnpm dev` first to include it.
 */
const BASE = process.env["WEB_BASE_URL"] ?? "http://localhost:3001";

async function firstSlug(): Promise<string | null> {
  try {
    const xml = await (await fetch(`${BASE}/sitemaps/jobs/1.xml`, { signal: AbortSignal.timeout(5000) })).text();
    return /<loc>[^<]*\/job\/([a-z0-9-]+)<\/loc>/.exec(xml)?.[1] ?? null;
  } catch {
    return null;
  }
}
const slug = await firstSlug();

describe.skipIf(!slug)("markdown negotiation against the running app", () => {
  it("serves text/markdown on Accept with Vary: Accept and a body at most 30% of the HTML", async () => {
    const md = await fetch(`${BASE}/job/${slug}`, { headers: { accept: "text/markdown" } });
    const html = await fetch(`${BASE}/job/${slug}`, { headers: { accept: "text/html" } });
    expect(md.status).toBe(200);
    expect(md.headers.get("content-type")).toMatch(/^text\/markdown/);
    expect(md.headers.get("vary")).toMatch(/\bAccept\b/);
    expect(html.headers.get("content-type")).toMatch(/^text\/html/);
    const mdBody = await md.text();
    const htmlBody = await html.text();
    expect(Buffer.byteLength(mdBody)).toBeLessThanOrEqual(Buffer.byteLength(htmlBody) * 0.3);
    expect(mdBody).not.toMatch(/<(script|style|iframe)/i);
    // 30 s: the first request to a cold dev server compiles the route, which can exceed vitest's 5 s default (flaked once).
  }, 30_000);

  it("the .md suffix returns the same document", async () => {
    const a = await (await fetch(`${BASE}/job/${slug}`, { headers: { accept: "text/markdown" } })).text();
    const res = await fetch(`${BASE}/job/${slug}.md`, { headers: { accept: "text/html" } });
    expect(res.headers.get("content-type")).toMatch(/^text\/markdown/);
    expect(res.headers.get("vary")).toMatch(/\bAccept\b/);
    expect((await res.text()).split("\n").slice(0, 3)).toEqual(a.split("\n").slice(0, 3));
  });

  it("supports conditional requests and HEAD", async () => {
    const first = await fetch(`${BASE}/job/${slug}.md`);
    const etag = first.headers.get("etag")!;
    expect(etag).toMatch(/^W\//);
    const again = await fetch(`${BASE}/job/${slug}.md`, { headers: { "if-none-match": etag } });
    expect(again.status).toBe(304);
    const head = await fetch(`${BASE}/job/${slug}.md`, { method: "HEAD" });
    expect(head.status).toBe(200);
    expect(await head.text()).toBe("");
  });

  it("returns a markdown 404 for an unknown slug and 404 for the internal path", async () => {
    const missing = await fetch(`${BASE}/job/no-such-job-zzz.md`);
    expect(missing.status).toBe(404);
    expect(missing.headers.get("content-type")).toMatch(/^text\/markdown/);
    expect((await fetch(`${BASE}/md/job/${slug}`)).status).toBe(404);
  });
});

describe.skipIf(!slug)("sitemaps, robots and llms.txt against the running app", () => {
  it("serves xml with the right content type and every chunk exactly once", async () => {
    const idx = await fetch(`${BASE}/sitemap.xml`);
    expect(idx.headers.get("content-type")).toMatch(/^application\/xml/);
    const locs = [...(await idx.text()).matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]!);
    expect(locs.some((l) => l.endsWith("/sitemaps/jobs/1.xml"))).toBe(true);
    const seen = new Set<string>();
    for (const l of locs.filter((x) => /\/sitemaps\/jobs\/\d+\.xml$/.test(x))) {
      const body = await (await fetch(`${BASE}${new URL(l).pathname}`)).text();
      for (const m of body.matchAll(/<loc>([^<]+)<\/loc>/g)) {
        expect(seen.has(m[1]!)).toBe(false);
        seen.add(m[1]!);
      }
    }
    expect(seen.size).toBeGreaterThan(0);
    expect((await fetch(`${BASE}/sitemaps/jobs/99999.xml`)).status).toBe(404);
    expect((await fetch(`${BASE}/sitemaps/jobs/abc.xml`)).status).toBe(404);
  });

  it("serves robots.txt and llms.txt as text", async () => {
    const robots = await fetch(`${BASE}/robots.txt`);
    expect(robots.headers.get("content-type")).toMatch(/^text\/plain/);
    expect(await robots.text()).toContain("/sitemap.xml");
    const llms = await fetch(`${BASE}/llms.txt`);
    expect(llms.headers.get("content-type")).toMatch(/^text\/plain/);
    expect(await llms.text()).toContain("# Hirelane");
  });
});

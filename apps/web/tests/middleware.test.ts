import { describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { config, middleware } from "../middleware";

const req = (path: string, accept?: string) =>
  new NextRequest(`http://localhost:3001${path}`, { headers: accept ? { accept } : {} });

describe("middleware: markdown negotiation", () => {
  it("rewrites Accept: text/markdown on /job/<slug> to the internal markdown route", () => {
    const res = middleware(req("/job/data-eng-acme", "text/markdown"));
    expect(res.headers.get("x-middleware-rewrite")).toBe("http://localhost:3001/md/job/data-eng-acme");
  });

  it("rewrites the .md suffix even when the client asks for HTML", () => {
    const res = middleware(req("/job/data-eng-acme.md", "text/html"));
    expect(res.headers.get("x-middleware-rewrite")).toBe("http://localhost:3001/md/job/data-eng-acme");
  });

  // Note: this asserts the middleware response object. On the wire Next replaces Vary on HTML pages (observed on 15.5 dev),
  // so HTML Vary: Accept is not yet verified end to end; the markdown response does carry it (see markdown-live.test.ts).
  it("lets HTML through with Vary: Accept and an alternate link", () => {
    const res = middleware(req("/job/data-eng-acme", "text/html,*/*;q=0.8"));
    expect(res.headers.get("x-middleware-rewrite")).toBeNull();
    expect(res.headers.get("x-middleware-next")).toBe("1");
    expect(res.headers.get("vary")).toMatch(/\bAccept\b/);
    expect(res.headers.get("link")).toContain('</job/data-eng-acme.md>; rel="alternate"; type="text/markdown"');
  });

  it("404s direct hits on the internal path", () => {
    expect(middleware(req("/md/job/data-eng-acme", "text/markdown")).status).toBe(404);
  });

  it("matches only the job and md paths it owns", () => {
    expect(config.matcher).toEqual(expect.arrayContaining(["/job/:path*", "/md/:path*"]));
  });
});

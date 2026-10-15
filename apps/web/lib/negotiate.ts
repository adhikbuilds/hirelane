/** Content negotiation for /job/{slug}. Pure, so it runs in middleware and in unit tests. */

const SLUG = "[a-z0-9][a-z0-9-]{0,199}";
const MD_PATH = new RegExp(`^/job/(${SLUG})\\.md$`);
const HTML_PATH = new RegExp(`^/job/(${SLUG})$`);
const MAX_RANGES = 64;

type Range = { type: string; q: number };

function parseAccept(header: string): Range[] {
  const out: Range[] = [];
  for (const part of header.split(",", MAX_RANGES)) {
    const [rawType, ...params] = part.split(";");
    const type = rawType?.trim().toLowerCase();
    if (!type || !/^[a-z*][a-z0-9!#$&^_.+*-]*\/[a-z0-9!#$&^_.+*-]+$/.test(type)) continue;
    let q = 1;
    let bad = false;
    for (const p of params) {
      const m = /^\s*q\s*=\s*(.*?)\s*$/i.exec(p);
      if (!m) continue;
      const v = m[1] ?? "";
      if (!/^(0(\.\d{0,3})?|1(\.0{0,3})?)$/.test(v)) bad = true;
      else q = Number(v);
    }
    if (!bad) out.push({ type, q });
  }
  return out;
}

/** q of the most specific matching range: exact, then `type/*`, then `*` slash `*`. No match is 0. */
function qualityFor(ranges: Range[], type: string): number {
  const group = `${type.split("/")[0]}/*`;
  for (const key of [type, group, "*/*"]) {
    const hit = ranges.find((r) => r.type === key);
    if (hit) return hit.q;
  }
  return 0;
}

/** Markdown is served only when it is explicitly preferred over HTML. Ties, wildcards and a missing header give HTML. */
export function prefersMarkdown(accept: string | null | undefined): boolean {
  if (!accept) return false;
  const ranges = parseAccept(accept);
  const md = qualityFor(ranges, "text/markdown");
  return md > 0 && md > qualityFor(ranges, "text/html");
}

export type JobRoute =
  | { kind: "rewrite"; to: string }
  | { kind: "html"; slug: string }
  | { kind: "notfound" }
  | { kind: "pass" };

export function routeJobPath(pathname: string, accept: string | null | undefined): JobRoute {
  if (pathname === "/md" || pathname.startsWith("/md/")) return { kind: "notfound" };
  const md = MD_PATH.exec(pathname);
  if (md) return { kind: "rewrite", to: `/md/job/${md[1]}` };
  const html = HTML_PATH.exec(pathname);
  if (!html) return { kind: "pass" };
  const slug = html[1] as string;
  return prefersMarkdown(accept) ? { kind: "rewrite", to: `/md/job/${slug}` } : { kind: "html", slug };
}

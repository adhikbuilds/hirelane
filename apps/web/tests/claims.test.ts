import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { CLAIMS, KNOWN_DEBT, SHIPPED, findClaimViolations, type ShippedFlags } from "../lib/claims";

const ROOT = join(__dirname, "..");
const none: ShippedFlags = { ...SHIPPED };
const all = Object.fromEntries(Object.keys(SHIPPED).map((k) => [k, true])) as ShippedFlags;

describe("claims scanner", () => {
  it("nothing in the core loop is shipped today", () => {
    expect(Object.values(SHIPPED).every((v) => v === false)).toBe(true);
  });

  it.each([
    ["You approve every application.", "approve-every-application"],
    ["Your resume is stored encrypted.", "stored-encrypted"],
    ["We fill it in.", "we-fill"],
    ["Hirelane auto-fills the form.", "auto-fill"],
    ["It hands off to the employer's own form.", "hand-off"],
    ["Hirelane tracks replies for you.", "tracks-replies"],
  ])("fails present-tense claim %j", (text, id) => {
    expect(findClaimViolations(text, none).map((v) => v.claim)).toEqual([id]);
  });

  it.each([
    "Hirelane will hand off to the employer's form.",
    "Once accounts open, resumes will be stored encrypted.",
    "Drafting and hand-off open with early access.",
    "Hirelane does not auto-fill anything yet.",
    "What Hirelane never does.",
  ])("passes hedged or future wording %j", (text) => {
    expect(findClaimViolations(text, none)).toEqual([]);
  });

  it("judges each sentence on its own: a hedge elsewhere in the line does not excuse a claim", () => {
    expect(findClaimViolations("Hirelane does not submit applications. It hands off to the employer's form.", none)).toHaveLength(1);
  });

  it("allows a claim once its feature flag is shipped", () => {
    expect(findClaimViolations("You approve every application.", all)).toEqual([]);
    expect(findClaimViolations("You approve every application.", { ...none, approvalQueue: true })).toEqual([]);
    expect(findClaimViolations("We fill it in.", { ...none, approvalQueue: true })).toHaveLength(1);
  });

  it("ignores comments and import lines", () => {
    expect(findClaimViolations("// we fill it in\n/* hands off */\nimport x from 'hand-off';", none)).toEqual([]);
  });

  it("maps every claim to a known flag", () => {
    for (const c of CLAIMS) expect(Object.keys(SHIPPED)).toContain(c.feature);
  });
});

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === ".next") continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.tsx?$/.test(name) && !/\.(test|spec)\./.test(name)) out.push(p);
  }
  return out;
}

describe("user-facing copy guard", () => {
  const files = [...walk(join(ROOT, "app")), ...walk(join(ROOT, "components"))].filter(
    (f) => !relative(ROOT, f).startsWith(join("app", "api")) && !relative(ROOT, f).startsWith(join("app", "dev")),
  );
  const found = files.flatMap((f) =>
    findClaimViolations(readFileSync(f, "utf8"), SHIPPED).map((v) => ({ file: relative(ROOT, f), ...v })),
  );
  const isDebt = (v: { file: string; claim: string; sentence: string }) =>
    KNOWN_DEBT.some((d) => d.file === v.file && d.claim === v.claim && v.sentence.includes(d.snippet));

  it("scans a real set of files", () => {
    expect(files.length).toBeGreaterThan(50);
  });

  it("has no present-tense capability claim for an unshipped feature", () => {
    expect(found.filter((v) => !isDebt(v)).map((v) => `${v.file}: [${v.claim}] ${v.sentence}`)).toEqual([]);
  });

  it("keeps the known-debt list honest: every entry still matches something", () => {
    const stale = KNOWN_DEBT.filter((d) => !found.some((v) => v.file === d.file && v.claim === d.claim && v.sentence.includes(d.snippet)));
    expect(stale).toEqual([]);
  });
});

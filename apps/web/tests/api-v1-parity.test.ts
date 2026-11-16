import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { ACTION_EXEMPT, ACTION_TWINS, ROUTE_ONLY } from "../lib/api/parity";
import { buildOpenApiV1, V1_OPERATIONS } from "../lib/openapi-v1";

const WEB = resolve(import.meta.dirname, "..");

function walk(dir: string, out: string[] = []): string[] {
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}

/** Every actions.ts anywhere under app/ (new ones are picked up automatically). */
const actionFiles = (): string[] =>
  walk(join(WEB, "app"))
    .filter((f) => /(^|\/)actions\.ts$/.test(f))
    .map((f) => relative(WEB, f))
    .sort();

export function exportedActions(src: string): { names: string[]; other: string[] } {
  const names = [...src.matchAll(/^export\s+async\s+function\s+([A-Za-z0-9_]+)/gm)].map((m) => m[1]!);
  const other = [...src.matchAll(/^export\s+(?!async\s+function|type\s|interface\s)(.*)$/gm)].map((m) => m[1]!.slice(0, 40));
  return { names, other };
}

/** Returns the actions with no v1 twin (empty means parity holds). */
export function missingTwins(file: string, names: string[], twins = ACTION_TWINS, ops = V1_OPERATIONS.map((o) => o.operationId)): string[] {
  const map = twins[file] ?? {};
  return names.filter((n) => !map[n] || !ops.includes(map[n]!));
}

describe("every server action has a v1 twin or a written exemption", () => {
  it("finds the action files", () => {
    expect(actionFiles()).toEqual([...new Set([...Object.keys(ACTION_TWINS), ...Object.keys(ACTION_EXEMPT)])].sort());
  });

  for (const file of actionFiles()) {
    it(`${file}: each exported action maps to a v1 operation, and the map has no stale entries`, () => {
      const { names, other } = exportedActions(readFileSync(join(WEB, file), "utf8"));
      expect(other, "a use-server file may only export async functions").toEqual([]);
      expect(names.length).toBeGreaterThan(0);
      const exempt = Object.keys(ACTION_EXEMPT[file] ?? {});
      expect(missingTwins(file, names.filter((n) => !exempt.includes(n)))).toEqual([]);
      expect([...Object.keys(ACTION_TWINS[file] ?? {}), ...exempt].sort()).toEqual([...names].sort());
      for (const reason of Object.values(ACTION_EXEMPT[file] ?? {})) expect(reason.length).toBeGreaterThan(10);
      expect(readFileSync(join(WEB, file), "utf8").trimStart().startsWith('"use server"')).toBe(true);
    });
  }

  it("the checker really fails on an action with no twin", () => {
    const src = 'export async function sneakyAction() {}\nexport async function confirmResumeAction() {}\n';
    const { names } = exportedActions(src);
    expect(missingTwins("app/(app)/resume/actions.ts", names)).toEqual(["sneakyAction"]);
    expect(missingTwins("app/(app)/new/actions.ts", ["confirmResumeAction"])).toEqual(["confirmResumeAction"]);
    expect(missingTwins("app/(app)/resume/actions.ts", ["confirmResumeAction"], ACTION_TWINS, ["somethingElse"])).toEqual(["confirmResumeAction"]);
    expect(exportedActions("export const x = 1;\nexport default function f() {}").other).toHaveLength(2);
  });

  it("every v1 operation is either the twin of an action or listed as route-only, and has a route file", () => {
    const twinned = new Set(Object.values(ACTION_TWINS).flatMap((m) => Object.values(m)));
    for (const op of V1_OPERATIONS) {
      expect(twinned.has(op.operationId) || ROUTE_ONLY.includes(op.operationId), op.operationId).toBe(true);
      if (twinned.has(op.operationId)) expect(ROUTE_ONLY.includes(op.operationId), `${op.operationId} is in both lists`).toBe(false);
      const file = join(WEB, op.path.replace("/api/v1", "app/api/v1").replace("{id}", "[id]"), "route.ts");
      expect(existsSync(file), file).toBe(true);
      expect(readFileSync(file, "utf8")).toMatch(new RegExp(`export const ${op.method.toUpperCase()}\\b`));
    }
    expect(ROUTE_ONLY.every((r) => V1_OPERATIONS.some((o) => o.operationId === r))).toBe(true);
  });

  it("every route.ts under app/api/v1 is in the OpenAPI document", () => {
    const doc = buildOpenApiV1("http://x.test");
    const routes = walk(join(WEB, "app/api/v1")).filter((f) => f.endsWith("route.ts")).map((f) => relative(WEB, f));
    for (const r of routes) {
      const path = "/" + r.replace(/\/route\.ts$/, "").replace("/[id]", "/{id}");
      if (path === "/app/api/v1/openapi.json") continue;
      expect(doc.paths[path.replace(/^\/app/, "")], r).toBeDefined();
    }
  });
});

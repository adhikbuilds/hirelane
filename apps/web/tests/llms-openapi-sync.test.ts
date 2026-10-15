import { describe, expect, it } from "vitest";
import { GET as openapiGET } from "../app/openapi.json/route";
import { llmsTxt } from "../lib/llms";

/**
 * Keeps the parameter names that /llms.txt tells agents to use in step with /openapi.json, the contract they
 * generate clients from. Both documents are read from the same code paths the site serves.
 */

const ORIGIN = "https://hirelane.test";
const LIST_PATH = "/api/public/jobs";

type OpenApiDoc = { paths: Record<string, { get?: { parameters?: { name: string; in: string }[] } }> };

/** Query parameter names of the list endpoint, in document order. The path parameter `slug` belongs to another operation. */
export function openApiQueryParams(doc: OpenApiDoc): string[] {
  const params = doc.paths[LIST_PATH]?.get?.parameters ?? [];
  return params.filter((p) => p.in === "query").map((p) => p.name);
}

/**
 * Names listed under "Parameters for the list endpoint" in llms.txt, in document order. The section ends at the
 * first H2 heading or at the paragraph that follows the list.
 */
export function llmsParamNames(body: string): string[] {
  const start = body.indexOf("Parameters for the list endpoint");
  if (start < 0) return [];
  const rest = body.slice(start).split("\n");
  const names: string[] = [];
  for (const line of rest.slice(1)) {
    if (line.startsWith("## ") || line.startsWith("Money is")) break;
    const m = /^- `([A-Za-z0-9_-]+)`:/.exec(line);
    if (m?.[1]) names.push(m[1]);
  }
  return names;
}

/** Empty when the two lists agree exactly, including order. Anything else is a drift report. */
export function paramDrift(llms: string[], openapi: string[]): { onlyInLlms: string[]; onlyInOpenApi: string[]; orderDiffers: boolean } {
  const inLlms = new Set(llms);
  const inOpenApi = new Set(openapi);
  return {
    onlyInLlms: llms.filter((n) => !inOpenApi.has(n)),
    onlyInOpenApi: openapi.filter((n) => !inLlms.has(n)),
    orderDiffers: llms.length !== openapi.length || llms.some((n, i) => n !== openapi[i]),
  };
}

const isClean = (d: ReturnType<typeof paramDrift>) => d.onlyInLlms.length === 0 && d.onlyInOpenApi.length === 0 && !d.orderDiffers;

describe("llms.txt parameters match /openapi.json", () => {
  it("serves the list endpoint parameters in the same names and order", async () => {
    const res = await openapiGET();
    expect(res.status).toBe(200);
    const doc = (await res.json()) as OpenApiDoc;

    const fromOpenApi = openApiQueryParams(doc);
    const fromLlms = llmsParamNames(llmsTxt(ORIGIN));

    // Guard against a vacuous pass: a renamed heading or a missing section must not compare two empty lists.
    expect(fromOpenApi.length).toBeGreaterThan(0);
    expect(fromLlms.length).toBeGreaterThan(0);
    expect(paramDrift(fromLlms, fromOpenApi)).toEqual({ onlyInLlms: [], onlyInOpenApi: [], orderDiffers: false });
    // Exact list equality as well, so a duplicated bullet fails even if no name is missing.
    expect(fromLlms).toEqual(fromOpenApi);
  });

  it("reports a renamed parameter in llms.txt as drift (the check can fail)", async () => {
    const doc = (await (await openapiGET()).json()) as OpenApiDoc;
    const mutated = llmsTxt(ORIGIN).replace("- `min_pay`:", "- `minPay`:");
    expect(mutated).not.toBe(llmsTxt(ORIGIN));

    const drift = paramDrift(llmsParamNames(mutated), openApiQueryParams(doc));
    expect(isClean(drift)).toBe(false);
    expect(drift.onlyInLlms).toEqual(["minPay"]);
    expect(drift.onlyInOpenApi).toEqual(["min_pay"]);
  });

  it("reports a dropped parameter in llms.txt as drift", async () => {
    const doc = (await (await openapiGET()).json()) as OpenApiDoc;
    const dropped = llmsTxt(ORIGIN).replace(/^- `page_size`:.*\n/m, "");
    const drift = paramDrift(llmsParamNames(dropped), openApiQueryParams(doc));
    expect(drift.onlyInOpenApi).toEqual(["page_size"]);
  });

  it("reports a duplicated bullet in llms.txt as drift", async () => {
    const doc = (await (await openapiGET()).json()) as OpenApiDoc;
    const names = llmsParamNames(llmsTxt(ORIGIN));
    const duplicated = [...names, "q"];
    const drift = paramDrift(duplicated, openApiQueryParams(doc));
    expect(isClean(drift)).toBe(false);
    expect(drift.orderDiffers).toBe(true);
  });

  it("reports a reordered list as drift", async () => {
    const doc = (await (await openapiGET()).json()) as OpenApiDoc;
    const names = openApiQueryParams(doc);
    const swapped = [names[1] as string, names[0] as string, ...names.slice(2)];
    expect(paramDrift(swapped, names).orderDiffers).toBe(true);
  });
});

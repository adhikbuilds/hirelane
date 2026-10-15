/** OpenAPI 3.1 document for the public API. Schemas come from the same contract the tests validate against. */
import { API_PARAM_ORDER } from "./public-api-params";
import { SCHEMA_DEFS, jobsEnvelope } from "./public-api-schema";

type Json = Record<string, any>;

const refs = (v: unknown): unknown => JSON.parse(JSON.stringify(v).replaceAll("#/$defs/", "#/components/schemas/"));

const ROLE_NOTE = "One of the role family slugs, for example data-engineer.";

const PARAMS: Record<(typeof API_PARAM_ORDER)[number], { description: string; schema: Json }> = {
  q: { description: "Free text over title, company and skills. Up to four words of two or more characters; every word must match.", schema: { type: "string", minLength: 1, maxLength: 100 } },
  role: { description: ROLE_NOTE, schema: { type: "string" } },
  country: { description: "ISO 3166-1 alpha-2. Strict: the job must name this country. Worldwide-remote jobs are reachable with remote=1.", schema: { type: "string", pattern: "^[A-Za-z]{2}$" } },
  remote: { description: "1 or true to keep remote jobs only. 0 or false is the same as omitting it.", schema: { enum: ["1", "0", "true", "false"] } },
  salary: { description: "1 or true to keep jobs that state pay.", schema: { enum: ["1", "0", "true", "false"] } },
  workplace: { description: "Workplace type.", schema: { enum: ["remote", "hybrid", "onsite"] } },
  employment: { description: "Employment type.", schema: { enum: ["fulltime", "contract", "parttime", "intern"] } },
  level: { description: "Seniority. experienced covers senior, lead and executive.", schema: { enum: ["entry", "mid", "experienced", "intern"] } },
  visa: { description: "1 or true to keep jobs that mention visa sponsorship.", schema: { enum: ["1", "0", "true", "false"] } },
  posted: { description: "Posted within this many days.", schema: { type: "integer", minimum: 1, maximum: 365 } },
  page: { description: "1-based page number. Pages past the last return an empty list with the true total.", schema: { type: "integer", minimum: 1, maximum: 100, default: 1 } },
  sort: { description: "fresh is newest first. pay is highest annual pay floor first, in currency; jobs with no stated pay come last.", schema: { enum: ["fresh", "pay"], default: "fresh" } },
  company: { description: "Company slug.", schema: { type: "string", pattern: "^[a-z0-9][a-z0-9-]{0,199}$" } },
  min_pay: { description: "Annual pay floor in whole major units of currency. Keeps jobs whose top of range is at least this. Jobs with no stated pay are excluded.", schema: { type: "integer", minimum: 1, maximum: 1000000000 } },
  currency: { description: "Currency used by min_pay and sort=pay.", schema: { enum: ["USD", "INR"], default: "USD" } },
  page_size: { description: "Jobs per page.", schema: { type: "integer", minimum: 1, maximum: 100, default: 50 } },
};

const RATE_HEADERS = {
  "RateLimit-Limit": { schema: { type: "integer" }, description: "Requests allowed per minute per client." },
  "RateLimit-Remaining": { schema: { type: "integer" }, description: "Requests left in the current window." },
};

const errorContent = { "application/json": { schema: { $ref: "#/components/schemas/Error" } } };
const cors = { "Access-Control-Allow-Origin": { schema: { type: "string", const: "*" } } };

export function buildOpenApi(origin: string): Json {
  const slugParam = { name: "slug", in: "path", required: true, schema: { type: "string", pattern: "^[a-z0-9][a-z0-9-]{0,199}$" } };
  const ok = (schema: Json) => ({
    description: "OK",
    headers: { ETag: { schema: { type: "string" }, description: "Weak validator. Send it back as If-None-Match." }, ...RATE_HEADERS, ...cors },
    content: { "application/json": { schema } },
  });
  const notModified = { description: "Not modified. Body is empty.", headers: { ETag: { schema: { type: "string" } }, ...cors } };
  const limited = {
    description: "Rate limited.",
    headers: { "Retry-After": { schema: { type: "integer" }, description: "Seconds until the window resets." }, ...cors },
    content: errorContent,
  };
  return {
    openapi: "3.1.0",
    info: {
      title: "Hirelane public jobs API",
      version: "1.0.0",
      description:
        "Open jobs read from public employer job boards. Read-only, no key. 60 requests per minute per client. " +
        "Pay is shown only when the posting states it; amounts are integer minor units. Hirelane does not submit applications.",
    },
    servers: [{ url: origin }],
    paths: {
      "/api/public/jobs": {
        get: {
          operationId: "listJobs",
          summary: "List open jobs",
          parameters: API_PARAM_ORDER.map((name) => ({ name, in: "query", required: false, ...PARAMS[name] })),
          responses: {
            "200": ok({ $ref: "#/components/schemas/JobsResponse" }),
            "304": notModified,
            "400": { description: "A parameter has an invalid value.", headers: cors, content: errorContent },
            "429": limited,
          },
        },
      },
      "/api/public/jobs/{slug}": {
        get: {
          operationId: "getJob",
          summary: "One job, with requirements and the pay trace",
          parameters: [slugParam],
          responses: {
            "200": ok({ $ref: "#/components/schemas/JobDetail" }),
            "304": notModified,
            "404": { description: "No job with that slug.", headers: cors, content: errorContent },
            "429": limited,
          },
        },
      },
    },
    components: { schemas: { ...(refs(SCHEMA_DEFS) as Json), JobsResponse: refs(jobsEnvelope) } },
  };
}

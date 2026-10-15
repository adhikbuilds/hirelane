/**
 * Schemas for the public API, derived from the committed contract (lib/contracts/jobs.schema.json).
 * The contract's JobDetail uses allOf over a closed JobSummary, which rejects the detail-only fields, so the
 * effective detail schema is built here by merging properties instead.
 */
import contract from "./contracts/jobs.schema.json";

type Json = Record<string, any>;
const root = contract as Json;

const defs: Json = root["$defs"];

function buildDetail(): Json {
  const summary = defs["JobSummary"] as Json;
  const extra = (defs["JobDetail"] as Json)["properties"] as Json;
  const { additionalProperties: _closed, ...open } = summary;
  void _closed;
  return {
    description: (defs["JobDetail"] as Json)["description"],
    ...open,
    properties: { ...summary["properties"], ...extra },
    required: [...summary["required"], ...Object.keys(extra)],
    additionalProperties: false,
  };
}

/** Error codes the API can emit, including the 500 that the contract file does not enumerate. */
function buildError(): Json {
  const e = structuredClone(defs["Error"]) as Json;
  e["properties"]["error"]["properties"]["code"] = {
    enum: ["invalid_param", "page_out_of_range", "rate_limited", "not_found", "internal_error"],
  };
  return e;
}

export const SCHEMA_DEFS: Json = { ...defs, JobDetail: buildDetail(), Error: buildError() };

const { $schema: _s, $id: _i, $defs: _d, ...envelope } = root;
void _s; void _i; void _d;

export const jobsResponseSchema: Json = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: "urn:hirelane:public:jobs:v1",
  ...envelope,
  $defs: SCHEMA_DEFS,
};

export const jobDetailResponseSchema: Json = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: "urn:hirelane:public:job:v1",
  $ref: "#/$defs/JobDetail",
  $defs: SCHEMA_DEFS,
};

export const errorResponseSchema: Json = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: "urn:hirelane:public:error:v1",
  $ref: "#/$defs/Error",
  $defs: SCHEMA_DEFS,
};

/** The envelope without $defs/$id, for embedding as components.schemas.JobsResponse. */
export const jobsEnvelope: Json = envelope;

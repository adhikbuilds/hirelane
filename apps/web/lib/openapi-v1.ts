/**
 * OpenAPI 3.1 document for /api/v1, built from the same zod schemas the services parse with, so the document cannot
 * drift from behaviour. Separate from the public API document (lib/openapi.ts). The contract tests parse real responses
 * with the response schemas listed here.
 */
import {
  BuilderFinishSchema,
  BuilderStateSchema,
  ConfirmInput,
  ConfirmResultSchema,
  DeleteResultSchema,
  EligibilityGetSchema,
  EligibilityViewSchema,
  FinishInput,
  MeSchema,
  ProblemSchema,
  ResumeListSchema,
  ResumeViewSchema,
  SaveInput,
  StepInput,
  UploadResultSchema,
} from "@hirelane/services";
import { z } from "zod";

type Json = Record<string, any>;

export interface V1Operation {
  operationId: string;
  method: "get" | "post" | "put" | "delete";
  path: string;
  summary: string;
  mutation: boolean;
  /** JSON request body schema (the path id is supplied by the URL, not the body). */
  request?: z.ZodType;
  /** Keys removed from the request schema because the URL provides them. */
  omit?: string[];
  success: { status: number; schema?: z.ZodType; contentType?: string; description: string };
}

export const V1_OPERATIONS: V1Operation[] = [
  { operationId: "listResumes", method: "get", path: "/api/v1/resumes", summary: "List my active resumes", mutation: false, success: { status: 200, schema: ResumeListSchema, description: "Resumes, newest first" } },
  {
    operationId: "uploadResume",
    method: "post",
    path: "/api/v1/resumes",
    summary: "Upload a resume (raw body; Content-Type is the file MIME type)",
    mutation: true,
    success: { status: 202, schema: UploadResultSchema, description: "Accepted; extraction runs in the background" },
  },
  { operationId: "getResume", method: "get", path: "/api/v1/resumes/{id}", summary: "Get one resume with its masked parse", mutation: false, success: { status: 200, schema: ResumeViewSchema, description: "The resume" } },
  { operationId: "deleteResume", method: "delete", path: "/api/v1/resumes/{id}", summary: "Delete a resume (purged within 24 hours)", mutation: true, success: { status: 200, schema: DeleteResultSchema, description: "Soft-deleted; purge queued" } },
  {
    operationId: "confirmResume",
    method: "post",
    path: "/api/v1/resumes/{id}/confirm",
    summary: "Confirm the parse: creates a new version and saves the eligibility profile",
    mutation: true,
    request: ConfirmInput,
    omit: ["id"],
    success: { status: 201, schema: ConfirmResultSchema, description: "The new confirmed version" },
  },
  {
    operationId: "downloadResume",
    method: "get",
    path: "/api/v1/resumes/{id}/file",
    summary: "Download the original file (audited)",
    mutation: false,
    success: { status: 200, contentType: "application/octet-stream", description: "File bytes" },
  },
  { operationId: "getEligibility", method: "get", path: "/api/v1/eligibility", summary: "Get my eligibility profile", mutation: false, success: { status: 200, schema: EligibilityGetSchema, description: "Profile or null" } },
  { operationId: "saveEligibility", method: "put", path: "/api/v1/eligibility", summary: "Save my eligibility profile (counts as confirmation)", mutation: true, request: SaveInput, success: { status: 200, schema: EligibilityViewSchema, description: "The saved profile" } },
  { operationId: "saveBuilderStep", method: "post", path: "/api/v1/builder/steps", summary: "Save one guided-builder answer", mutation: true, request: StepInput, success: { status: 200, schema: BuilderStateSchema, description: "Builder progress" } },
  { operationId: "finishBuilder", method: "post", path: "/api/v1/builder/finish", summary: "Render the builder draft to a PDF", mutation: true, request: FinishInput, success: { status: 202, schema: BuilderFinishSchema, description: "Render queued" } },
  { operationId: "getMe", method: "get", path: "/api/v1/me", summary: "Who am I", mutation: false, success: { status: 200, schema: MeSchema, description: "The signed-in user" } },
  { operationId: "exportMe", method: "get", path: "/api/v1/me/export", summary: "Export everything held about me", mutation: false, success: { status: 200, schema: z.record(z.string(), z.unknown()), description: "JSON export" } },
];

const jsonSchema = (s: z.ZodType, io: "input" | "output", omit: string[] = []): Json => {
  const out = z.toJSONSchema(s, { io, unrepresentable: "any", target: "draft-2020-12" }) as Json;
  delete out["$schema"];
  for (const k of omit) {
    delete out["properties"]?.[k];
    if (Array.isArray(out["required"])) out["required"] = out["required"].filter((r: string) => r !== k);
  }
  return out;
};

const ID_PARAM = { name: "id", in: "path", required: true, schema: { type: "string", format: "uuid" } };
const IDEMPOTENCY = { name: "Idempotency-Key", in: "header", required: true, description: "8 to 200 characters of A-Z a-z 0-9 _ . : -. A repeat with the same key returns the stored response.", schema: { type: "string", pattern: "^[A-Za-z0-9_.:-]{8,200}$" } };
const problem = { description: "Problem details (RFC 9457)", content: { "application/problem+json": { schema: { $ref: "#/components/schemas/Problem" } } } };

export function buildOpenApiV1(origin: string): Json {
  const paths: Json = {};
  for (const op of V1_OPERATIONS) {
    const parameters: Json[] = [];
    if (op.path.includes("{id}")) parameters.push(ID_PARAM);
    if (op.mutation) parameters.push(IDEMPOTENCY);
    if (op.operationId === "uploadResume") {
      parameters.push({ name: "X-File-Name", in: "header", required: false, description: "URL-encoded original file name, at most 255 characters. Stored only inside the sealed parse.", schema: { type: "string", maxLength: 765 } });
      parameters.push({ name: "label", in: "query", required: false, schema: { type: "string", maxLength: 80 } });
    }
    const o: Json = {
      operationId: op.operationId,
      summary: op.summary,
      security: [{ sessionCookie: [] }],
      parameters,
      responses: {
        [String(op.success.status)]: {
          description: op.success.description,
          content: op.success.schema
            ? { "application/json": { schema: jsonSchema(op.success.schema, "output") } }
            : { [op.success.contentType ?? "application/octet-stream"]: { schema: { type: "string", format: "binary" } } },
        },
        "400": problem,
        "401": problem,
        "404": problem,
        "429": problem,
      },
    };
    if (op.mutation) o["responses"]["403"] = problem;
    if (op.request) o["requestBody"] = { required: true, content: { "application/json": { schema: jsonSchema(op.request, "input", op.omit) } } };
    if (op.operationId === "uploadResume") {
      o["requestBody"] = {
        required: true,
        description: "The file bytes. Content-Type must be application/pdf or the DOCX type; at most 5 MB.",
        content: { "application/pdf": { schema: { type: "string", format: "binary" } }, "application/vnd.openxmlformats-officedocument.wordprocessingml.document": { schema: { type: "string", format: "binary" } } },
      };
      o["responses"]["413"] = problem;
      o["responses"]["415"] = problem;
      o["responses"]["409"] = problem;
    }
    if (["confirmResume", "deleteResume", "finishBuilder", "saveBuilderStep"].includes(op.operationId)) o["responses"]["409"] = problem;
    (paths[op.path] ??= {})[op.method] = o;
  }
  return {
    openapi: "3.1.0",
    info: { title: "Hirelane app API (v1)", version: "1.0.0", description: "Student account API: resumes, eligibility and the guided builder. Cookie session today; Bearer tokens are reserved for the Android client." },
    servers: [{ url: origin }],
    paths,
    components: {
      securitySchemes: { sessionCookie: { type: "apiKey", in: "cookie", name: "__Host-hl_session" } },
      schemas: { Problem: jsonSchema(ProblemSchema, "output") },
    },
  };
}

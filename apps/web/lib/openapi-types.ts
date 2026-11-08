import type { z } from "zod";

/** One /api/v1 operation, as lib/openapi-v1.ts builds the document from it. Kept apart so the campus operations can use it without a cycle. */
export interface V1Operation {
  operationId: string;
  method: "get" | "post" | "put" | "delete";
  path: string;
  summary: string;
  mutation: boolean;
  /** Marks the operation deprecated in the document. */
  deprecated?: boolean;
  /** False for a mutation that takes no Idempotency-Key (account delete). Default true. */
  idempotent?: boolean;
  /** JSON request body schema (the path id is supplied by the URL, not the body). */
  request?: z.ZodType;
  /** Keys removed from the request schema because the URL provides them. */
  omit?: string[];
  success: { status: number; schema?: z.ZodType; contentType?: string; description: string };
  /** A raw (non-JSON) request body, for uploads. */
  rawRequest?: { contentType: string; description: string };
  /** Query parameters. */
  query?: { name: string; description: string; type: "string" | "integer"; format?: string }[];
  /** Extra error statuses this operation can answer, beyond the standard 400/401/404/429 (and 403 on mutations). */
  errors?: number[];
}

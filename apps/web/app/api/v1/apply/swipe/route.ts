import { POST as apply } from "../applications/route";

export const dynamic = "force-dynamic";

/** Deprecated alias of POST /api/v1/apply/applications, kept for callers that still use the old path. Same behaviour, same rate bucket. */
export const POST = apply;

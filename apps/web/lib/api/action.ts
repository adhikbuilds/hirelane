import { isServiceError, type Issue, type ServiceCtx } from "@hirelane/services";
import { currentSession, openAction, openRead } from "../auth/request";
import { serviceCtxFor } from "../http/ctx";
import { writeRateGate } from "../http/v1";

/** What a server action returns: plain data the client can serialise. Failures carry a stable code, never a message. */
export type ActionResult<T> = { ok: true; data: T } | { ok: false; status: number; code: string; issues?: Issue[] };

const fail = (status: number, code: string, issues?: Issue[]): ActionResult<never> => ({ ok: false, status, code, ...(issues ? { issues } : {}) });

/**
 * Front door for the resume and eligibility server actions: accounts flag (404 via next/navigation), Origin check,
 * session, then the same service function the /api/v1 twin calls. Cross-user access is a 404 from the service.
 */
export async function runAction<T>(fn: (ctx: ServiceCtx) => Promise<T>): Promise<ActionResult<T>> {
  const req = await openAction();
  if (!req.ok) return fail(403, "bad_origin");
  const me = await currentSession(req);
  if (!me) return fail(401, "unauthenticated");
  // Same per-user WRITE budget as the /api/v1 twin. (Idempotency-Key is an HTTP-client concept; a form post has none.)
  const limited = await writeRateGate(me.userId);
  if (limited) return fail(limited.status, limited.code);
  try {
    return { ok: true, data: await fn(serviceCtxFor(me.userId)) };
  } catch (e) {
    if (isServiceError(e)) return fail(e.status, e.code, e.issues);
    console.error(`[action] unhandled ${e instanceof Error ? e.name : "error"}`);
    return fail(500, "internal_error");
  }
}

/** For server components: the same service calls, signed-in only. Returns null when signed out (the page redirects). */
export async function withPageCtx<T>(fn: (ctx: ServiceCtx) => Promise<T>): Promise<T | null> {
  const req = await openRead();
  const me = await currentSession(req);
  return me ? fn(serviceCtxFor(me.userId)) : null;
}

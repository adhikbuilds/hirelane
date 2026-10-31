/** Where a validation failed. Path and zod code only: never the value, which may be PII. */
export interface Issue {
  path: string;
  code: string;
}

/**
 * The only error a service throws on purpose. `code` is a stable machine string, `status` the HTTP status
 * the web action or /api/v1 route will answer with. Cross-user access is `notFound()`, never 403.
 */
export class ServiceError extends Error {
  readonly code: string;
  readonly status: number;
  readonly issues?: Issue[];

  constructor(code: string, status: number, issues?: Issue[]) {
    super(code);
    this.name = 'ServiceError';
    this.code = code;
    this.status = status;
    if (issues) this.issues = issues;
  }
}

export const isServiceError = (e: unknown): e is ServiceError => e instanceof ServiceError;

/** Missing and not-yours are indistinguishable on purpose. */
export const notFound = (): ServiceError => new ServiceError('not_found', 404);

export interface Problem {
  type: 'about:blank';
  title: string;
  status: number;
  code: string;
  requestId: string;
  issues?: Issue[];
}

/** RFC 9457 problem+json body. Unknown errors become a bare 500: no message and no stack leave the process. */
export function toProblem(e: unknown, requestId: string): Problem {
  if (isServiceError(e)) {
    return {
      type: 'about:blank',
      title: e.code,
      status: e.status,
      code: e.code,
      requestId,
      ...(e.issues ? { issues: e.issues } : {}),
    };
  }
  return { type: 'about:blank', title: 'internal_error', status: 500, code: 'internal_error', requestId };
}

/**
 * Translates a database error into a ServiceError by SQLSTATE and constraint name. Never reads the message into the
 * result (it can carry row values), except to tell an RLS refusal from a column-privilege refusal on 42501.
 * Anything not recognised is returned unchanged so the caller's wrapper turns it into a bare 500.
 */
export function mapPgError(e: unknown): unknown {
  if (isServiceError(e)) return e;
  if (typeof e !== 'object' || e === null) return e;
  const { code, constraint, message } = e as { code?: unknown; constraint?: unknown; message?: unknown };
  const c = typeof constraint === 'string' ? constraint : undefined;
  switch (code) {
    case '23514':
      // The root-cap trigger raises check_violation with no constraint name; real CHECKs carry one.
      if (c === 'drives_per_cohort_limit') return new ServiceError('drive_limit', 429);
      return c ? new ServiceError('invalid_input', 400) : new ServiceError('too_many_resumes', 409);
    case '23505':
      if (c === 'resumes_root_file_uq') return new ServiceError('duplicate_resume', 409);
      if (c === 'resumes_one_default_uq') return new ServiceError('default_conflict', 409);
      if (c === 'answer_bank_user_key_uq') return new ServiceError('duplicate_answer', 409);
      return new ServiceError('conflict', 409);
    case '23503':
      return notFound();
    case '42501':
      return typeof message === 'string' && message.includes('row-level security') ? notFound() : e;
    default:
      return e;
  }
}

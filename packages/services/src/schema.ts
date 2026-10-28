import { z } from 'zod';
import { ServiceError, type Issue } from './errors';

/**
 * Zod conventions for every service:
 *   - input objects are `z.strictObject` (unknown keys are an error, not silently dropped)
 *   - every service calls `parseInput(schema, input)` first and gets typed data or a 400 ServiceError
 *   - ids are `idSchema`; strings that reach SQL or a queue are length-bounded
 */
export const idSchema = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);

/** Graphile job payload: string ids only. No names, emails, text or nesting. */
export const idPayload = z.record(z.string().regex(/^[A-Za-z][A-Za-z0-9]{0,31}$/), idSchema);
export type JobPayload = Readonly<Record<string, string>>;

export function parseInput<T extends z.ZodType>(schema: T, input: unknown): z.infer<T> {
  const r = schema.safeParse(input);
  if (r.success) return r.data;
  const issues: Issue[] = r.error.issues.map((i) => ({ path: i.path.map(String).join('.'), code: i.code }));
  throw new ServiceError('invalid_input', 400, issues);
}

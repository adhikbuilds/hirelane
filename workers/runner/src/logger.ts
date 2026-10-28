/**
 * Redacting logger for the worker. The runner has no pino dependency, so this wraps graphile-worker's console log
 * factory with the same idea as pino `redact`: a fixed list of sensitive keys is replaced in log metadata, and email
 * addresses are scrubbed from message text. Never log PII; this is the safety net, not permission to.
 */
import { consoleLogFactory, type LogFunctionFactory } from 'graphile-worker';

export const REDACTED = '[redacted]';

/** Lower-case key names whose values are never logged, at any depth (pino path style: `*.email`, `req.headers.authorization`). */
export const REDACT_KEYS: readonly string[] = [
  'email',
  'phone',
  'resume',
  'answers',
  'authorization',
  'cookie',
  'set-cookie',
  'password',
  'token',
  'api_key',
  'apikey',
];

export const REDACT_PATHS: readonly string[] = [
  ...REDACT_KEYS.map((k) => `*.${k}`),
  ...REDACT_KEYS,
  'req.headers.authorization',
  'req.headers.cookie',
  'res.headers.set-cookie',
];

const KEYS = new Set(REDACT_KEYS);
const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
const MAX_DEPTH = 8;

export function redactText(s: string): string {
  return s.replace(EMAIL_RE, REDACTED);
}

export function redact(value: unknown, depth = 0): unknown {
  if (typeof value === 'string') return redactText(value);
  if (value === null || typeof value !== 'object') return value;
  if (depth >= MAX_DEPTH) return REDACTED;
  if (value instanceof Error) return { name: value.name, message: redactText(value.message) };
  if (Array.isArray(value)) return value.map((v) => redact(v, depth + 1));
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    out[k] = KEYS.has(k.toLowerCase()) ? REDACTED : redact(v, depth + 1);
  }
  return out;
}

export const redactingLogFactory: LogFunctionFactory = (scope) => {
  const inner = consoleLogFactory(scope);
  return (level, message, meta) => inner(level, redactText(String(message)), meta === undefined ? meta : (redact(meta) as typeof meta));
};

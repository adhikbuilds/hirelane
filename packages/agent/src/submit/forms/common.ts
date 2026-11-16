import { FormParseError, type FieldKind, type FileRole } from '../types';

export const asObject = (v: unknown, what: string): Record<string, unknown> => {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new FormParseError(`${what} is not an object`);
  return v as Record<string, unknown>;
};
export const asArray = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
export const str = (v: unknown): string => (typeof v === 'string' ? v : typeof v === 'number' ? String(v) : '');

export function parseJson(body: string, what: string): unknown {
  try {
    return JSON.parse(body);
  } catch {
    throw new FormParseError(`${what} is not JSON`);
  }
}

/** A text control's kind from the name it submits under and what the label says. */
export function textKind(name: string, label: string): FieldKind {
  const s = `${name} ${label}`.toLowerCase();
  if (/e-?mail/.test(s)) return 'email';
  if (/phone|mobile|\btel\b|contact number/.test(s)) return 'phone';
  if (/\burl\b|linkedin|github|portfolio|website|\blink\b/.test(s)) return 'url';
  return 'text';
}

export function fileRole(name: string, label: string): FileRole {
  const s = `${name} ${label}`.toLowerCase();
  if (/cover/.test(s)) return 'cover_letter';
  if (/resume|\bcv\b|curriculum/.test(s)) return 'resume';
  return 'other';
}

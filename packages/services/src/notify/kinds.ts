import { z } from 'zod';

/** The four kinds P0-6 adds. Each is a Home row and an email. */
export const NOTIFY_KINDS = ['drive_published', 'drive_closing', 'employer_reply', 'outcome_verified'] as const;
export type NotifyKind = (typeof NOTIFY_KINDS)[number];

/** Always emailed: they are about the student's own applications and offers. */
export const CRITICAL_KINDS = ['employer_reply', 'outcome_verified'] as const;
/** The student may turn their email off (an unsubscribe link in every one of them). The Home row stays. */
export const OPTIONAL_KINDS = ['drive_published', 'drive_closing'] as const;
export type OptionalKind = (typeof OPTIONAL_KINDS)[number];

export const isCritical = (k: string): boolean => (CRITICAL_KINDS as readonly string[]).includes(k);

export const SetPrefInput = z.strictObject({ kind: z.enum(OPTIONAL_KINDS), email: z.boolean() });

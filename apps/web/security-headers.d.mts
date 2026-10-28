export function buildCsp(env?: Record<string, string | undefined>): string;
export const HSTS_VALUE: string;
export function buildSecurityHeaders(env?: Record<string, string | undefined>): { key: string; value: string }[];

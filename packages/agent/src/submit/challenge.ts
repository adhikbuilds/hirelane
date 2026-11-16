import type { BlockKind, HttpResponse } from './types';

/**
 * Markers of a CAPTCHA, a bot-check or a login wall. Seeing one is the end of the attempt: the student finishes on the
 * employer's site. We never solve, wait out, evade or work around any of them.
 */
const CAPTCHA = /g-recaptcha|h-captcha|hcaptcha\.com|cf-turnstile|challenges\.cloudflare\.com\/turnstile|recaptcha\/api|data-sitekey|arkoselabs|funcaptcha|"captcha"\s*:|"requiresCaptcha"\s*:\s*true/i;
const CHALLENGE = /cf-challenge|challenge-platform|<title>\s*just a moment|attention required|px-captcha|datadome|_incapsula_|verify you are (?:a )?human|are you a robot|unusual traffic/i;
const LOGIN = /type\s*=\s*["']password["']|sign in to (?:continue|apply)|log ?in to (?:continue|apply)|create an account to apply|(?:sign|log) ?in required|"requiresLogin"\s*:\s*true/i;

/** What a page body shows, in order of how final it is. null when it shows nothing of the kind. */
export function detectBlockInBody(body: string): BlockKind | null {
  if (CAPTCHA.test(body)) return 'captcha';
  if (CHALLENGE.test(body)) return 'challenge';
  if (LOGIN.test(body)) return 'login';
  return null;
}

/** What an HTTP response shows: a login redirect, a 401, a bot-check page, or a CAPTCHA in the body. */
export function detectBlock(res: HttpResponse): BlockKind | null {
  const fromBody = detectBlockInBody(res.body);
  if (fromBody) return fromBody;
  const loc = res.headers['location'] ?? res.headers['Location'] ?? '';
  if (res.status >= 300 && res.status < 400 && /\/(?:log-?in|sign-?in|signup|register|accounts?)\b/i.test(loc)) return 'login';
  if (res.status === 401) return 'login';
  if (res.status === 403 && /cloudflare|akamai|datadome|perimeterx|incapsula/i.test(JSON.stringify(res.headers))) return 'challenge';
  return null;
}

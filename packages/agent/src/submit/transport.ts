import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PLATFORMS, TransportRefused, type HttpRequest, type HttpResponse, type Platform, type Transport } from './types';

/**
 * Fixture hosts end in .fixture.invalid. The .invalid TLD is reserved (RFC 2606) and can never resolve, so even a bug that
 * let a fixture URL through could not reach a real server. Nothing else is ever allowed by the default transport.
 */
export const FIXTURE_HOST_SUFFIX = '.fixture.invalid';

export function isFixtureUrl(url: string): boolean {
  try {
    const u = new URL(url);
    return u.protocol === 'https:' && u.hostname.toLowerCase().endsWith(FIXTURE_HOST_SUFFIX) && u.username === '' && u.password === '';
  } catch {
    return false;
  }
}

/** Wraps a transport so that it can only ever be asked for fixture hosts. */
export function guardTransport(inner: Transport): Transport {
  return {
    send(req: HttpRequest): Promise<HttpResponse> {
      if (!isFixtureUrl(req.url)) {
        let host = 'invalid';
        try {
          host = new URL(req.url).hostname;
        } catch {
          /* keep the placeholder */
        }
        return Promise.reject(new TransportRefused(host));
      }
      return inner.send(req);
    },
  };
}

const DIR = join(import.meta.dirname, 'fixtures');
const read = (name: string): string => readFileSync(join(DIR, name), 'utf8');

const FORM_FILE: Record<Platform, { ok: string; captcha: string; login?: string }> = {
  greenhouse: { ok: 'greenhouse-form.json', captcha: 'greenhouse-form-captcha.json' },
  lever: { ok: 'lever-form.html', captcha: 'lever-form-captcha.html', login: 'lever-form-login.html' },
  ashby: { ok: 'ashby-form.json', captcha: 'ashby-form-captcha.json' },
};

/**
 * The built-in fixture "employer". URL shape: https://<platform>.fixture.invalid/<scenario>/<job>[/submit]
 *   scenario ok .............. the form, then 200 on submit
 *   scenario captcha ......... a form that carries a CAPTCHA
 *   scenario login ........... a login wall instead of a form
 *   scenario captcha-submit .. a clean form, then a CAPTCHA page on submit
 *   scenario reject .......... a clean form, then 422 on submit
 *   scenario missing ......... 404
 * Reads only the files in ./fixtures. Opens no socket.
 */
export function createFixtureTransport(): Transport {
  return {
    async send(req: HttpRequest): Promise<HttpResponse> {
      const u = new URL(req.url);
      const platform = u.hostname.slice(0, -FIXTURE_HOST_SUFFIX.length) as Platform;
      if (!PLATFORMS.includes(platform)) return { status: 404, headers: {}, body: 'unknown fixture host' };
      const parts = u.pathname.split('/').filter(Boolean);
      const scenario = parts[0] ?? 'ok';
      const files = FORM_FILE[platform];
      const isJson = platform !== 'lever';
      const type = isJson ? 'application/json' : 'text/html';
      if (req.method === 'GET') {
        if (scenario === 'missing') return { status: 404, headers: {}, body: 'not found' };
        if (scenario === 'login') {
          return files.login
            ? { status: 200, headers: { 'content-type': type }, body: read(files.login) }
            : { status: 401, headers: { 'content-type': 'application/json' }, body: '{"requiresLogin":true}' };
        }
        return { status: 200, headers: { 'content-type': type }, body: read(scenario === 'captcha' ? files.captcha : files.ok) };
      }
      if (!u.pathname.endsWith('/submit')) return { status: 404, headers: {}, body: 'not found' };
      if (scenario === 'reject') return { status: 422, headers: { 'content-type': 'application/json' }, body: '{"error":"fixture rejected the application"}' };
      if (scenario === 'captcha-submit') return { status: 403, headers: { 'content-type': 'text/html' }, body: '<html><div class="g-recaptcha" data-sitekey="fixture"></div></html>' };
      const id = createHash('sha256').update(typeof req.body === 'string' ? req.body : Buffer.from(req.body ?? '')).digest('hex').slice(0, 12);
      return { status: 200, headers: { 'content-type': 'application/json' }, body: JSON.stringify({ success: true, id: `fixture-${id}` }) };
    },
  };
}

/** What the worker uses: the fixture employer behind the host guard. A live transport is a separate, deliberate change. */
export function defaultTransport(): Transport {
  return guardTransport(createFixtureTransport());
}

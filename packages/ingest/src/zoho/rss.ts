/**
 * Zoho Recruit public RSS connector (CLAUDE.md legal guardrails, approved 2026-10-29).
 * token = `<region>-<orgId>`; the feed is https://recruit.zoho.<tld>/recruit/downloadrssfeed?orgId=<id>, a path that
 * Zoho's own robots.txt explicitly Allows (checked 2026-11-06). One request per board per run; the policy fetch supplies
 * the honest user agent and the per-host rate limit.
 *
 * FIELD MAPPING IS PARTLY ASSUMED: standard RSS 2.0 (title, link, guid, pubDate, description) is certain; the optional
 * city/state/country/jobtype tags are read defensively and are unverified against a real Zoho feed (no orgId was available).
 * Record a real feed into fixtures once an employer is allowlisted, then tighten this mapping.
 */
import { createHash } from 'node:crypto';
import { loadAllowlist, type HostPolicy } from '../allowlist';
import { FetchPolicyError, type Connector, type FetchBoardError, type FetchBoardResult, type ItemError, type RawPosting } from '../contract';
import { cleanTitle, decodeEntitiesOnce, httpsUrl, toIsoUtc, trimOrNull } from '../connectors/shared';

const TOKEN_RE = /^(com|in|eu|au|jp|ca|sa|cn)-(\d{5,20})$/;

export function parseZohoToken(token: string): { region: string; orgId: string } {
  const m = typeof token === 'string' ? TOKEN_RE.exec(token) : null;
  if (!m) throw new Error(`invalid board token: ${JSON.stringify(token)}`);
  return { region: m[1]!, orgId: m[2]! };
}

export const zohoFeedUrl = (token: string): string => {
  const { region, orgId } = parseZohoToken(token);
  return `https://recruit.zoho.${region}/recruit/downloadrssfeed?orgId=${orgId}`;
};

const tag = (block: string, name: string): string | null => {
  const m = new RegExp(`<(?:[\\w-]+:)?${name}\\b[^>]*>([\\s\\S]*?)</(?:[\\w-]+:)?${name}>`, 'i').exec(block);
  if (!m) return null;
  const v = m[1]!.trim();
  const cdata = /^<!\[CDATA\[([\s\S]*?)\]\]>$/.exec(v);
  return cdata ? cdata[1]! : decodeEntitiesOnce(v);
};

function stableId(guid: string | null, link: string): string {
  if (guid) return guid.length > 120 ? `h:${createHash('sha1').update(guid).digest('hex').slice(0, 24)}` : guid.replace(/[^A-Za-z0-9:_.-]/g, '_');
  const digest = /[?&]digest=([A-Za-z0-9._-]{4,100})/.exec(link)?.[1];
  return digest ? `d:${digest}` : `h:${createHash('sha1').update(link).digest('hex').slice(0, 24)}`;
}

export interface ZohoDeps {
  allowTokens?: Record<string, HostPolicy> | (() => Record<string, HostPolicy>);
}

export function makeZohoConnector(deps: ZohoDeps = {}): Connector {
  return {
    ats: 'zoho_rss',
    boardUrl: zohoFeedUrl,
    async fetchBoard(token, opts): Promise<FetchBoardResult> {
      const url = zohoFeedUrl(token);
      const t0 = performance.now();
      let bytes = 0;
      const fail = (error: FetchBoardError, httpStatus: number | null = null): FetchBoardResult => ({
        ok: false, ats: 'zoho_rss', token, error, httpStatus, bytes, durationMs: Math.round(performance.now() - t0),
      });
      const table = typeof deps.allowTokens === 'function' ? deps.allowTokens() : (deps.allowTokens ?? loadAllowlist().zoho_rss);
      if (!table[token]) return fail({ kind: 'schema', issues: ['feed not on the allowlist'] });

      let res: Response;
      try {
        res = await opts.fetch(url, { signal: opts.signal, headers: { accept: 'application/rss+xml, application/xml;q=0.9, text/xml;q=0.8' } });
      } catch (e) {
        if (e instanceof FetchPolicyError) {
          if (e.kind === 'timeout') return fail({ kind: 'timeout' });
          if (e.kind === 'too_large') return fail({ kind: 'too_large', limitBytes: e.detail.limitBytes ?? 0 });
          if (e.kind === 'rate_limited') return fail({ kind: 'rate_limited', retryAfterMs: e.detail.retryAfterMs ?? null });
          return fail({ kind: 'network', message: e.detail.cause instanceof Error ? e.detail.cause.message : 'network error' });
        }
        if (opts.signal.aborted || (e instanceof Error && e.name === 'AbortError')) return fail({ kind: 'aborted' });
        return fail({ kind: 'network', message: e instanceof Error ? e.message : String(e) });
      }
      const status = res.status;
      if (status < 200 || status >= 300) {
        void res.body?.cancel().catch(() => {});
        if (status === 404) return fail({ kind: 'not_found' }, status);
        if (status === 429) {
          const s = Number(res.headers.get('retry-after'));
          return fail({ kind: 'rate_limited', retryAfterMs: Number.isFinite(s) && res.headers.get('retry-after') ? Math.round(s * 1000) : null }, status);
        }
        return fail({ kind: 'http', status }, status);
      }
      let xml: string;
      try {
        xml = await res.text();
      } catch (e) {
        return fail({ kind: 'network', message: e instanceof Error ? e.message : String(e) }, status);
      }
      bytes = Buffer.byteLength(xml);
      if (!/<rss\b|<feed\b/i.test(xml)) return fail({ kind: 'schema', issues: ['response is not an RSS feed'] }, status);

      const postings: RawPosting[] = [];
      const itemErrors: ItemError[] = [];
      const seen = new Set<string>();
      const taken = new Set<string>();
      const itemRe = /<item\b[^>]*>([\s\S]*?)<\/item>/gi;
      let index = 0;
      for (let m = itemRe.exec(xml); m; m = itemRe.exec(xml)) {
        const i = index++;
        const b = m[1]!;
        const title = cleanTitle(tag(b, 'title'));
        const link = tag(b, 'link')?.trim() ?? '';
        const id = stableId(trimOrNull(tag(b, 'guid')), link);
        if (!title) { itemErrors.push({ index: i, externalId: null, reason: 'missing_title' }); continue; }
        const url = httpsUrl(link);
        if (!url) { itemErrors.push({ index: i, externalId: id, reason: 'bad_url', detail: link.slice(0, 200) }); continue; }
        seen.add(id);
        if (taken.has(id)) { itemErrors.push({ index: i, externalId: id, reason: 'duplicate_id' }); continue; }
        taken.add(id);
        const loc = [tag(b, 'city'), tag(b, 'state'), tag(b, 'country')].map(trimOrNull).filter((x): x is string => x !== null);
        const raw = { guid: tag(b, 'guid'), title: tag(b, 'title'), link, pubDate: tag(b, 'pubDate') };
        postings.push({
          ats: 'zoho_rss', boardToken: token, externalId: id, url, applyUrl: url, title,
          locationsRaw: loc.length ? [loc.join(', ')] : [], descriptionHtml: trimOrNull(tag(b, 'description')),
          department: null, team: null, employmentRaw: trimOrNull(tag(b, 'jobtype')), workplaceRaw: null, isRemoteHint: null,
          postedAt: toIsoUtc(tag(b, 'pubDate')), compensation: null, raw,
        });
      }
      return {
        ok: true, ats: 'zoho_rss', token, source: opts.mode, postings, seenExternalIds: [...seen], itemErrors,
        unlistedCount: 0, httpStatus: status, bytes, durationMs: Math.round(performance.now() - t0),
      };
    },
  };
}

export const zohoRss = makeZohoConnector();

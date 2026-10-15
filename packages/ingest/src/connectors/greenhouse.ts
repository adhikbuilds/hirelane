import { z, decodeEntitiesOnce, cleanTitle, httpsUrl, isRecord, makeConnector, mergeLocations, toIsoUtc, trimOrNull, zodIssues } from './shared';

/** Verified against fixtures/mini/greenhouse/airtable: `content` is HTML entity-encoded ("&lt;p&gt;"). */
export const ENTITY_ENCODED_CONTENT = true;

const Job = z
  .object({
    id: z.union([z.number(), z.string()]),
    title: z.string().nullish(),
    absolute_url: z.string().nullish(),
    location: z.object({ name: z.string().nullish() }).passthrough().nullish(),
    offices: z.array(z.object({ name: z.string().nullish(), location: z.string().nullish() }).passthrough()).nullish(),
    departments: z.array(z.object({ name: z.string().nullish() }).passthrough()).nullish(),
    content: z.string().nullish(),
    first_published: z.union([z.string(), z.number()]).nullish(),
    metadata: z.array(z.object({ name: z.string().nullish(), value: z.unknown() }).passthrough()).nullish(),
  })
  .passthrough();

const Envelope = z.object({ jobs: z.array(z.unknown()) }).passthrough();

function metaValue(v: unknown): string | null {
  if (typeof v === 'string') return trimOrNull(v);
  if (Array.isArray(v)) return trimOrNull(v.filter((x) => typeof x === 'string').join(', '));
  return null;
}

export const greenhouse = makeConnector({
  ats: 'greenhouse',
  boardUrl: (t) => `https://boards-api.greenhouse.io/v1/boards/${t}/jobs?content=true`,
  envelope(body) {
    const r = Envelope.safeParse(body);
    return r.success ? { items: r.data.jobs } : { issues: zodIssues(r.error) };
  },
  idOf(item) {
    const id = isRecord(item) ? item.id : undefined;
    if (typeof id === 'number' && Number.isFinite(id)) return String(id);
    return typeof id === 'string' && id.trim() !== '' ? id.trim() : null;
  },
  extract(item, token, externalId) {
    const p = Job.safeParse(item);
    if (!p.success) return { kind: 'error', reason: 'item_schema', detail: zodIssues(p.error).join('; ') };
    const j = p.data;
    const title = cleanTitle(j.title);
    if (!title) return { kind: 'error', reason: 'missing_title' };
    const url = httpsUrl(j.absolute_url);
    if (!url) return { kind: 'error', reason: 'bad_url', detail: String(j.absolute_url ?? '') };
    const find = (re: RegExp) => {
      const m = (j.metadata ?? []).find((x) => typeof x.name === 'string' && re.test(x.name) && metaValue(x.value) !== null);
      return m ? metaValue(m.value) : null;
    };
    const content = typeof j.content === 'string' && j.content.trim() !== '' ? decodeEntitiesOnce(j.content) : null;
    return {
      kind: 'posting',
      posting: {
        ats: 'greenhouse',
        boardToken: token,
        externalId,
        url,
        applyUrl: url, // Greenhouse has no separate apply URL
        title,
        locationsRaw: mergeLocations([j.location?.name], (j.offices ?? []).map((o) => trimOrNull(o.location) ?? o.name)),
        descriptionHtml: content,
        department: trimOrNull(j.departments?.[0]?.name),
        team: null,
        employmentRaw: find(/employment/i),
        workplaceRaw: find(/workplace|remote/i),
        isRemoteHint: null,
        postedAt: toIsoUtc(j.first_published), // never falls back to updated_at
        compensation: null, // pay_input_ranges is absent from every recorded list response
        raw: item,
      },
    };
  },
});

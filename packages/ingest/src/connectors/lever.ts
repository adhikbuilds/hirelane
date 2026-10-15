import type { CompensationHint } from '../contract';
import { z, cleanTitle, httpsUrl, isRecord, makeConnector, mergeLocations, toIsoUtc, topLevelArray, trimOrNull, zodIssues } from './shared';

/** Verified against fixtures/mini/lever/cred: description, lists[].content and additional are plain HTML. */
export const ENTITY_ENCODED_CONTENT = false;

const Item = z
  .object({
    id: z.string(),
    text: z.string().nullish(),
    hostedUrl: z.string().nullish(),
    applyUrl: z.string().nullish(),
    categories: z
      .object({
        location: z.string().nullish(),
        allLocations: z.array(z.string()).nullish(),
        commitment: z.string().nullish(),
        department: z.string().nullish(),
        team: z.string().nullish(),
      })
      .passthrough()
      .nullish(),
    workplaceType: z.string().nullish(),
    description: z.string().nullish(),
    lists: z.array(z.object({ text: z.string().nullish(), content: z.string().nullish() }).passthrough()).nullish(),
    additional: z.string().nullish(),
    createdAt: z.union([z.number(), z.string()]).nullish(),
    salaryRange: z
      .object({
        min: z.number().nullish(),
        max: z.number().nullish(),
        currency: z.string().nullish(),
        interval: z.string().nullish(),
      })
      .passthrough()
      .nullish(),
  })
  .passthrough();

type LeverItem = z.infer<typeof Item>;

function description(j: LeverItem): string | null {
  const parts = [
    j.description ?? '',
    ...(j.lists ?? []).map((l) => (trimOrNull(l.text) ? `<h3>${l.text}</h3>` : '') + (l.content ?? '')),
    j.additional ?? '',
  ].filter((s) => s.trim() !== '');
  return parts.length ? parts.join('') : null;
}

function intervalOf(v: string | null | undefined): CompensationHint['interval'] {
  const m = /per-(year|month|week|day|hour)/i.exec(v ?? '');
  return m ? (m[1]!.toLowerCase() as CompensationHint['interval']) : 'unknown';
}

function compensation(j: LeverItem): CompensationHint | null {
  const s = j.salaryRange;
  if (!s) return null;
  const min = s.min ?? null;
  const max = s.max ?? null;
  if ((min === null && max === null) || (!min && !max)) return null; // 0..0 means "no figure" (recorded for INR boards)
  return {
    min, max, currency: trimOrNull(s.currency), interval: intervalOf(s.interval), kind: 'salary',
    summaryText: null, source: 'lever.salaryRange',
  };
}

export const lever = makeConnector({
  ats: 'lever',
  boardUrl: (t) => `https://api.lever.co/v0/postings/${t}?mode=json`,
  envelope(body) {
    const r = topLevelArray.safeParse(body);
    return r.success ? { items: r.data } : { issues: zodIssues(r.error) };
  },
  idOf(item) {
    const id = isRecord(item) ? item.id : undefined;
    return typeof id === 'string' && id.trim() !== '' ? id.trim() : null;
  },
  extract(item, token, externalId) {
    const p = Item.safeParse(item);
    if (!p.success) return { kind: 'error', reason: 'item_schema', detail: zodIssues(p.error).join('; ') };
    const j = p.data;
    const title = cleanTitle(j.text);
    if (!title) return { kind: 'error', reason: 'missing_title' };
    const url = httpsUrl(j.hostedUrl);
    if (!url) return { kind: 'error', reason: 'bad_url', detail: String(j.hostedUrl ?? '') };
    const wt = trimOrNull(j.workplaceType);
    const c = j.categories;
    return {
      kind: 'posting',
      posting: {
        ats: 'lever',
        boardToken: token,
        externalId,
        url,
        applyUrl: httpsUrl(j.applyUrl),
        title,
        locationsRaw: mergeLocations([c?.location], c?.allLocations ?? []),
        descriptionHtml: description(j),
        department: trimOrNull(c?.department),
        team: trimOrNull(c?.team),
        employmentRaw: trimOrNull(c?.commitment),
        workplaceRaw: wt,
        isRemoteHint: wt === null || wt === 'unspecified' ? null : wt === 'remote',
        postedAt: toIsoUtc(j.createdAt),
        compensation: compensation(j),
        raw: item,
      },
    };
  },
});

import type { CompensationHint } from '../contract';
import { z, cleanTitle, httpsUrl, isRecord, makeConnector, mergeLocations, toIsoUtc, trimOrNull, zodIssues } from './shared';

/** Verified against fixtures/mini/ashby/*: descriptionHtml is plain HTML. */
export const ENTITY_ENCODED_CONTENT = false;

const Component = z
  .object({
    compensationType: z.string().nullish(),
    interval: z.string().nullish(),
    currencyCode: z.string().nullish(),
    minValue: z.number().nullish(),
    maxValue: z.number().nullish(),
  })
  .passthrough();

const Job = z
  .object({
    id: z.string().nullish(),
    title: z.string().nullish(),
    jobUrl: z.string().nullish(),
    applyUrl: z.string().nullish(),
    location: z.string().nullish(),
    secondaryLocations: z.array(z.object({ location: z.string().nullish() }).passthrough()).nullish(),
    isListed: z.boolean().nullish(),
    isRemote: z.boolean().nullish(),
    workplaceType: z.string().nullish(),
    employmentType: z.string().nullish(),
    department: z.string().nullish(),
    team: z.string().nullish(),
    descriptionHtml: z.string().nullish(),
    publishedAt: z.union([z.string(), z.number()]).nullish(),
    shouldDisplayCompensationOnJobPostings: z.boolean().nullish(),
    compensation: z
      .object({
        compensationTierSummary: z.string().nullish(),
        scrapeableCompensationSalarySummary: z.string().nullish(),
        compensationTiers: z.array(z.object({ components: z.array(Component).nullish() }).passthrough()).nullish(),
      })
      .passthrough()
      .nullish(),
  })
  .passthrough();

type AshbyJob = z.infer<typeof Job>;

const UUID_IN_URL = /\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})(?:[/?#]|$)/i;

function intervalOf(v: string | null | undefined): CompensationHint['interval'] {
  const m = /(YEAR|MONTH|WEEK|DAY|HOUR)/i.exec(v ?? '');
  return m ? (m[1]!.toLowerCase() as CompensationHint['interval']) : 'unknown';
}

function compensation(j: AshbyJob): CompensationHint | null {
  const c = j.compensation;
  if (!c || j.shouldDisplayCompensationOnJobPostings === false) return null;
  const comps = (c.compensationTiers ?? []).flatMap((t) => t.components ?? []);
  const hasFigure = (x: z.infer<typeof Component>) => x.minValue != null || x.maxValue != null;
  const type = (x: z.infer<typeof Component>) => x.compensationType ?? '';
  // Equity is never emitted. Salary wins, then commission/OTE, then anything else with a figure.
  const pick =
    comps.find((x) => type(x) === 'Salary' && hasFigure(x)) ??
    comps.find((x) => /^(Commission|OTE)/i.test(type(x)) && hasFigure(x)) ??
    comps.find((x) => !/^Equity/i.test(type(x)) && hasFigure(x));
  if (!pick) return null;
  const t = type(pick);
  return {
    min: pick.minValue ?? null,
    max: pick.maxValue ?? null,
    currency: trimOrNull(pick.currencyCode),
    interval: intervalOf(pick.interval),
    kind: t === 'Salary' ? 'salary' : /^(Commission|OTE)/i.test(t) ? 'ote' : 'other',
    summaryText: trimOrNull(c.scrapeableCompensationSalarySummary) ?? trimOrNull(c.compensationTierSummary),
    source: 'ashby.compensation',
  };
}

export const ashby = makeConnector({
  ats: 'ashby',
  boardUrl: (t) => `https://api.ashbyhq.com/posting-api/job-board/${t}?includeCompensation=true`,
  envelope(body) {
    const r = z.object({ jobs: z.array(z.unknown()) }).passthrough().safeParse(body);
    return r.success ? { items: r.data.jobs } : { issues: zodIssues(r.error) };
  },
  idOf(item) {
    if (!isRecord(item)) return null;
    if (typeof item.id === 'string' && item.id.trim() !== '') return item.id.trim();
    return typeof item.jobUrl === 'string' ? (UUID_IN_URL.exec(item.jobUrl)?.[1] ?? null) : null;
  },
  isUnlisted: (item) => isRecord(item) && item.isListed === false,
  extract(item, token, externalId) {
    const p = Job.safeParse(item);
    if (!p.success) return { kind: 'error', reason: 'item_schema', detail: zodIssues(p.error).join('; ') };
    const j = p.data;
    const title = cleanTitle(j.title);
    if (!title) return { kind: 'error', reason: 'missing_title' };
    const url = httpsUrl(j.jobUrl);
    if (!url) return { kind: 'error', reason: 'bad_url', detail: String(j.jobUrl ?? '') };
    return {
      kind: 'posting',
      posting: {
        ats: 'ashby',
        boardToken: token,
        externalId,
        url,
        applyUrl: httpsUrl(j.applyUrl),
        title,
        locationsRaw: mergeLocations([j.location], (j.secondaryLocations ?? []).map((s) => s.location)),
        descriptionHtml: trimOrNull(j.descriptionHtml) ? (j.descriptionHtml as string) : null,
        department: trimOrNull(j.department),
        team: trimOrNull(j.team),
        employmentRaw: trimOrNull(j.employmentType),
        workplaceRaw: trimOrNull(j.workplaceType),
        isRemoteHint: j.isRemote ?? null,
        postedAt: toIsoUtc(j.publishedAt),
        compensation: compensation(j),
        raw: item,
      },
    };
  },
});

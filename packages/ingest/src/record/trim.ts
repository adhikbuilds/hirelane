import type { Ats } from '../contract';

export const KEEP_FULL_DESCRIPTIONS = 200;

type Obj = Record<string, unknown>;

const blank = (o: Obj, fields: string[]): Obj => {
  const out: Obj = { ...o };
  for (const f of fields) if (f in out) out[f] = f === 'lists' ? [] : '';
  return out;
};

/** Blanks the long description fields of every posting at index >= keep. Keeps ids, titles, locations, pay and everything else. */
export function trimDescriptions<T>(ats: Ats, body: T, keep = KEEP_FULL_DESCRIPTIONS): T {
  const fields =
    ats === 'greenhouse'
      ? ['content']
      : ats === 'lever'
        ? ['description', 'descriptionPlain', 'additional', 'additionalPlain', 'lists']
        : ['descriptionHtml', 'descriptionPlain'];
  const trimList = (xs: unknown[]) => xs.map((x, i) => (i < keep || typeof x !== 'object' || x === null ? x : blank(x as Obj, fields)));
  if (Array.isArray(body)) return trimList(body) as T;
  const o = body as Obj;
  if (Array.isArray(o.jobs)) return { ...o, jobs: trimList(o.jobs) } as T;
  return body;
}

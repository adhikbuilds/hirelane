/** Gazetteer lookups for the board: country names and the canonical city for any spelling. Pure, server-side. */
import { normPlace } from "@hirelane/engine";
import places from "@hirelane/engine/data/places.json";

type Raw = {
  countries: { code: string; name: string; aliases: string[] }[];
  cities: { name: string; aliases?: string[]; country: string; pop: number }[];
};
const DATA = places as unknown as Raw;

export const COUNTRY_NAME: ReadonlyMap<string, string> = new Map(DATA.countries.map((c) => [c.code, c.name]));
export const COUNTRY_CODES: ReadonlySet<string> = new Set(DATA.countries.map((c) => c.code));

const countryByName = new Map<string, string>();
for (const c of DATA.countries) {
  for (const n of [c.name, ...c.aliases]) {
    const k = normPlace(n);
    if (k && !countryByName.has(k)) countryByName.set(k, c.code);
  }
}

export type CityEntry = { name: string; country: string; pop: number };
const cityByName = new Map<string, CityEntry[]>();
for (const c of DATA.cities) {
  for (const n of [c.name, ...(c.aliases ?? [])]) {
    const k = normPlace(n);
    if (!k) continue;
    const e: CityEntry = { name: c.name, country: c.country, pop: c.pop };
    const list = cityByName.get(k);
    if (list) list.push(e);
    else cityByName.set(k, [e]);
  }
}
for (const l of cityByName.values()) l.sort((a, b) => b.pop - a.pop);

export const countryOfName = (part: string): string | null => countryByName.get(normPlace(part)) ?? null;
export const citiesOfName = (part: string): CityEntry[] => cityByName.get(normPlace(part)) ?? [];

export function countryName(code: string): string {
  return COUNTRY_NAME.get(code) ?? code;
}

/** De-duplicates a job's location strings by canonical city, so "Bangalore, India" and "Bengaluru, India" read once. */
import { citiesOfName, countryName, countryOfName } from "./places";

export type ResolvedLocation = {
  /** Text to show. */
  display: string;
  /** Canonical city and ISO country when the string names a known city. */
  city: string | null;
  country: string | null;
};

const WORKPLACE: Record<string, string> = { remote: "Remote", hybrid: "Hybrid", onsite: "On-site" };
export const workplaceLabel = (w: string | null): string | null => (w ? WORKPLACE[w] ?? w : null);

function resolveOne(raw: string): { key: string; loc: ResolvedLocation } | null {
  const text = raw.trim().replace(/\s+/g, " ");
  if (!text) return null;
  // "Hybrid in Bangalore, India" names the same place as "Bangalore, India".
  const place = text.replace(/^(?:hybrid|remote|on-?site)\s+(?:in|-|:)\s+/i, "");
  const parts = place.split(/,| - /).map((p) => p.trim()).filter(Boolean);
  let named: string | null = null;
  for (let i = parts.length - 1; i >= 0 && !named; i--) named = countryOfName(parts[i]!);
  for (const part of parts) {
    const candidates = citiesOfName(part);
    const hit = named ? candidates.find((c) => c.country === named) : candidates[0];
    if (hit) {
      return {
        key: `city:${hit.name}|${hit.country}`,
        loc: { display: `${hit.name}, ${countryName(hit.country)}`, city: hit.name, country: hit.country },
      };
    }
  }
  return { key: `text:${text.toLowerCase()}`, loc: { display: text, city: null, country: named } };
}

/** Distinct locations in first-seen order. */
export function resolveLocations(raw: readonly string[]): ResolvedLocation[] {
  const seen = new Set<string>();
  const out: ResolvedLocation[] = [];
  // One string can list several places ("Bengaluru; Gurugram").
  for (const s of raw.flatMap((x) => x.split(/;|\|/))) {
    const r = resolveOne(s);
    if (!r || seen.has(r.key)) continue;
    seen.add(r.key);
    out.push(r.loc);
  }
  return out;
}

export const dedupeLocations = (raw: readonly string[]): string[] => resolveLocations(raw).map((l) => l.display);

export type WhereSummary = { primary: string | null; more: number; workplace: string | null; detail: string | null };

const MAX_CODES = 3;

/**
 * The ledger's Where cell: ISO country codes plus workplace. `detail` carries the de-duplicated cities for a tooltip.
 * Worldwide remote jobs name no country, so they read "Worldwide".
 */
export function whereSummary(j: {
  locations: readonly string[];
  countries: readonly string[];
  workplace: string | null;
  remoteScope?: string;
}): WhereSummary {
  const workplace = workplaceLabel(j.workplace);
  const locs = dedupeLocations(j.locations);
  const detail = locs.length > 0 ? locs.join("; ") : null;
  const codes = [...new Set(j.countries.map((c) => c.trim()).filter(Boolean))];
  if (codes.length > 0) {
    return { primary: codes.slice(0, MAX_CODES).join(", "), more: Math.max(0, codes.length - MAX_CODES), workplace, detail };
  }
  if (j.remoteScope === "worldwide") return { primary: "Worldwide", more: 0, workplace, detail };
  if (locs.length > 0) return { primary: locs[0]!, more: locs.length - 1, workplace, detail };
  return { primary: null, more: 0, workplace, detail: null };
}

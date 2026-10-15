// [assumption] vendor field paths, confirmed against fixtures/mini once recorded (docs/ingest.md).
type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);
const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);
const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
/** Lever's salaryDescription is HTML; the ledger shows text only. */
const plain = (v: string | null) => {
  if (!v) return null;
  const text = v.replace(/<[^>]*>/g, " ").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim();
  return text || null;
};
const fmt = (n: number) => new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 }).format(n);

function range(min: number | null, max: number | null, currency: string | null, tail?: string | null) {
  if (min === null && max === null) return null;
  const amounts = min !== null && max !== null ? `${fmt(min)} to ${fmt(max)}` : fmt((min ?? max) as number);
  return [amounts, currency, tail].filter(Boolean).join(" ");
}

/** The pay exactly as the board states it, taken from the stored raw item. Null when none is stated. */
export function payOriginal(raw: unknown): string | null {
  if (!isObj(raw)) return null;

  if (isObj(raw["compensation"])) {
    const c = raw["compensation"];
    const s = str(c["compensationTierSummary"]) ?? str(c["scrapeableCompensationSalarySummary"]);
    if (s) return s;
  }

  const desc = str(raw["salaryDescriptionPlain"]) ?? plain(str(raw["salaryDescription"]));
  if (desc) return desc;
  if (isObj(raw["salaryRange"])) {
    const r = raw["salaryRange"];
    const out = range(num(r["min"]), num(r["max"]), str(r["currency"]), str(r["interval"]));
    if (out) return out;
  }

  const ranges = raw["pay_input_ranges"];
  if (Array.isArray(ranges) && isObj(ranges[0])) {
    const r = ranges[0];
    const min = num(r["min_cents"]);
    const max = num(r["max_cents"]);
    return range(min === null ? null : min / 100, max === null ? null : max / 100, str(r["currency_type"]));
  }
  return null;
}

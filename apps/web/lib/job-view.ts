/** Pure view helpers for /job/[slug]. No I/O, so every rule here is unit-tested. */

const EXPONENT: Record<string, number> = { JPY: 0, KRW: 0 };
const SYMBOL: Record<string, string> = {
  USD: "$", CAD: "CA$", AUD: "A$", SGD: "S$", NZD: "NZ$", HKD: "HK$", GBP: "£", EUR: "€",
  INR: "₹", BRL: "R$", MXN: "MX$", ILS: "₪", ZAR: "R", JPY: "¥", KRW: "₩",
};
const PERIOD: Record<string, string> = { hour: "hr", day: "day", week: "wk", month: "mo", year: "yr" };

export type SalaryInput = {
  minMinor: number | null;
  maxMinor: number | null;
  currency: string | null;
  period: string | null;
};

const trim = (n: number) => String(Number(n.toFixed(2)));
const grouped = (n: number) => new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 }).format(n);

function prefix(currency: string): string {
  return SYMBOL[currency] ?? `${currency} `;
}

/** Scale a pair of major-unit bounds to one shared unit. */
function scale(currency: string, lo: number | null, hi: number | null): { unit: string; lo: string | null; hi: string | null } {
  const top = Math.max(lo ?? 0, hi ?? 0);
  const f = (n: number | null, d: number, u: string) => (n === null ? null : trim(n / d) + u);
  if (currency === "INR") {
    if (top >= 10_000_000) return { unit: " Cr", lo: f(lo, 1e7, ""), hi: f(hi, 1e7, "") };
    if (top >= 100_000) return { unit: " L", lo: f(lo, 1e5, ""), hi: f(hi, 1e5, "") };
    return { unit: "", lo: lo === null ? null : grouped(lo), hi: hi === null ? null : grouped(hi) };
  }
  if (top >= 1_000_000) return { unit: "M", lo: f(lo, 1e6, ""), hi: f(hi, 1e6, "") };
  if (top >= 10_000) return { unit: "K", lo: f(lo, 1e3, ""), hi: f(hi, 1e3, "") };
  return { unit: "", lo: lo === null ? null : grouped(lo), hi: hi === null ? null : grouped(hi) };
}

/** "₹18–25 L/yr", "$120–160K/yr", "$45–60/hr". Null when there is no figure or no currency. */
export function formatSalary(s: SalaryInput): string | null {
  if (!s.currency || (s.minMinor === null && s.maxMinor === null)) return null;
  const div = 10 ** (EXPONENT[s.currency] ?? 2);
  const lo = s.minMinor === null ? null : s.minMinor / div;
  const hi = s.maxMinor === null ? null : s.maxMinor / div;
  const p = prefix(s.currency);
  const { unit, lo: a, hi: b } = scale(s.currency, lo, hi);
  const per = s.period && PERIOD[s.period] ? `/${PERIOD[s.period]}` : "";
  let body: string;
  if (a !== null && b !== null) body = a === b ? `${p}${a}${unit}` : `${p}${a}–${b}${unit}`;
  else if (a !== null) body = `${p}${a}${unit}+`;
  else body = `Up to ${p}${b}${unit}`;
  return body + per;
}

export type TraceGroup = "Parse" | "Currency" | "Period" | "FX" | "Check";
export type TraceRow = { seq: number; group: TraceGroup; label: string; ruleId: string };

function groupOf(ruleId: string): TraceGroup {
  if (ruleId.startsWith("salary.fx.")) return "FX";
  if (ruleId.startsWith("salary.period.")) return "Period";
  if (ruleId.startsWith("salary.currency.")) return "Currency";
  if (/^salary\.(num|range|structured)\./.test(ruleId) || ruleId === "salary.kind.ctc") return "Parse";
  return "Check";
}

const isRec = (x: unknown): x is Record<string, unknown> => typeof x === "object" && x !== null && !Array.isArray(x);

/** Steps of a stored salary trace for display, in order. Anything malformed is dropped, never thrown on. */
export function traceRows(trace: unknown): TraceRow[] {
  if (!isRec(trace) || !Array.isArray(trace["steps"])) return [];
  const rows: TraceRow[] = [];
  for (const [i, st] of trace["steps"].entries()) {
    if (!isRec(st) || typeof st["ruleId"] !== "string" || typeof st["label"] !== "string") continue;
    const seq = typeof st["seq"] === "number" ? st["seq"] : i;
    rows.push({ seq, group: groupOf(st["ruleId"]), label: st["label"], ruleId: st["ruleId"] });
  }
  return rows;
}

/** The requirement's span with `ctx` characters of surrounding description. Null when the span does not fit the text. */
export function evidenceSlice(
  text: string | null,
  start: number,
  end: number,
  ctx = 80,
): { before: string; quote: string; after: string } | null {
  if (!text || !Number.isInteger(start) || !Number.isInteger(end)) return null;
  if (start < 0 || end <= start || end > text.length) return null;
  return {
    before: text.slice(Math.max(0, start - ctx), start),
    quote: text.slice(start, end),
    after: text.slice(end, end + ctx),
  };
}

export function monogram(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "?";
  const letters = words.length > 1 ? words[0]![0]! + words[1]![0]! : [...words[0]!].slice(0, 2).join("");
  return letters.toLocaleUpperCase("en-US");
}

/** Only same-origin absolute paths; never a URL an employer or crawler could point at a tracker. */
export function safeLogoSrc(path: string | null): string | null {
  if (!path || !path.startsWith("/") || path.startsWith("//") || path.includes("..") || path.includes("\\")) return null;
  return path;
}

export function safeHttpUrl(url: string | null): string | null {
  if (!url) return null;
  try {
    const u = new URL(url);
    return u.protocol === "https:" || u.protocol === "http:" ? u.toString() : null;
  } catch {
    return null;
  }
}

export const isJobSlug = (s: string) => /^[a-z0-9][a-z0-9-]{0,199}$/.test(s);

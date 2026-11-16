/** IST date helpers for the adapters. Every label a student or a TPO reads is in India time, whatever the server's zone. */
const TZ = "Asia/Kolkata";

const parts = (d: Date, opts: Intl.DateTimeFormatOptions): Record<string, string> => {
  const out: Record<string, string> = {};
  for (const p of new Intl.DateTimeFormat("en-GB", { timeZone: TZ, ...opts }).formatToParts(d)) out[p.type] = p.value;
  return out;
};

/** "2026-10-29": the IST calendar day. */
export function dayKey(d: Date): string {
  const p = parts(d, { year: "numeric", month: "2-digit", day: "2-digit" });
  return `${p["year"]}-${p["month"]}-${p["day"]}`;
}

const dayNumber = (key: string): number => {
  const [y, m, d] = key.split("-").map(Number) as [number, number, number];
  return Math.round(Date.UTC(y, m - 1, d) / 86_400_000);
};

/** Whole IST calendar days from `from` to `to` (negative when `to` is earlier). */
export function daysBetween(from: Date, to: Date): number {
  return dayNumber(dayKey(to)) - dayNumber(dayKey(from));
}

/** "Thu 29 Oct". */
export function dateLabel(d: Date): string {
  const p = parts(d, { weekday: "short", day: "numeric", month: "short" });
  return `${p["weekday"]} ${p["day"]} ${p["month"]}`;
}

/** "29 Oct". */
export function shortDate(d: Date): string {
  const p = parts(d, { day: "numeric", month: "short" });
  return `${p["day"]} ${p["month"]}`;
}

/** "06:40", 24-hour. */
export function clock(d: Date): string {
  const p = parts(d, { hour: "2-digit", minute: "2-digit", hour12: false });
  return `${p["hour"] === "24" ? "00" : p["hour"]}:${p["minute"]}`;
}

/** Tracker step time: "Today 6:40", "Mon 9:02" inside the last six days, else "12 Oct". */
export function stepTime(at: Date, now: Date): string {
  const ago = daysBetween(at, now);
  const hm = clock(at).replace(/^0/, "");
  if (ago <= 0) return `Today ${hm}`;
  if (ago < 7) return `${parts(at, { weekday: "short" })["weekday"]} ${hm}`;
  return shortDate(at);
}

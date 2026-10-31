import type { StudentDrive } from "@hirelane/services";
import type { DriveItem } from "@/lib/sample/loop";
import { dateLabel, daysBetween, dayKey } from "./ist";

/**
 * A drive stays listed this many days after it was published when its notice names no closing date. The services keep
 * no deadline column, so this is a display policy, not a fact; the headline says when it applies.
 */
export const UNDATED_WINDOW_DAYS = 30;

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const DEADLINE_RE = /\b(?:apply\s+(?:by|before)|by|before|until|till|closes?(?:\s+on)?|last\s+date(?:\s+to\s+apply)?(?:\s+is)?|deadline(?:\s+is)?)\s*[:\-]?\s*(\d{1,2})(?:st|nd|rd|th)?\s+(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?(?:,?\s*(\d{4}))?/i;

/**
 * The closing date a notice states ("apply by 6 Nov", "last date: 31st October 2026"), as an IST day key, or null.
 * Rules only. A date with no year is this year, or next year when this year's date passed more than 30 days ago.
 */
export function parseDeadline(notice: string, now: Date): string | null {
  const m = DEADLINE_RE.exec(notice);
  if (!m) return null;
  const day = Number(m[1]);
  const month = MONTHS.indexOf(m[2]!.toLowerCase());
  if (month < 0 || day < 1 || day > 31) return null;
  const thisYear = Number(dayKey(now).slice(0, 4));
  const at = (y: number) => new Date(Date.UTC(y, month, day));
  let year = m[3] ? Number(m[3]) : thisYear;
  if (at(year).getUTCMonth() !== month) return null; // 31 Feb and friends
  if (!m[3] && daysBetween(at(year), new Date(Date.UTC(thisYear, Number(dayKey(now).slice(5, 7)) - 1, Number(dayKey(now).slice(8, 10))))) > 30) year += 1;
  return at(year).toISOString().slice(0, 10);
}

const dayAsDate = (key: string): Date => new Date(`${key}T06:30:00Z`); // noon IST, safely inside the IST day

/**
 * The student's drive inbox as Drives-tab cards. Nothing is invented: the verdict and every rule line come from the
 * engine's own reasons; CTC has no source, so it is null. A drive whose notice closed before today is dropped.
 */
export function toDriveItems(drives: StudentDrive[], now: Date): DriveItem[] {
  const out: DriveItem[] = [];
  for (const d of drives) {
    const stated = parseDeadline(d.noticeText, now);
    const published = new Date(d.publishedAt);
    let daysLeft: number;
    let deadlineLabel: string;
    if (stated) {
      daysLeft = daysBetween(now, dayAsDate(stated));
      if (daysLeft < 0) continue;
      deadlineLabel = dateLabel(dayAsDate(stated));
    } else {
      daysLeft = UNDATED_WINDOW_DAYS - Math.max(0, daysBetween(published, now));
      if (daysLeft < 0) continue;
      deadlineLabel = "No date in the notice";
    }
    const scam = d.scamRisk === "high";
    const n = d.reasons.length;
    const headline = scam
      ? "This notice has signs of a scam"
      : d.verdict === "eligible"
        ? n === 0
          ? "The notice states no rules we could read"
          : `You meet all ${n} ${n === 1 ? "rule" : "rules"}`
        : "We couldn't check every rule";
    out.push({
      id: d.id,
      company: "Your placement cell",
      role: d.title,
      ctc: null,
      deadlineLabel,
      daysLeft,
      status: scam ? "scam" : d.verdict === "eligible" ? "eligible" : "check",
      headline: stated ? headline : `${headline}. The notice has no closing date, so check it.`,
      rules: d.reasons.map((text) => ({ text, status: d.verdict === "eligible" ? ("pass" as const) : ("unknown" as const) })),
    });
  }
  return out.sort((a, b) => a.daysLeft - b.daysLeft);
}

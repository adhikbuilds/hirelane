import type { TraceDemo, TraceGroup, TraceStepView } from "./types";

const isRec = (x: unknown): x is Record<string, unknown> => typeof x === "object" && x !== null && !Array.isArray(x);

function groupOf(ruleId: string): TraceGroup {
  if (ruleId.startsWith("salary.fx.")) return "Convert";
  if (ruleId.startsWith("salary.period.")) return "Period";
  if (ruleId.startsWith("salary.currency.")) return "Currency";
  if (/^salary\.(num|range|structured|kind)\b/.test(ruleId)) return "Read";
  return "Check";
}

type Evidence = { start: number; end: number; quote: string; source: string };
type RawStep = { seq: number; ruleId: string; label: string; inputs: Record<string, unknown>; evidence: Evidence[] };

function rawSteps(trace: unknown): RawStep[] | null {
  if (!isRec(trace) || !Array.isArray(trace["steps"])) return null;
  const out: RawStep[] = [];
  for (const [i, s] of trace["steps"].entries()) {
    if (!isRec(s) || typeof s["ruleId"] !== "string" || typeof s["label"] !== "string") continue;
    const ev = Array.isArray(s["evidence"]) ? s["evidence"] : [];
    const evidence: Evidence[] = [];
    for (const e of ev) {
      if (!isRec(e) || typeof e["source"] !== "string") continue;
      if (typeof e["start"] !== "number" || typeof e["end"] !== "number" || typeof e["quote"] !== "string") continue;
      evidence.push({ start: e["start"], end: e["end"], quote: e["quote"], source: e["source"] });
    }
    out.push({
      seq: typeof s["seq"] === "number" ? s["seq"] : i,
      ruleId: s["ruleId"],
      label: s["label"],
      inputs: isRec(s["inputs"]) ? s["inputs"] : {},
      evidence,
    });
  }
  return out.sort((a, b) => a.seq - b.seq);
}

const str = (v: unknown): string | null => (typeof v === "string" ? v : null);

/** Human label for a step. FX steps are rebuilt from their inputs so the long source note stays out of the list. */
function labelOf(s: RawStep): string {
  if (s.ruleId === "salary.fx.convert") {
    const from = str(s.inputs["from"]);
    const to = str(s.inputs["to"]);
    const rate = str(s.inputs["rate"]);
    const asOf = str(s.inputs["asOf"]);
    if (from && to && rate && asOf) return `${from} to ${to} at ${rate}, rate table of ${asOf}`;
  }
  return s.label;
}

const WINDOW_BEFORE = 240;
const WINDOW_AFTER = 200;

/**
 * Turns a stored salary trace into the landing demo: an excerpt of the posting and the steps that read it.
 * Returns null unless every quoted span really sits at its offsets in `text` (a stale trace must never be shown as
 * evidence) and at least four steps remain after dropping the ones that point outside the excerpt.
 */
export function buildTraceDemo(input: {
  slug: string;
  title: string;
  company: string;
  headline: string;
  text: string | null;
  trace: unknown;
}): TraceDemo | null {
  const { text } = input;
  const steps = rawSteps(input.trace);
  if (!text || !steps) return null;
  for (const s of steps) {
    for (const e of s.evidence) {
      if (e.source !== "description") continue;
      if (!Number.isInteger(e.start) || !Number.isInteger(e.end) || e.start < 0 || e.end <= e.start || e.end > text.length) return null;
      if (text.slice(e.start, e.end) !== e.quote) return null;
    }
  }
  const main = steps.find((s) => /^salary\.(num|range|structured)\./.test(s.ruleId) && s.evidence.some((e) => e.source === "description"));
  const mainEv = main?.evidence.find((e) => e.source === "description");
  if (!main || !mainEv) return null;

  let ws = Math.max(0, mainEv.start - WINDOW_BEFORE);
  let we = Math.min(text.length, mainEv.end + WINDOW_AFTER);
  // Start and end on word boundaries, never inside a word.
  while (ws > 0 && ws < mainEv.start && !/\s/.test(text[ws - 1]!)) ws++;
  while (we < text.length && we > mainEv.end && !/\s/.test(text[we]!)) we--;

  const out: TraceStepView[] = [];
  for (const s of steps) {
    const ev = s.evidence.filter((e) => e.source === "description");
    if (ev.some((e) => e.start < ws || e.end > we)) continue;
    const first = ev[0];
    out.push({
      id: `${s.seq}-${s.ruleId}`,
      group: groupOf(s.ruleId),
      label: labelOf(s),
      span: first ? { start: first.start - ws, end: first.end - ws } : null,
    });
  }
  if (out.length < 4 || out.length > 10) return null;
  const convert = steps.find((s) => s.ruleId === "salary.fx.convert");
  return {
    slug: input.slug,
    title: input.title,
    company: input.company,
    headline: input.headline,
    excerpt: text.slice(ws, we),
    clippedStart: ws > 0,
    clippedEnd: we < text.length,
    steps: out,
    fxDate: convert ? str(convert.inputs["asOf"]) : null,
  };
}

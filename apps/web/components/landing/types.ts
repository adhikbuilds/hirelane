/** Plain, JSON-safe shapes shared by the landing loaders (server) and the landing sections (server and client). */

export type TickerJob = { slug: string; title: string; company: string; logoPath: string | null; freshAt: string };

export type DemoJob = {
  slug: string;
  title: string;
  company: string;
  logoPath: string | null;
  where: string;
  /** Normalised annual pay, for example "$101K–$134K/yr". */
  payAnnual: string;
  /** Pay as the posting states it, shown only when it differs from the normalised form. */
  payStated: string | null;
  /** Top of the normalised annual pay in USD minor units, or null when no pay is stated. */
  payMaxUsdMinor: number | null;
  /** Skill labels in the order the posting lists them. */
  skills: string[];
};

export type TraceGroup = "Read" | "Currency" | "Period" | "Check" | "Convert";

export type TraceStepView = {
  id: string;
  group: TraceGroup;
  label: string;
  /** Character range inside `excerpt`, or null when the step uses no text from the posting. */
  span: { start: number; end: number } | null;
};

export type TraceDemo = {
  slug: string;
  title: string;
  company: string;
  headline: string;
  excerpt: string;
  /** True when the excerpt starts or ends mid-description. */
  clippedStart: boolean;
  clippedEnd: boolean;
  steps: TraceStepView[];
  fxDate: string | null;
};

export type LandingCounts = {
  openJobs: number;
  companies: number;
  withSalary: number;
  boards: number;
  asOf: string | null;
};

export type LandingSnapshot = {
  counts: LandingCounts;
  ticker: TickerJob[];
  demo: DemoJob[];
  trace: TraceDemo | null;
  autopilot: { perWeek: number; asOf: string } | null;
};

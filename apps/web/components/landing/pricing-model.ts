/**
 * Plan prices for the landing page. Free, and Basic weekly and monthly, are PLAN.md's seed prices (Phase 7.5).
 * Everything else is a planned price that Phase 7 will validate, and the page says so.
 */
export type Currency = "INR" | "USD";
export type Period = "weekly" | "monthly" | "quarterly";
export type PlanCode = "free" | "basic" | "pro" | "ultra";

export type PlanPrice = { inr: number; usd: number; applications: number };

export type Plan = {
  code: PlanCode;
  name: string;
  tagline: string;
  /** Null for Free, which has one lifetime allowance and no billing period. */
  prices: Record<Period, PlanPrice> | null;
  freeApplications?: number;
  features: string[];
  highlight?: boolean;
};

export const PERIODS: { value: Period; label: string; unit: string }[] = [
  { value: "weekly", label: "Weekly", unit: "week" },
  { value: "monthly", label: "Monthly", unit: "month" },
  { value: "quarterly", label: "Quarterly", unit: "quarter" },
];

export const PLANS: Plan[] = [
  {
    code: "free",
    name: "Free",
    tagline: "Try the whole flow on real jobs.",
    prices: null,
    freeApplications: 10,
    features: ["10 applications in total, no card", "Explained match scores", "Needs-you flags and the 4 second undo", "Salary shown with how it was worked out"],
  },
  {
    code: "basic",
    name: "Basic",
    tagline: "A steady search, one job at a time.",
    prices: {
      weekly: { inr: 99, usd: 3, applications: 30 },
      monthly: { inr: 299, usd: 9, applications: 120 },
      quarterly: { inr: 799, usd: 24, applications: 360 },
    },
    features: ["Everything in Free", "Replies filed on each application", "Resume versions"],
  },
  {
    code: "pro",
    name: "Pro",
    tagline: "Let drafts queue up while you sleep.",
    prices: {
      weekly: { inr: 199, usd: 5, applications: 75 },
      monthly: { inr: 599, usd: 15, applications: 300 },
      quarterly: { inr: 1599, usd: 39, applications: 900 },
    },
    features: ["Everything in Basic", "Autopilot drafts and queues by your rule", "Daily batch email with a pause link"],
    highlight: true,
  },
  {
    code: "ultra",
    name: "Ultra",
    tagline: "A full-time search, with room to spare.",
    prices: {
      weekly: { inr: 399, usd: 9, applications: 200 },
      monthly: { inr: 1199, usd: 29, applications: 800 },
      quarterly: { inr: 2999, usd: 74, applications: 2400 },
    },
    features: ["Everything in Pro", "The highest application allowance", "Drafts tailored to each role"],
  },
];

const amount = (p: PlanPrice, c: Currency): number => (c === "INR" ? p.inr : p.usd);

/** Whole-unit price with the digit grouping of the currency's home market: ₹1,599 and $39. */
export function formatPrice(value: number, currency: Currency): string {
  return new Intl.NumberFormat(currency === "INR" ? "en-IN" : "en-US", {
    style: "currency",
    currency,
    maximumFractionDigits: 0,
  }).format(value);
}

/** Cost of one application on a paid plan: ₹2.49, or $0.075 for sub-dime USD amounts. */
export function formatPerApplication(price: PlanPrice, currency: Currency): string {
  const v = amount(price, currency) / price.applications;
  return new Intl.NumberFormat(currency === "INR" ? "en-IN" : "en-US", {
    style: "currency",
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: currency === "USD" && v < 0.1 ? 3 : 2,
  }).format(v);
}

export function priceFor(plan: Plan, period: Period, currency: Currency): { price: string; perApplication: string; applications: number } | null {
  if (!plan.prices) return null;
  const p = plan.prices[period];
  return { price: formatPrice(amount(p, currency), currency), perApplication: formatPerApplication(p, currency), applications: p.applications };
}

/** Quarterly saving against paying monthly three times, as a whole percent. Zero when there is none. */
export function quarterlySaving(plan: Plan): number {
  if (!plan.prices) return 0;
  const monthly3 = plan.prices.monthly.inr * 3;
  return Math.max(0, Math.round((1 - plan.prices.quarterly.inr / monthly3) * 100));
}

/**
 * INR for en-IN, hi and any other Indian-region locale as the visitor's first choice; USD otherwise, including
 * a missing header. Honours q-values, so "en;q=0.5, hi;q=0.9" is Hindi first.
 */
export function currencyFor(acceptLanguage: string | null | undefined): Currency {
  if (!acceptLanguage) return "USD";
  const ranked = acceptLanguage
    .split(",", 16)
    .map((part, index) => {
      const [tag, ...params] = part.trim().split(";");
      const q = params.map((p) => /^\s*q\s*=\s*([0-9.]+)\s*$/i.exec(p)?.[1]).find(Boolean);
      const n = q === undefined ? 1 : Number(q);
      return { tag: (tag ?? "").trim().toLowerCase(), q: Number.isFinite(n) ? n : 0, index };
    })
    .filter((r) => r.tag && r.tag !== "*" && r.q > 0)
    .sort((a, b) => b.q - a.q || a.index - b.index);
  const first = ranked[0]?.tag;
  if (!first) return "USD";
  return first === "hi" || first.startsWith("hi-") || first.endsWith("-in") ? "INR" : "USD";
}

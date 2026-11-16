type Env = Record<string, string | undefined>;

/** Demo mode: HIRELANE_DEMO=1 and nothing else. Without it none of the demo surface exists (routes 404, no buttons, no banner). */
export const demoEnabled = (env: Env = process.env): boolean => env["HIRELANE_DEMO"] === "1";

/** Must equal DEMO_DOMAIN in scripts/demo-seed-lib.ts (a test asserts it). */
export const DEMO_DOMAIN = "demo-college.example.test";

export type DemoPersona = "student" | "officer";

/** The two seeded accounts a visitor may enter as. Synthetic addresses only (the seed writes them). */
export const DEMO_PERSONAS: Record<DemoPersona, { email: string; label: string; landing: string }> = {
  student: { email: `student01@${DEMO_DOMAIN}`, label: "As a student", landing: "/home" },
  officer: { email: `placement@${DEMO_DOMAIN}`, label: "As a placement officer", landing: "/campus" },
};

export const DEMO_BANNER = "Demo with sample data. Nothing here is real or sent anywhere.";

/** A demo account must be a synthetic address; a real mailbox can never be reached through the demo door. */
export const demoEmailAllowed = (email: string): boolean => /^[a-z0-9._-]+@[a-z0-9-]+(\.[a-z0-9-]+)*\.example\.test$/.test(email);

export const isDemoPersona = (v: unknown): v is DemoPersona => v === "student" || v === "officer";

import { describe, expect, it } from "vitest";
import { demoEnabled, DEMO_PERSONAS, demoEmailAllowed } from "../../lib/demo";
import { accountsEnabled } from "../../lib/auth/flags";
import { isDevEnv } from "../../lib/adapters/screen";

describe("demo flag", () => {
  it("is on only for HIRELANE_DEMO=1", () => {
    expect(demoEnabled({ HIRELANE_DEMO: "1" })).toBe(true);
    for (const v of [undefined, "", "0", "true", "yes", " 1"]) expect(demoEnabled({ HIRELANE_DEMO: v })).toBe(false);
  });
  it("only ever allows synthetic .example.test addresses as demo accounts", () => {
    expect(demoEmailAllowed(DEMO_PERSONAS.student.email)).toBe(true);
    expect(demoEmailAllowed(DEMO_PERSONAS.officer.email)).toBe(true);
    expect(demoEmailAllowed("someone@gmail.com")).toBe(false);
    expect(demoEmailAllowed("a@example.test.evil.com")).toBe(false);
  });
  it("turns accounts on in demo mode and leaves them to the flag otherwise", async () => {
    expect(await accountsEnabled({ env: { HIRELANE_DEMO: "1" }, read: async () => false })).toBe(true);
    expect(await accountsEnabled({ env: { HIRELANE_DEMO: "1", HIRELANE_ACCOUNTS: "0" }, read: async () => true })).toBe(false);
    expect(await accountsEnabled({ env: {}, read: async () => false })).toBe(false);
  });
  it("never shows labelled samples in demo mode, even with NODE_ENV=development", () => {
    expect(isDevEnv({ NODE_ENV: "development" })).toBe(true);
    expect(isDevEnv({ NODE_ENV: "development", HIRELANE_DEMO: "1" })).toBe(false);
    expect(isDevEnv({ HIRELANE_SAMPLES: "1", HIRELANE_DEMO: "1" })).toBe(false);
  });
});

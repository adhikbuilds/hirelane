import { describe, expect, it } from "vitest";
import { DEMO_PERSONAS, DEMO_DOMAIN as WEB_DOMAIN, demoEmailAllowed } from "../../lib/demo";
import { DEMO_DOMAIN, DEMO_OWNER_EMAIL, DEMO_STUDENT_EMAIL } from "../../../../scripts/demo-seed-lib";

describe("demo personas match the seed", () => {
  it("uses the seed's domain and accounts", () => {
    expect(WEB_DOMAIN).toBe(DEMO_DOMAIN);
    expect(DEMO_PERSONAS.officer.email).toBe(DEMO_OWNER_EMAIL);
    expect(DEMO_PERSONAS.student.email).toBe(DEMO_STUDENT_EMAIL);
    expect(demoEmailAllowed(DEMO_STUDENT_EMAIL)).toBe(true);
  });
});

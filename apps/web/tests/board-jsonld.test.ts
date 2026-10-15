import { describe, expect, it } from "vitest";
import type { JobDetail } from "../lib/job-data";
import { buildJobPostingLd, jsonLdScript } from "../components/board/job-posting-ld";

const ORIGIN = "https://hirelane.test";

const job = (over: Partial<JobDetail> = {}): JobDetail => ({
  id: "1",
  slug: "acme-data-engineer-abc12345",
  title: "Data Engineer",
  companyName: "Acme Labs",
  companySlug: "acme-labs",
  logoPath: null,
  workplace: "onsite",
  employment: "fulltime",
  level: "mid",
  remoteScope: "none",
  countries: ["IN"],
  locations: ["Bangalore, India", "Bengaluru, India"],
  visa: "unknown",
  salary: {
    minMinor: 1_800_000_00, maxMinor: 2_500_000_00, currency: "INR", period: "year",
    annualUsdMin: null, annualUsdMax: null, annualInrMin: null, annualInrMax: null,
    source: "ats_structured", kind: "base", fxDate: null, trace: null,
  },
  skills: [],
  requirements: [],
  descriptionText: "Build pipelines.\n\nOwn quality.",
  postedAt: new Date("2026-10-01T08:00:00Z"),
  firstSeenAt: new Date("2026-10-02T08:00:00Z"),
  lastSeenAt: new Date("2026-10-16T08:00:00Z"),
  closedAt: null,
  source: "greenhouse",
  applyUrl: "https://boards.example/acme/1",
  ...over,
});

describe("buildJobPostingLd", () => {
  it("emits the required fields", () => {
    const ld = buildJobPostingLd(job(), ORIGIN)!;
    expect(ld["@context"]).toBe("https://schema.org");
    expect(ld["@type"]).toBe("JobPosting");
    expect(ld.title).toBe("Data Engineer");
    expect(ld.datePosted).toBe("2026-10-01T08:00:00.000Z");
    expect(ld.description).toContain("Build pipelines.");
    expect(ld.hiringOrganization).toEqual({ "@type": "Organization", name: "Acme Labs" });
    expect(ld.url).toBe(`${ORIGIN}/job/acme-data-engineer-abc12345`);
  });
  it("lists a de-duplicated jobLocation with addressCountry", () => {
    const ld = buildJobPostingLd(job(), ORIGIN)!;
    expect(ld.jobLocation).toEqual([
      { "@type": "Place", address: { "@type": "PostalAddress", addressLocality: "Bengaluru", addressCountry: "IN" } },
    ]);
  });
  it("adds a country-only place for countries with no named city", () => {
    const ld = buildJobPostingLd(job({ countries: ["IN", "US"], locations: ["Bengaluru, India"] }), ORIGIN)!;
    expect(ld.jobLocation).toHaveLength(2);
    expect(ld.jobLocation?.[1]).toEqual({ "@type": "Place", address: { "@type": "PostalAddress", addressCountry: "US" } });
  });
  it("sets employmentType, directApply false and an identifier; never validThrough", () => {
    const ld = buildJobPostingLd(job(), ORIGIN)!;
    expect(ld.employmentType).toBe("FULL_TIME");
    expect(ld.directApply).toBe(false);
    expect(ld.identifier).toEqual({ "@type": "PropertyValue", name: "Acme Labs", value: "acme-data-engineer-abc12345" });
    expect("validThrough" in ld).toBe(false);
  });
  it.each([
    ["fulltime", "FULL_TIME"], ["parttime", "PART_TIME"], ["contract", "CONTRACTOR"], ["intern", "INTERN"],
  ])("maps employment %s to %s", (e, t) => {
    expect(buildJobPostingLd(job({ employment: e }), ORIGIN)!.employmentType).toBe(t);
  });
  it("omits employmentType when unknown", () => {
    expect("employmentType" in buildJobPostingLd(job({ employment: null }), ORIGIN)!).toBe(false);
  });

  describe("baseSalary", () => {
    it("uses the posting's own currency, period and major units", () => {
      expect(buildJobPostingLd(job(), ORIGIN)!.baseSalary).toEqual({
        "@type": "MonetaryAmount", currency: "INR",
        value: { "@type": "QuantitativeValue", minValue: 1_800_000, maxValue: 2_500_000, unitText: "YEAR" },
      });
    });
    it("uses value when only one bound or equal bounds", () => {
      const one = buildJobPostingLd(job({ salary: { ...job().salary, minMinor: 5_000_00, maxMinor: null, currency: "USD", period: "hour" } }), ORIGIN)!;
      expect(one.baseSalary?.value).toEqual({ "@type": "QuantitativeValue", value: 5000, unitText: "HOUR" });
      const eq = buildJobPostingLd(job({ salary: { ...job().salary, minMinor: 9_000_00, maxMinor: 9_000_00, currency: "USD" } }), ORIGIN)!;
      expect(eq.baseSalary?.value).toEqual({ "@type": "QuantitativeValue", value: 9000, unitText: "YEAR" });
    });
    it.each([["hour", "HOUR"], ["day", "DAY"], ["week", "WEEK"], ["month", "MONTH"], ["year", "YEAR"]])("maps period %s", (p, u) => {
      const ld = buildJobPostingLd(job({ salary: { ...job().salary, period: p } }), ORIGIN)!;
      expect(ld.baseSalary?.value.unitText).toBe(u);
    });
    it("respects zero-decimal currencies", () => {
      const ld = buildJobPostingLd(job({ salary: { ...job().salary, currency: "JPY", minMinor: 6_000_000, maxMinor: 8_000_000 } }), ORIGIN)!;
      expect(ld.baseSalary?.value).toMatchObject({ minValue: 6_000_000, maxValue: 8_000_000 });
    });
    it("accepts text-read pay", () => {
      expect(buildJobPostingLd(job({ salary: { ...job().salary, source: "text" } }), ORIGIN)!.baseSalary).toBeDefined();
    });
    it("never emits model-read pay", () => {
      expect("baseSalary" in buildJobPostingLd(job({ salary: { ...job().salary, source: "llm" } }), ORIGIN)!).toBe(false);
    });
    it("never emits on-target earnings as base salary", () => {
      expect("baseSalary" in buildJobPostingLd(job({ salary: { ...job().salary, kind: "ote" } }), ORIGIN)!).toBe(false);
    });
    it("is omitted without pay, currency or a known period", () => {
      for (const s of [
        { minMinor: null, maxMinor: null }, { currency: null }, { period: null }, { source: null },
      ]) {
        expect("baseSalary" in buildJobPostingLd(job({ salary: { ...job().salary, ...s } }), ORIGIN)!).toBe(false);
      }
    });
  });

  describe("remote", () => {
    const remote = (over: Partial<JobDetail> = {}) => job({ workplace: "remote", remoteScope: "countries", countries: ["IN"], locations: [], ...over });
    it("sets TELECOMMUTE with applicantLocationRequirements for 100% remote with countries", () => {
      const ld = buildJobPostingLd(remote(), ORIGIN)!;
      expect(ld.jobLocationType).toBe("TELECOMMUTE");
      expect(ld.applicantLocationRequirements).toEqual([{ "@type": "Country", name: "IN" }]);
    });
    it("may omit jobLocation when remote with no named city", () => {
      expect("jobLocation" in buildJobPostingLd(remote(), ORIGIN)!).toBe(false);
    });
    it("leaves jobLocation out of remote jobs even when a city is listed", () => {
      const ld = buildJobPostingLd(remote({ locations: ["Atlanta, United States"], countries: ["US"] }), ORIGIN)!;
      expect("jobLocation" in ld).toBe(false);
      expect(ld.applicantLocationRequirements).toEqual([{ "@type": "Country", name: "US" }]);
    });
    it("is null for worldwide remote with no country (cannot satisfy the location rules)", () => {
      expect(buildJobPostingLd(remote({ countries: [], remoteScope: "worldwide" }), ORIGIN)).toBeNull();
    });
    it("does not set TELECOMMUTE for hybrid or onsite", () => {
      expect("jobLocationType" in buildJobPostingLd(job({ workplace: "hybrid" }), ORIGIN)!).toBe(false);
      expect("applicantLocationRequirements" in buildJobPostingLd(job(), ORIGIN)!).toBe(false);
    });
  });

  it("is null for closed jobs", () => {
    expect(buildJobPostingLd(job({ closedAt: new Date() }), ORIGIN)).toBeNull();
  });
  it("is null when there is no country for an on-site job", () => {
    expect(buildJobPostingLd(job({ countries: [], locations: [] }), ORIGIN)).toBeNull();
  });
  it("is null without a description", () => {
    expect(buildJobPostingLd(job({ descriptionText: null }), ORIGIN)).toBeNull();
    expect(buildJobPostingLd(job({ descriptionText: "   " }), ORIGIN)).toBeNull();
  });
  it("falls back to firstSeenAt when posted_at is missing", () => {
    expect(buildJobPostingLd(job({ postedAt: null }), ORIGIN)!.datePosted).toBe("2026-10-02T08:00:00.000Z");
  });
});

describe("jsonLdScript", () => {
  it("escapes characters that could close the script element", () => {
    const s = jsonLdScript({ a: "</script><script>alert(1)</script>", b: " " });
    expect(s).not.toContain("<");
    expect(s).not.toContain(" ");
    expect(JSON.parse(s)).toEqual({ a: "</script><script>alert(1)</script>", b: " " });
  });
});

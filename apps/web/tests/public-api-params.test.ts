import { describe, expect, it } from "vitest";
import { API_PARAM_ORDER, parseStrict, serializeApi } from "../lib/public-api-params";

const sp = (s: string) => new URLSearchParams(s);
const ok = (s: string) => {
  const r = parseStrict(sp(s));
  if (!r.ok) throw new Error(`expected ok for ${s}: ${JSON.stringify(r.error)}`);
  return r.query;
};
const bad = (s: string) => {
  const r = parseStrict(sp(s));
  if (r.ok) throw new Error(`expected error for ${s}`);
  return r.error;
};

describe("parseStrict defaults", () => {
  it("an empty query yields the documented defaults", () => {
    expect(ok("")).toEqual({ filter: {}, page: 1, pageSize: 50, sort: "fresh" });
  });
  it("ignores unknown keys for forward compatibility", () => {
    expect(ok("utm_source=x&future=1&role=data-engineer").filter).toEqual({ role: "data-engineer" });
  });
});

describe("parseStrict values", () => {
  it("normalises q (NFKC, whitespace, case)", () => {
    expect(ok("q=%EF%BC%A4ata%20%20%20ENGINEER%20").filter.q).toBe("data engineer");
  });
  it.each([["q="], ["q=%20%20"], [`q=${"a".repeat(101)}`]])("rejects q %s", (s) => {
    expect(bad(s)).toMatchObject({ code: "invalid_param", param: "q" });
  });
  it("accepts a 100 char q", () => expect(ok(`q=${"a".repeat(100)}`).filter.q).toHaveLength(100));

  it("validates role against the 27 families", () => {
    expect(ok("role=data-engineer").filter.role).toBe("data-engineer");
    expect(bad("role=wizard")).toMatchObject({ code: "invalid_param", param: "role" });
    expect(bad("role=Data-Engineer")).toMatchObject({ param: "role" });
  });
  it("uppercases country and checks it against the gazetteer", () => {
    expect(ok("country=in").filter.country).toBe("IN");
    expect(bad("country=ZZ")).toMatchObject({ param: "country" });
    expect(bad("country=IND")).toMatchObject({ param: "country" });
    expect(bad("country=%27%3B--")).toMatchObject({ param: "country" });
  });
  it("accepts 1/0/true/false for flags; 0/false mean off", () => {
    expect(ok("remote=1&salary=true&visa=1").filter).toEqual({ remote: true, salary: true, visa: true });
    expect(ok("remote=0&salary=false").filter).toEqual({});
    expect(bad("remote=yes")).toMatchObject({ param: "remote" });
    expect(bad("visa=2")).toMatchObject({ param: "visa" });
  });
  it("validates enums", () => {
    expect(ok("workplace=hybrid&employment=contract&level=experienced").filter).toEqual({
      workplace: "hybrid", employment: "contract", level: "experienced",
    });
    expect(bad("workplace=remote-ish")).toMatchObject({ param: "workplace" });
    expect(bad("employment=freelance")).toMatchObject({ param: "employment" });
    expect(bad("level=senior")).toMatchObject({ param: "level" });
    expect(bad("sort=random")).toMatchObject({ param: "sort" });
  });
  it("bounds posted to 1..365 integers", () => {
    expect(ok("posted=1").filter.posted).toBe(1);
    expect(ok("posted=365").filter.posted).toBe(365);
    for (const v of ["0", "366", "-1", "1.5", "abc", "7d"]) expect(bad(`posted=${v}`)).toMatchObject({ param: "posted" });
  });
  it("bounds page and page_size", () => {
    expect(ok("page=100&page_size=100")).toMatchObject({ page: 100, pageSize: 100 });
    expect(ok("page_size=1").pageSize).toBe(1);
    expect(bad("page=101")).toMatchObject({ code: "page_out_of_range", param: "page" });
    for (const v of ["0", "-3", "1.5", "x"]) expect(bad(`page=${v}`)).toMatchObject({ code: "invalid_param", param: "page" });
    for (const v of ["0", "101", "x"]) expect(bad(`page_size=${v}`)).toMatchObject({ param: "page_size" });
  });
  it("checks company slug, min_pay and currency", () => {
    expect(ok("company=acme-labs&min_pay=150000&currency=inr").filter).toEqual({ company: "acme-labs", minPay: 150000, currency: "INR" });
    expect(bad("company=Acme%20Labs")).toMatchObject({ param: "company" });
    expect(bad("company=a%27%3B")).toMatchObject({ param: "company" });
    expect(bad("min_pay=0")).toMatchObject({ param: "min_pay" });
    expect(bad("min_pay=1000000001")).toMatchObject({ param: "min_pay" });
    expect(bad("min_pay=1e3")).toMatchObject({ param: "min_pay" });
    expect(bad("currency=EUR")).toMatchObject({ param: "currency" });
  });
  it("drops workplace=remote when remote=1 is present, keeps contradictions", () => {
    expect(ok("remote=1&workplace=remote").filter).toEqual({ remote: true });
    expect(ok("remote=1&workplace=hybrid").filter).toEqual({ remote: true, workplace: "hybrid" });
  });
  it("uses the first occurrence of a repeated key", () => {
    expect(ok("role=data-engineer&role=sales").filter.role).toBe("data-engineer");
    expect(bad("role=wizard&role=sales")).toMatchObject({ param: "role" });
  });
  it("reports the first failing parameter in canonical order", () => {
    expect(bad("sort=zz&q=").param).toBe("q");
  });
});

describe("serializeApi", () => {
  it("lists the shared 12 parameters first, then the API extras", () => {
    expect(API_PARAM_ORDER).toEqual([
      "q", "role", "country", "remote", "salary", "workplace", "employment", "level", "visa", "posted", "page", "sort",
      "company", "min_pay", "currency", "page_size",
    ]);
  });
  it("serialises canonically and drops defaults", () => {
    const q = ok("sort=fresh&page=1&currency=USD&page_size=50&remote=true&country=in&role=data-engineer&q=Data+Eng");
    expect(serializeApi(q)).toBe("q=data+eng&role=data-engineer&country=IN&remote=1");
  });
  it("keeps non-default values in order", () => {
    const q = ok("page_size=20&currency=INR&min_pay=5&sort=pay&page=3&level=mid");
    expect(serializeApi(q)).toBe("level=mid&page=3&sort=pay&min_pay=5&currency=INR&page_size=20");
  });
  it("round-trips", () => {
    const s = "q=a+b&role=sales&country=IN&remote=1&salary=1&workplace=hybrid&employment=fulltime&level=entry&visa=1&posted=7&page=2&sort=pay&company=co-1&min_pay=10&currency=INR&page_size=25";
    expect(serializeApi(ok(s))).toBe(s);
  });
});

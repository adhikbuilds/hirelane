import { describe, expect, it } from "vitest";
import { activeChips, parseBoardParams, serializeBoard, withFilter } from "../components/board/url-state";

const sp = (s: string) => new URLSearchParams(s);

describe("parseBoardParams", () => {
  it("defaults to an empty filter, page 1, fresh, 50 per page", () => {
    expect(parseBoardParams(sp(""))).toEqual({ filter: {}, page: 1, pageSize: 50, sort: "fresh" });
  });
  it("reads every shared parameter", () => {
    const q = parseBoardParams(
      sp("q=Data+Engineer&role=data-engineer&country=in&remote=1&salary=1&workplace=hybrid&employment=contract&level=experienced&visa=1&posted=7&page=3&sort=pay"),
    );
    expect(q.filter).toEqual({
      q: "data engineer", role: "data-engineer", country: "IN", remote: true, salary: true, workplace: "hybrid",
      employment: "contract", level: "experienced", visa: true, posted: 7,
    });
    expect(q.page).toBe(3);
    expect(q.sort).toBe("pay");
  });
  it("drops invalid values and unknown keys instead of failing", () => {
    const q = parseBoardParams(sp("role=astronaut&country=ZZ&remote=0&workplace=moon&level=senior&posted=0&posted=x&page=-1&sort=random&utm_source=x&company=acme&min_pay=5"));
    expect(q).toEqual({ filter: {}, page: 1, pageSize: 50, sort: "fresh" });
  });
  it("keeps the first valid occurrence of a repeated key", () => {
    expect(parseBoardParams(sp("role=nope&role=design&role=sales")).filter.role).toBe("design");
  });
  it("normalises q: NFKC, collapse whitespace, lowercase, 100 chars max", () => {
    expect(parseBoardParams(sp("q=%20%20Ｒust%20%20%20Dev%20")).filter.q).toBe("rust dev");
    expect(parseBoardParams(sp(`q=${"a".repeat(101)}`)).filter.q).toBeUndefined();
    expect(parseBoardParams(sp("q=%20%20")).filter.q).toBeUndefined();
  });
  it("treats remote=1 with workplace=remote as remote=1 only", () => {
    expect(parseBoardParams(sp("remote=1&workplace=remote")).filter).toEqual({ remote: true });
  });
  it("keeps remote=1 with a conflicting workplace", () => {
    expect(parseBoardParams(sp("remote=1&workplace=hybrid")).filter).toEqual({ remote: true, workplace: "hybrid" });
  });
  it("accepts posted 1 to 365 and clamps page to 100", () => {
    expect(parseBoardParams(sp("posted=365")).filter.posted).toBe(365);
    expect(parseBoardParams(sp("posted=366")).filter.posted).toBeUndefined();
    expect(parseBoardParams(sp("page=500")).page).toBe(100);
  });
  it("accepts a Next searchParams object", () => {
    expect(parseBoardParams({ role: ["design", "sales"], remote: "1", page: undefined }).filter).toEqual({ role: "design", remote: true });
  });
});

describe("serializeBoard", () => {
  it("emits canonical order, drops defaults, uppercases country", () => {
    const s = serializeBoard({ filter: { country: "IN", remote: true, salary: true, role: "design", q: "a b" }, page: 1, sort: "fresh" });
    expect(s).toBe("q=a+b&role=design&country=IN&remote=1&salary=1");
  });
  it("includes page and sort only when not default", () => {
    expect(serializeBoard({ filter: {}, page: 2, sort: "pay" })).toBe("page=2&sort=pay");
  });
  it("round-trips through parse", () => {
    const q = parseBoardParams(sp("sort=pay&country=IN&remote=1&salary=1&page=4&q=go+dev"));
    expect(parseBoardParams(sp(serializeBoard(q)))).toEqual(q);
  });
});

describe("withFilter", () => {
  const base = parseBoardParams(sp("role=design&country=IN&page=3"));
  it("sets a key and resets the page", () => {
    expect(withFilter(base, { remote: true })).toBe("role=design&country=IN&remote=1");
  });
  it("clears a key with undefined", () => {
    expect(withFilter(base, { country: undefined })).toBe("role=design");
  });
  it("setting workplace=remote collapses into the remote flag", () => {
    expect(withFilter(base, { workplace: "remote" })).toBe("role=design&country=IN&remote=1");
  });
});

describe("activeChips", () => {
  it("lists each active filter with a link that removes only it", () => {
    const chips = activeChips(parseBoardParams(sp("role=design&country=IN&remote=1")));
    expect(chips.map((c) => c.key)).toEqual(["role", "country", "remote"]);
    expect(chips[0]?.removeQuery).toBe("country=IN&remote=1");
  });
  it("is empty when nothing is filtered", () => {
    expect(activeChips(parseBoardParams(sp("page=2&sort=pay")))).toEqual([]);
  });
});

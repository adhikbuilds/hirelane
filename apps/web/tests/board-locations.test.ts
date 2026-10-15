import { describe, expect, it } from "vitest";
import { dedupeLocations, whereSummary } from "../components/board/locations";

describe("dedupeLocations", () => {
  it("shows Bangalore and Bengaluru once", () => {
    expect(dedupeLocations(["Bangalore, India", "Bengaluru, India"])).toEqual(["Bengaluru, India"]);
  });
  it("merges a bare city with its fuller form", () => {
    expect(dedupeLocations(["Bengaluru", "Bengaluru, Karnataka, India"])).toEqual(["Bengaluru, India"]);
  });
  it("collapses state and region suffixes", () => {
    expect(dedupeLocations(["Bengaluru, Karnataka, India, APAC", "Bengaluru, India"])).toEqual(["Bengaluru, India"]);
  });
  it("ignores a workplace prefix", () => {
    expect(dedupeLocations(["Hybrid in Bangalore, India", "Hybrid in Bengaluru, India"])).toEqual(["Bengaluru, India"]);
  });
  it("reads Country - City and splits lists of places", () => {
    expect(dedupeLocations(["India - Bengaluru", "Bengaluru; Gurugram"])).toEqual(["Bengaluru, India", "Gurugram, India"]);
  });
  it("keeps different cities, in first-seen order", () => {
    expect(dedupeLocations(["Mumbai, India", "Bangalore, India", "Mumbai, India"])).toEqual(["Mumbai, India", "Bengaluru, India"]);
  });
  it("keeps same-named cities in different countries apart", () => {
    expect(dedupeLocations(["London, United Kingdom", "London, Canada"]).length).toBe(2);
  });
  it("keeps strings it cannot place as their own entry", () => {
    expect(dedupeLocations(["India Locations", "Bangalore, India"])).toEqual(["India Locations", "Bengaluru, India"]);
  });
  it("de-duplicates unplaceable strings by normalised text", () => {
    expect(dedupeLocations(["Remote - Anywhere", "remote - anywhere"])).toEqual(["Remote - Anywhere"]);
  });
  it("handles empty and blank input", () => {
    expect(dedupeLocations([])).toEqual([]);
    expect(dedupeLocations(["", "  "])).toEqual([]);
  });
});

describe("whereSummary", () => {
  it("shows ISO codes plus workplace, with the cities as detail", () => {
    expect(whereSummary({ locations: ["Bangalore, India", "Bengaluru, India", "Pune, India"], countries: ["IN"], workplace: "hybrid" })).toEqual({
      primary: "IN", more: 0, workplace: "Hybrid", detail: "Bengaluru, India; Pune, India",
    });
  });
  it("lists up to three codes and counts the rest", () => {
    expect(whereSummary({ locations: [], countries: ["IN", "US", "GB", "DE", "FR"], workplace: null })).toEqual({
      primary: "IN, US, GB", more: 2, workplace: null, detail: null,
    });
  });
  it("reads Worldwide for worldwide remote with no country", () => {
    expect(whereSummary({ locations: [], countries: [], workplace: "remote", remoteScope: "worldwide" }).primary).toBe("Worldwide");
  });
  it("falls back to the first city when no country is known", () => {
    expect(whereSummary({ locations: ["Remote - Anywhere", "Remote - Anywhere"], countries: [], workplace: "remote" })).toMatchObject({ primary: "Remote - Anywhere", more: 0 });
  });
  it("is null when nothing is stated", () => {
    expect(whereSummary({ locations: [], countries: [], workplace: null }).primary).toBeNull();
  });
});

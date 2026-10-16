import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { DEFAULT_PANEL, ROAD_SLOTS, loadRoadPhotos, nearestSlot, parseRoadJson, toSlot } from "../lib/landing-v3/photos";

const rect = { x: 20, y: 10, width: 50, height: 20 };

describe("parseRoadJson", () => {
  it("returns all four photos with the real panels from a slot-keyed object", () => {
    const photos = parseRoadJson({ "0000": rect, "0600": { ...rect, x: 21 }, "1200": { ...rect, x: 22 }, "1800": { ...rect, x: 23 } });
    expect(photos.map((p) => p.slot)).toEqual([...ROAD_SLOTS]);
    expect(photos.map((p) => p.panel.x)).toEqual([20, 21, 22, 23]);
    expect(photos.every((p) => !p.panelIsFallback)).toBe(true);
    expect(photos[1]).toMatchObject({ hour: 6, src: "/landing/road-0600.jpg" });
  });

  it("accepts file-name keys, a photos wrapper, left/top/w/h and arrays", () => {
    expect(parseRoadJson({ photos: { "road-1200.jpg": { left: 5, top: 5, w: 40, h: 30 } } })[2]).toMatchObject({ panel: { x: 5, y: 5, width: 40, height: 30 }, panelIsFallback: false });
    const arr = parseRoadJson([{ file: "road-1800.jpg", panel: rect }, { hour: 6, ...rect }]);
    expect(arr[3]!.panelIsFallback).toBe(false);
    expect(arr[1]!.panelIsFallback).toBe(false);
    expect(arr[0]!.panelIsFallback).toBe(true);
  });

  it.each([null, undefined, 42, "text", [], {}, [1, "a", null], { "0000": "nope" }])("falls back safely for %j", (bad) => {
    const photos = parseRoadJson(bad);
    expect(photos).toHaveLength(4);
    expect(photos.every((p) => p.panelIsFallback && p.panel === DEFAULT_PANEL)).toBe(true);
  });

  it("rejects rectangles that are out of frame, empty, negative or not numbers, per photo", () => {
    const photos = parseRoadJson({
      "0000": { x: 80, y: 10, width: 40, height: 10 },
      "0600": { x: 10, y: 10, width: 0, height: 10 },
      "1200": { x: -1, y: 10, width: 10, height: 10 },
      "1800": { x: "10", y: 10, width: 10, height: 10 },
    });
    expect(photos.every((p) => p.panelIsFallback)).toBe(true);
  });

  it("keeps good photos when only some entries are bad", () => {
    const photos = parseRoadJson({ "0000": rect, "0600": { x: NaN } });
    expect(photos[0]!.panelIsFallback).toBe(false);
    expect(photos[1]!.panelIsFallback).toBe(true);
  });
});

describe("loadRoadPhotos", () => {
  const dir = () => mkdtempSync(join(tmpdir(), "road-"));

  it("reads road.json from disk", () => {
    const d = dir();
    writeFileSync(join(d, "road.json"), JSON.stringify({ "0000": rect }));
    expect(loadRoadPhotos(d)[0]!.panel).toEqual(rect);
  });

  it("falls back on invalid JSON", () => {
    const d = dir();
    writeFileSync(join(d, "road.json"), "{not json");
    const photos = loadRoadPhotos(d);
    expect(photos).toHaveLength(4);
    expect(photos.every((p) => p.panelIsFallback)).toBe(true);
  });

  it("falls back when the file is missing", () => {
    expect(loadRoadPhotos(join(dir(), "nope"))).toHaveLength(4);
  });
});

describe("toSlot / nearestSlot", () => {
  it("normalises keys", () => {
    expect(toSlot("06:00")).toBe("0600");
    expect(toSlot("/landing/road-1800.jpg")).toBe("1800");
    expect(toSlot("0700")).toBeNull();
    expect(toSlot(7)).toBeNull();
  });

  it("picks the nearest read time on the 24-hour circle", () => {
    expect(nearestSlot("2026-10-16T02:59:00Z")).toBe("0000");
    expect(nearestSlot("2026-10-16T03:01:00Z")).toBe("0600");
    expect(nearestSlot("2026-10-16T09:00:00Z")).toBe("0600");
    expect(nearestSlot("2026-10-16T15:30:00Z")).toBe("1800");
    expect(nearestSlot("2026-10-16T22:00:00Z")).toBe("0000");
    expect(nearestSlot("2026-10-16T20:59:00Z")).toBe("1800");
  });

  it("handles missing and invalid dates", () => {
    expect(nearestSlot(null)).toBe("0000");
    expect(nearestSlot("garbage")).toBe("0000");
  });
});

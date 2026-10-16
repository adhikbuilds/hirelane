/**
 * Hero road photographs for landing v3 (docs/design/landing-v3.md): the same viewpoint at the four
 * read times (00:00, 06:00, 12:00, 18:00 UTC), each with a blank overhead sign gantry.
 * `public/landing/road.json` gives each photo's sign-panel rectangle in percent of the image.
 *
 * Server-side loader (reads from disk). `parseRoadJson` and `nearestSlot` are pure and safe anywhere.
 * Bad or missing JSON never throws: every photo falls back to a default panel.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

export const ROAD_SLOTS = ["0000", "0600", "1200", "1800"] as const;
export type RoadSlot = (typeof ROAD_SLOTS)[number];

/** A rectangle in percent (0-100) of the photo's width and height. */
export interface PanelRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface RoadPhoto {
  slot: RoadSlot;
  /** UTC hour the photo stands for. */
  hour: 0 | 6 | 12 | 18;
  /** Public URL path. */
  src: string;
  panel: PanelRect;
  /** True when road.json had no usable rectangle for this photo and the default was used. */
  panelIsFallback: boolean;
}

/** Image size the photos are generated at. */
export const ROAD_IMAGE = { width: 1440, height: 960 } as const;

/** Where a gantry panel sits if road.json is missing or invalid: upper-middle of the frame. */
export const DEFAULT_PANEL: PanelRect = { x: 30, y: 6, width: 40, height: 24 };

const HOURS: Record<RoadSlot, RoadPhoto["hour"]> = { "0000": 0, "0600": 6, "1200": 12, "1800": 18 };

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

/** Maps "0600", "road-0600", "road-0600.jpg", "06:00", "/landing/road-0600.jpg" to a slot. */
export function toSlot(key: unknown): RoadSlot | null {
  if (typeof key !== "string") return null;
  const colon = /(?:^|[^0-9])(\d{2}):(\d{2})(?:[^0-9]|$)/.exec(key);
  if (colon) {
    const slot = `${colon[1]}${colon[2]}`;
    return (ROAD_SLOTS as readonly string[]).includes(slot) ? (slot as RoadSlot) : null;
  }
  const four = /(\d{4})/.exec(key);
  return four && (ROAD_SLOTS as readonly string[]).includes(four[1]!) ? (four[1] as RoadSlot) : null;
}

/** Reads {x,y,width,height} (also left/top/w/h) and validates it sits inside the frame. */
export function toRect(v: unknown): PanelRect | null {
  if (!isRecord(v)) return null;
  const x = num(v.x ?? v.left);
  const y = num(v.y ?? v.top);
  const width = num(v.width ?? v.w);
  const height = num(v.height ?? v.h);
  if (x === null || y === null || width === null || height === null) return null;
  if (x < 0 || y < 0 || width <= 0 || height <= 0) return null;
  if (x + width > 100.0001 || y + height > 100.0001) return null;
  return { x, y, width, height };
}

/**
 * Accepts `{ "0600": {x,y,width,height}, ... }`, `{ photos|panels|signs: {...} }`, or an array of
 * `{ slot|file|src|name|hour, ...rect }` / `{ ..., panel: {...} }`. Anything else yields all fallbacks.
 */
export function parseRoadJson(raw: unknown): RoadPhoto[] {
  const rects = new Map<RoadSlot, PanelRect>();
  const add = (key: unknown, value: unknown) => {
    const slot = toSlot(key);
    const rect = toRect(isRecord(value) && "panel" in value ? value.panel : value);
    if (slot && rect && !rects.has(slot)) rects.set(slot, rect);
  };
  const fromObject = (o: Record<string, unknown>) => {
    for (const [k, v] of Object.entries(o)) add(k, v);
  };

  if (Array.isArray(raw)) {
    for (const item of raw) {
      if (!isRecord(item)) continue;
      const key = item.slot ?? item.file ?? item.src ?? item.name ?? item.id ?? (typeof item.hour === "number" ? String(item.hour * 100).padStart(4, "0") : undefined);
      add(key, item);
    }
  } else if (isRecord(raw)) {
    const nested = raw.photos ?? raw.panels ?? raw.signs;
    if (Array.isArray(nested)) return parseRoadJson(nested);
    fromObject(isRecord(nested) ? nested : raw);
  }

  return ROAD_SLOTS.map((slot) => {
    const panel = rects.get(slot);
    return {
      slot,
      hour: HOURS[slot],
      src: `/landing/road-${slot}.jpg`,
      panel: panel ?? DEFAULT_PANEL,
      panelIsFallback: !panel,
    };
  });
}

/** Loads the four photos with their panels. Missing file or bad JSON gives fallbacks, never an exception. */
export function loadRoadPhotos(root: string = join(process.cwd(), "public", "landing")): RoadPhoto[] {
  try {
    return parseRoadJson(JSON.parse(readFileSync(join(root, "road.json"), "utf8")));
  } catch {
    return parseRoadJson(null);
  }
}

/** The slot nearest to a moment, measured on the 24-hour circle in UTC. Invalid dates give "0000". */
export function nearestSlot(at: Date | string | number | null | undefined): RoadSlot {
  const d = at == null ? new Date(NaN) : new Date(at);
  if (Number.isNaN(d.getTime())) return "0000";
  const hours = d.getUTCHours() + d.getUTCMinutes() / 60 + d.getUTCSeconds() / 3600;
  let best: RoadSlot = "0000";
  let bestDist = Infinity;
  for (const slot of ROAD_SLOTS) {
    const diff = Math.abs(hours - HOURS[slot]);
    const dist = Math.min(diff, 24 - diff);
    if (dist < bestDist) {
      best = slot;
      bestDist = dist;
    }
  }
  return best;
}

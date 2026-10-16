/**
 * Road photos for the hero, read straight from public/landing/road.json.
 * road.json nests each sign rectangle as `sign: {x, y, w, h}` (percent of the photo); `lib/landing-v3/photos.ts`
 * does not read that key and falls back to a default panel, so the hero parses the file itself.
 * `parseRoad` is pure and never throws: anything unusable yields the fallback rectangles.
 */
export type SignRect = { x: number; y: number; w: number; h: number };
export type RoadShot = { slot: "0000" | "0600" | "1200" | "1800"; src: string; alt: string; sign: SignRect; fallback: boolean };

const SLOTS = ["0000", "0600", "1200", "1800"] as const;
const LABELS: Record<(typeof SLOTS)[number], string> = { "0000": "midnight", "0600": "dawn", "1200": "noon", "1800": "dusk" };
/** Measured from the shipped photos; used only if road.json is missing or invalid. */
export const FALLBACK_SIGN: SignRect = { x: 22, y: 20.8, w: 60, h: 24 };

const isRec = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const n = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);

export function toSignRect(v: unknown): SignRect | null {
  if (!isRec(v)) return null;
  const x = n(v.x);
  const y = n(v.y);
  const w = n(v.w ?? v.width);
  const h = n(v.h ?? v.height);
  if (x === null || y === null || w === null || h === null) return null;
  if (x < 0 || y < 0 || w <= 0 || h <= 0 || x + w > 100.001 || y + h > 100.001) return null;
  return { x, y, w, h };
}

export function parseRoad(raw: unknown): RoadShot[] {
  const items = isRec(raw) && Array.isArray(raw.photos) ? raw.photos : Array.isArray(raw) ? raw : [];
  return SLOTS.map((slot) => {
    const item = items.find((i) => isRec(i) && typeof i.file === "string" && i.file.includes(slot));
    const rec = isRec(item) ? item : null;
    const sign = rec ? toSignRect(rec.sign ?? rec) : null;
    return {
      slot,
      src: `/landing/road-${slot}.jpg`,
      alt: typeof rec?.alt === "string" ? rec.alt : `An elevated road in Bengaluru at ${LABELS[slot]} under a green overhead sign (AI-generated illustration)`,
      sign: sign ?? FALLBACK_SIGN,
      fallback: !sign,
    };
  });
}

/** Index of the photo nearest to a UTC moment on the 24-hour circle, so the first paint matches the real time of day. */
export function startIndex(at: Date): number {
  const h = at.getUTCHours() + at.getUTCMinutes() / 60;
  const hours = [0, 6, 12, 18];
  let best = 0;
  let bestD = Infinity;
  hours.forEach((slotH, i) => {
    const d = Math.abs(h - slotH);
    const dist = Math.min(d, 24 - d);
    if (dist < bestD) {
      bestD = dist;
      best = i;
    }
  });
  return best;
}

/**
 * The part of the sign every photo shares. The four photos are the same viewpoint, so their signs differ by a point or
 * two; one text block set on the shared part stays still while the photos crossfade, instead of ghosting.
 */
export function commonSign(shots: readonly RoadShot[]): SignRect {
  if (shots.length === 0) return FALLBACK_SIGN;
  const left = Math.max(...shots.map((s) => s.sign.x));
  const top = Math.max(...shots.map((s) => s.sign.y));
  const right = Math.min(...shots.map((s) => s.sign.x + s.sign.w));
  const bottom = Math.min(...shots.map((s) => s.sign.y + s.sign.h));
  if (right <= left || bottom <= top) return shots[0]!.sign;
  return { x: left, y: top, w: right - left, h: bottom - top };
}

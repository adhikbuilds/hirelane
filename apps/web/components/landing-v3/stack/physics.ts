/**
 * Pure drag physics for the landing swipe stack (docs/design/landing-v3.md, "Drag and swipe").
 * No DOM, no motion library, no clock: every rule is a function of numbers, so it is unit tested.
 * Positive x is the right (Approve), negative x is the left (Pass).
 */

export type Decision = "approve" | "pass";

/** A drag past this share of the card width commits. */
export const COMMIT_RATIO = 0.35;
/** A release faster than this (px/s) commits, even for a short drag. */
export const COMMIT_VELOCITY = 600;
/** Card rotation at the extreme, in degrees. */
export const MAX_ROTATE = 12;
/** A drag steeper than this angle from horizontal is a page scroll, never a swipe. */
export const VERTICAL_ANGLE = 30;
/** A flick needs at least this much travel, so a twitch never decides a card. */
export const MIN_FLICK_TRAVEL = 12;

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));
const finite = (n: number) => Number.isFinite(n);

/** 0 at rest, 1 at the commit threshold (and beyond). */
export function dragProgress(x: number, width: number): number {
  if (!finite(x) || !finite(width) || width <= 0) return 0;
  return clamp(Math.abs(x) / (width * COMMIT_RATIO), 0, 1);
}

/** What a release at offset `dx` (px) and velocity `vx` (px/s) decides, or null to spring back. */
export function shouldCommit(dx: number, vx: number, width: number): Decision | null {
  if (!finite(dx) || !finite(vx) || !finite(width) || width <= 0) return null;
  if (Math.abs(dx) >= width * COMMIT_RATIO) return dx > 0 ? "approve" : "pass";
  if (Math.abs(vx) >= COMMIT_VELOCITY && Math.abs(dx) >= MIN_FLICK_TRAVEL && Math.sign(vx) === Math.sign(dx)) {
    return vx > 0 ? "approve" : "pass";
  }
  return null;
}

/** Degrees. Pivots from below the card; reaches the maximum at 60% of the card width. */
export function rotationFor(x: number, width: number): number {
  if (!finite(x) || !finite(width) || width <= 0) return 0;
  return clamp((x / (width * 0.6)) * MAX_ROTATE, -MAX_ROTATE, MAX_ROTATE);
}

/** Stamp opacity: zero on the wrong side, then grows with distance and is full at the threshold. */
export function stampOpacity(x: number, width: number, which: Decision): number {
  if (which === "approve" ? !(x > 0) : !(x < 0)) return 0;
  const p = dragProgress(x, width);
  return clamp((p - 0.06) / 0.94, 0, 1);
}

/** Stamp scale: 0.8 at rest up to 1 at the threshold, snapping to 1.08 once past it. */
export function stampScale(x: number, width: number): number {
  const p = dragProgress(x, width);
  return p >= 1 ? 1.08 : 0.8 + 0.2 * p;
}

/** Tint over the card (sign green for approve, grey-black for pass): grows with distance, capped. */
export function tintOpacity(x: number, width: number): number {
  return dragProgress(x, width) * 0.55;
}

export type FlyOut = { x: number; y: number; rotate: number; duration: number };

/** Where a decided card goes: out in the throw direction, carrying the release velocity into rotation and speed. */
export function flyOutVector(which: Decision, vx: number, width: number): FlyOut {
  const dir = which === "approve" ? 1 : -1;
  const v = finite(vx) && Math.sign(vx) === dir ? Math.min(Math.abs(vx), 4000) : 0;
  const w = finite(width) && width > 0 ? width : 400;
  const distance = w * 1.5 + v * 0.12;
  const duration = clamp(distance / Math.max(v, 1400), 0.16, 0.42);
  return { x: dir * distance, y: -16 - v * 0.008, rotate: dir * (MAX_ROTATE + Math.min(10, v / 240)), duration };
}

/** True when the drag is steeper than 30 degrees from horizontal. */
export function isMostlyVertical(dx: number, dy: number): boolean {
  if (!finite(dx) || !finite(dy)) return false;
  const ax = Math.abs(dx);
  const ay = Math.abs(dy);
  if (ax === 0 && ay === 0) return false;
  return Math.atan2(ay, ax) * (180 / Math.PI) > VERTICAL_ANGLE;
}

/** Two-layer shadow: tight contact plus wide ambient. Both grow with lift (0 at rest, 1 fully lifted). */
export function shadowFor(lift: number): string {
  const l = clamp(finite(lift) ? lift : 0, 0, 1);
  const contact = `0 ${(3 + 7 * l).toFixed(1)}px ${(8 + 12 * l).toFixed(1)}px rgb(0 0 0 / ${(0.4 + 0.12 * l).toFixed(2)})`;
  const ambient = `0 ${(24 + 36 * l).toFixed(1)}px ${(48 + 56 * l).toFixed(1)}px rgb(0 0 0 / ${(0.48 + 0.12 * l).toFixed(2)})`;
  return `${contact}, ${ambient}`;
}

export type Pose = { scale: number; y: number; opacity: number };

/** Resting pose by depth in the stack: 0 is the top card; deeper cards are smaller, lower and dimmer. */
export function restingPose(depth: number): Pose {
  const d = clamp(Math.round(finite(depth) ? depth : 0), 0, 2);
  return { scale: 1 - 0.05 * d, y: 14 * d, opacity: d === 0 ? 1 : d === 1 ? 0.94 : 0.86 };
}

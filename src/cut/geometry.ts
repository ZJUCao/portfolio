// Pure geometry of the space-cut transitions: fitting a stroke, the lens window, the wand's moving
// hole, how far a window must grow to cover the surface, and polygon helpers. No DOM, no React.
// Contract: docs/design_space_cut.md §5.1. Coordinates are CSS px in the cut surface's own box.

import { CLICK, KNIFE, WAND } from "./constants";

export type Pt = readonly [number, number];
export type Size = { width: number; height: number };
/** A fitted stroke: its midpoint, unit direction and normal, half length and largest deviation. */
export type Line = { mid: Pt; dir: Pt; normal: Pt; halfLength: number; deviation: number };
export type InputSource = "mouse" | "touch" | "pen" | "hand" | "keyboard";
export type Harmonic = { k: number; amp: number; phase: number; speed: number };
/** The wand's hole: a circle whose radius ripples with a few slowly turning sine waves. */
export type Blob = { center: Pt; harmonics: readonly Harmonic[] };

const clampTo = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const shortSide = (v: Size) => Math.min(v.width, v.height);
const cornersOf = (v: Size): Pt[] => [
  [0, 0],
  [v.width, 0],
  [v.width, v.height],
  [0, v.height],
];

/** Fits a straight line to a stroke by principal component analysis. */
export function fitLine(points: readonly Pt[]): Line {
  const n = points.length;
  let mx = 0;
  let my = 0;
  for (const [x, y] of points) {
    mx += x;
    my += y;
  }
  mx /= n || 1;
  my /= n || 1;
  let sxx = 0;
  let syy = 0;
  let sxy = 0;
  for (const [x, y] of points) {
    const dx = x - mx;
    const dy = y - my;
    sxx += dx * dx;
    syy += dy * dy;
    sxy += dx * dy;
  }
  const a = 0.5 * Math.atan2(2 * sxy, sxx - syy);
  const dir: Pt = [Math.cos(a), Math.sin(a)];
  const normal: Pt = [-dir[1], dir[0]];
  let tmin = Infinity;
  let tmax = -Infinity;
  let deviation = 0;
  for (const [x, y] of points) {
    const dx = x - mx;
    const dy = y - my;
    const t = dx * dir[0] + dy * dir[1];
    tmin = Math.min(tmin, t);
    tmax = Math.max(tmax, t);
    deviation = Math.max(deviation, Math.abs(dx * normal[0] + dy * normal[1]));
  }
  if (!n) return { mid: [0, 0], dir, normal, halfLength: 0, deviation: 0 };
  const c = (tmin + tmax) / 2;
  return { mid: [mx + dir[0] * c, my + dir[1] * c], dir, normal, halfLength: (tmax - tmin) / 2, deviation };
}

/** Whether a fitted stroke is long and straight enough to cut (§7). */
export function checkStroke(line: Line, viewport: Size, source: InputSource): "ok" | "too-short" | "not-straight" {
  const length = 2 * line.halfLength;
  if (length < Math.max(KNIFE.minLengthPx, shortSide(viewport) * KNIFE.minLengthShort)) return "too-short";
  const limit = source === "hand" ? KNIFE.maxDeviationHand : KNIFE.maxDeviation;
  return line.deviation / length > limit ? "not-straight" : "ok";
}

/** Half-width of the knife's window when it stops, from the stroke's half length (§7). */
export function lensHalfWidth(line: Line, viewport: Size): number {
  return clampTo(line.halfLength * KNIFE.halfWidthRatio, KNIFE.halfWidthMinPx, shortSide(viewport) * KNIFE.halfWidthMaxShort);
}

/** A lens along the line: pointed at both ends, widest in the middle. 2 (n + 1) points. */
export function lensPoints(line: Line, scale: number, halfWidth: number, sharpness: number, n = 40): Pt[] {
  const { mid, dir, normal } = line;
  const hl = line.halfLength * scale;
  const h = halfWidth * scale;
  const top: Pt[] = [];
  const bottom: Pt[] = [];
  for (let i = 0; i <= n; i++) {
    const s = -1 + (2 * i) / n;
    const x = s * hl;
    const y = h * Math.pow(Math.max(0, 1 - s * s), sharpness);
    top.push([mid[0] + dir[0] * x + normal[0] * y, mid[1] + dir[1] * x + normal[1] * y]);
    bottom.push([mid[0] + dir[0] * x - normal[0] * y, mid[1] + dir[1] * x - normal[1] * y]);
  }
  return top.concat(bottom.reverse());
}

/** The scale at which the lens, as an ellipse, covers every corner of the surface. At least 1. */
export function lensCoverScale(line: Line, halfWidth: number, viewport: Size): number {
  let k = 1;
  for (const [cx, cy] of cornersOf(viewport)) {
    const dx = cx - line.mid[0];
    const dy = cy - line.mid[1];
    const x = dx * line.dir[0] + dy * line.dir[1];
    const y = dx * line.normal[0] + dy * line.normal[1];
    k = Math.max(k, Math.hypot(x / line.halfLength, y / halfWidth));
  }
  return k * KNIFE.coverMargin;
}

/** A new hole at a point, with random phases and turning directions. */
export function makeBlob(center: Pt, random: () => number): Blob {
  const harmonics = WAND.harmonics.map(([k, amp]) => ({
    k,
    amp,
    phase: random() * Math.PI * 2,
    speed: (WAND.speedMin + random() * WAND.speedSpan) * (random() < 0.5 ? -1 : 1),
  }));
  return { center, harmonics };
}

/** The factor by which the hole's radius is stretched at an angle and a time. */
export function blobScaleAt(blob: Blob, angle: number, wobble: number, timeSeconds: number): number {
  let k = 1;
  for (const h of blob.harmonics) k += h.amp * wobble * Math.sin(h.k * angle + h.phase + h.speed * timeSeconds);
  return k;
}

/** The hole's outline, n points. wobble 0 is a circle. */
export function blobPoints(blob: Blob, radius: number, wobble: number, timeSeconds: number, n = 96): Pt[] {
  const [cx, cy] = blob.center;
  const pts: Pt[] = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const r = radius * blobScaleAt(blob, a, wobble, timeSeconds);
    pts.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]);
  }
  return pts;
}

/** The scale at which the hole covers every corner of the surface. More than 1. */
export function blobCoverScale(blob: Blob, radius: number, viewport: Size): number {
  let far = 0;
  for (const [x, y] of cornersOf(viewport)) far = Math.max(far, Math.hypot(x - blob.center[0], y - blob.center[1]));
  return Math.max(1.01, (far / Math.max(radius, 1e-6)) * WAND.coverMargin);
}

/** The line drawn by click to cut: through the point, leaning 55°–70° either way (§7). */
export function autoCutLine(at: Pt, viewport: Size, random: () => number): Line {
  const deg = (CLICK.angleMinDeg + random() * CLICK.angleSpanDeg) * (random() < 0.5 ? -1 : 1);
  const a = (deg * Math.PI) / 180;
  const dir: Pt = [Math.cos(a), Math.sin(a)];
  const halfLength = clampTo(shortSide(viewport) * CLICK.halfLengthShort, CLICK.halfLengthMinPx, CLICK.halfLengthMaxPx);
  return { mid: [at[0], at[1]], dir, normal: [-dir[1], dir[0]], halfLength, deviation: 0 };
}

/** Even-odd point in polygon. */
export function inPolygon(p: Pt, polygon: readonly Pt[]): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [xi, yi] = polygon[i];
    const [xj, yj] = polygon[j];
    if (yi > p[1] !== yj > p[1] && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** The polygon as a CSS clip-path value. */
export function toClipPath(polygon: readonly Pt[]): string {
  return `polygon(${polygon.map(([x, y]) => `${x.toFixed(1)}px ${y.toFixed(1)}px`).join(", ")})`;
}

/** The centre of the polygon's bounding box, or null when it is empty. */
export function polygonCenter(polygon: readonly Pt[]): Pt | null {
  if (!polygon.length) return null;
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const [x, y] of polygon) {
    x0 = Math.min(x0, x);
    y0 = Math.min(y0, y);
    x1 = Math.max(x1, x);
    y1 = Math.max(y1, y);
  }
  return [(x0 + x1) / 2, (y0 + y1) / 2];
}

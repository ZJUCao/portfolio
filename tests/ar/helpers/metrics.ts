// Metrics, reference algorithms and assertion helpers for the detector tests
// (docs/test_plan_camera_ar.md §1.2 and §2.5).

import { expect } from "vitest";
import { cornerGrid, cornerXY } from "./boardModel";
import { type Mat3, applyHomography, jacobiEigenSymmetric, mul3 } from "./linalg";
import type { Render, TestImage } from "./render";

export interface CornerErrors {
  readonly rms: number;
  readonly max: number;
  readonly per: Float64Array;
}

/** Index-wise distances between a result and the ground truth, in pixels. */
export function cornerErrors(result: ArrayLike<number>, truth: ArrayLike<number>): CornerErrors {
  const n = truth.length / 2;
  const per = new Float64Array(n);
  let sum = 0;
  let max = 0;
  for (let k = 0; k < n; k++) {
    const d = Math.hypot(result[2 * k] - truth[2 * k], result[2 * k + 1] - truth[2 * k + 1]);
    per[k] = d;
    sum += d * d;
    max = Math.max(max, d);
  }
  return { rms: Math.sqrt(sum / n), max, per };
}

/** O2: cross(p(1,0) − p(0,0), p(0,1) − p(0,0)) with image y pointing down. */
export function crossAtCorner0(corners: ArrayLike<number>, cornersX: number): number {
  const ax = corners[2] - corners[0];
  const ay = corners[3] - corners[1];
  const bx = corners[2 * cornersX] - corners[0];
  const by = corners[2 * cornersX + 1] - corners[1];
  return ax * by - ay * bx;
}

/** Distance from every corner to its nearest lattice neighbour, in pixels. */
export function localSpacing(corners: ArrayLike<number>, cornersX: number, cornersY: number): Float64Array {
  const out = new Float64Array(cornersX * cornersY);
  for (let j = 0; j < cornersY; j++) {
    for (let i = 0; i < cornersX; i++) {
      const k = j * cornersX + i;
      let best = Infinity;
      for (const [di, dj] of [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ]) {
        const ni = i + di;
        const nj = j + dj;
        if (ni < 0 || nj < 0 || ni >= cornersX || nj >= cornersY) continue;
        const m = nj * cornersX + ni;
        best = Math.min(best, Math.hypot(corners[2 * m] - corners[2 * k], corners[2 * m + 1] - corners[2 * k + 1]));
      }
      out[k] = best;
    }
  }
  return out;
}

function normalisation(points: ArrayLike<number>): { T: number[]; Tinv: number[] } {
  const n = points.length / 2;
  let mx = 0;
  let my = 0;
  for (let k = 0; k < n; k++) {
    mx += points[2 * k] / n;
    my += points[2 * k + 1] / n;
  }
  let d = 0;
  for (let k = 0; k < n; k++) d += Math.hypot(points[2 * k] - mx, points[2 * k + 1] - my) / n;
  const s = Math.SQRT2 / d;
  return { T: [s, 0, -s * mx, 0, s, -s * my, 0, 0, 1], Tinv: [1 / s, 0, mx, 0, 1 / s, my, 0, 0, 1] };
}

/** Normalised DLT homography from src to dst (point lists [x0, y0, x1, y1, …]) and its geometric RMS residual. */
export function fitHomography(src: ArrayLike<number>, dst: ArrayLike<number>): { H: number[]; rms: number } {
  const n = src.length / 2;
  const a = normalisation(src);
  const b = normalisation(dst);
  const ata = Array.from({ length: 9 }, () => new Array<number>(9).fill(0));
  for (let k = 0; k < n; k++) {
    const x = a.T[0] * src[2 * k] + a.T[2];
    const y = a.T[4] * src[2 * k + 1] + a.T[5];
    const u = b.T[0] * dst[2 * k] + b.T[2];
    const v = b.T[4] * dst[2 * k + 1] + b.T[5];
    for (const row of [
      [-x, -y, -1, 0, 0, 0, u * x, u * y, u],
      [0, 0, 0, -x, -y, -1, v * x, v * y, v],
    ]) {
      for (let i = 0; i < 9; i++) for (let j = 0; j < 9; j++) ata[i][j] += row[i] * row[j];
    }
  }
  const { values, vectors } = jacobiEigenSymmetric(ata);
  let smallest = 0;
  for (let i = 1; i < 9; i++) if (values[i] < values[smallest]) smallest = i;
  let H = mul3(mul3(b.Tinv, vectors[smallest]), a.T);
  // The eigenvector's sign is arbitrary; choose the one that puts the source points in front (w > 0)
  if (applyHomography(H, src[0], src[1])[2] < 0) H = H.map((value) => -value);
  let sum = 0;
  for (let k = 0; k < n; k++) {
    const [u, v] = applyHomography(H, src[2 * k], src[2 * k + 1]);
    sum += (u - dst[2 * k]) ** 2 + (v - dst[2 * k + 1]) ** 2;
  }
  return { H, rms: Math.sqrt(sum / n) };
}

/** Bilinear sample with the pixel-centre convention; null outside the image. */
export function sampleBilinear(image: TestImage, x: number, y: number): number | null {
  if (!(x >= 0 && y >= 0 && x <= image.width - 1 && y <= image.height - 1)) return null;
  const u0 = Math.min(image.width - 2, Math.floor(x));
  const v0 = Math.min(image.height - 2, Math.floor(y));
  const fu = x - u0;
  const fv = y - v0;
  const at = (u: number, v: number) => image.data[v * image.width + u];
  return (
    (1 - fu) * (1 - fv) * at(u0, v0) + fu * (1 - fv) * at(u0 + 1, v0) + (1 - fu) * fv * at(u0, v0 + 1) + fu * fv * at(u0 + 1, v0 + 1)
  );
}

/** Mean grey over an n × n grid of board points within ±half of (x, y), mapped through H; null if any falls outside. */
export function patchMean(image: TestImage, H: Mat3, x: number, y: number, half: number, n = 5): number | null {
  let sum = 0;
  for (let a = 0; a < n; a++) {
    for (let b = 0; b < n; b++) {
      const [u, v, w] = applyHomography(H, x + half * ((2 * a) / (n - 1) - 1), y + half * ((2 * b) / (n - 1) - 1));
      if (!(w > 0)) return null;
      const value = sampleBilinear(image, u, v);
      if (value === null) return null;
      sum += value;
    }
  }
  return sum / (n * n);
}

/**
 * O3 measured in the image: mean of the two light squares next to the square diagonally outward from
 * corner 0, minus the mean of that square. Positive when O3 holds. Null when a patch leaves the image.
 */
export function outwardSquareContrast(image: TestImage, corners: ArrayLike<number>, cornersX: number, cornersY: number): number | null {
  const board = { cornersX, cornersY, square: 0.24 };
  const { H } = fitHomography(cornerGrid(board), corners);
  const s = board.square;
  const [x0, y0] = cornerXY(board, 0, 0);
  const outward = patchMean(image, H, x0 - s / 2, y0 - s / 2, s / 4);
  const right = patchMean(image, H, x0 + s / 2, y0 - s / 2, s / 4);
  const below = patchMean(image, H, x0 - s / 2, y0 + s / 2, s / 4);
  if (outward === null || right === null || below === null) return null;
  return Math.min(right, below) - outward;
}

export function toFloat32(values: ArrayLike<number>): Float32Array {
  return Float32Array.from(values as ArrayLike<number>);
}

/** A copy of the bytes behind a typed-array view, for immutability checks. */
export function bytesOf(view: ArrayBufferView): Uint8Array {
  return new Uint8Array(view.buffer, view.byteOffset, view.byteLength).slice();
}

// ---------------------------------------------------------------------------------------------
// Assertions

/** Result layout (§5.2 "Result", P1-DET-05): a Float32Array of 2 · cornersX · cornersY values. */
export function expectLayout(result: Float32Array | null, cornersX: number, cornersY: number, label: string): asserts result is Float32Array {
  expect(result, `${label}: result`).not.toBeNull();
  expect(result, `${label}: result type`).toBeInstanceOf(Float32Array);
  expect((result as Float32Array).length, `${label}: result length`).toBe(2 * cornersX * cornersY);
}

/** O2 and O3 measured on the result itself (P1-DET-07). */
export function expectOrderProperties(result: Float32Array, image: TestImage, cornersX: number, cornersY: number, label: string): void {
  expect(crossAtCorner0(result, cornersX), `${label}: O2 cross product at corner 0`).toBeGreaterThan(0);
  const contrast = outwardSquareContrast(image, result, cornersX, cornersY);
  if (contrast !== null) expect(contrast, `${label}: O3 square outward from corner 0 is darker than its light neighbours`).toBeGreaterThan(0);
}

/** "Accurate" (this plan §1.2): right layout, RMS ≤ 0.25 px and max ≤ 0.6 px against truth, O2 and O3. */
export function expectAccurate(result: Float32Array | null, scene: Render, label: string, request: readonly [number, number] = [9, 6]): void {
  const [cornersX, cornersY] = request;
  expectLayout(result, cornersX, cornersY, label);
  const { rms, max } = cornerErrors(result, scene.truth(cornersX, cornersY));
  expect(rms, `${label}: RMS corner error (px)`).toBeLessThanOrEqual(0.25);
  expect(max, `${label}: maximum corner error (px)`).toBeLessThanOrEqual(0.6);
  expectOrderProperties(result, scene.image, cornersX, cornersY, label);
}

export function expectNullOrAccurate(result: Float32Array | null, scene: Render, label: string, request: readonly [number, number] = [9, 6]): void {
  if (result !== null) expectAccurate(result, scene, label, request);
}

/** "Identity-correct" (OQ-10): every corner within 0.3 × the local corner spacing of its own true corner. */
export function expectIdentityCorrect(result: Float32Array | null, truth: ArrayLike<number>, cornersX: number, cornersY: number, label: string): void {
  expectLayout(result, cornersX, cornersY, label);
  const spacing = localSpacing(truth, cornersX, cornersY);
  const { per } = cornerErrors(result, truth);
  let worst = 0;
  for (let k = 0; k < per.length; k++) worst = Math.max(worst, per[k] / spacing[k]);
  expect(worst, `${label}: worst corner error as a fraction of the local corner spacing`).toBeLessThanOrEqual(0.3);
}

export function expectNullOrIdentityCorrect(result: Float32Array | null, truth: ArrayLike<number>, cornersX: number, cornersY: number, label: string): void {
  if (result !== null) expectIdentityCorrect(result, truth, cornersX, cornersY, label);
}

/**
 * Expects `call` to throw a RangeError. Any other exception, such as a stub's "not implemented",
 * is rethrown unchanged so the failure shows the real cause.
 */
export function expectRangeError(call: () => unknown, label: string): void {
  try {
    call();
  } catch (error) {
    if (error instanceof RangeError) return;
    throw error;
  }
  expect.fail(`${label}: expected a RangeError, but nothing was thrown`);
}

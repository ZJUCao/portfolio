// Pose helpers for the pose tests (docs/test_plan_camera_ar.md §4.1–§4.4): seeded board placements
// within the stated envelopes, exact pinhole projection and pixel noise, the reprojection RMS, an
// independent homography-only pose, the scene and camera conventions of docs/design_camera_ar.md §6,
// column-major 4 × 4 arithmetic and the object-fit: cover mapping. Written from the design,
// independently of src/ar/pose.ts, so the ground truth cannot share a bug with the code under test.

import { STANDARD_BOARD, halfExtent } from "./boardModel";
import { type Mat3, type Vec3, apply3, cross3, jacobiEigenSymmetric, mul3, norm3, normalize3, rodrigues, scale3, transpose3 } from "./linalg";
import { fitHomography } from "./metrics";
import type { Rng } from "./random";
import type { Intrinsics } from "./render";
import { intrinsicsFor, placeBoard } from "./scenes";

export type Triple = [number, number, number];
export type Quad = [number, number, number, number];

/** A pinhole camera and a board pose: board point (X, Y, 0) lies at R · (X, Y, 0) + t in the OpenCV camera frame. */
export interface PoseCase {
  readonly label: string;
  /** Image size in pixels. */
  readonly width: number;
  readonly height: number;
  readonly K: Intrinsics;
  /** Board → camera rotation, row-major 3 × 3. */
  readonly R: Mat3;
  readonly t: Vec3;
}

/** A fixed value or a [min, max) range to sample from. */
export type Range = number | readonly [number, number];
const sample = (rng: Rng, range: Range): number => (typeof range === "number" ? range : rng.range(range[0], range[1]));

export interface PoseEnvelope {
  /** Image size; default 640 × 360. */
  readonly width?: number;
  readonly height?: number;
  /** Horizontal field of view of the true camera; default 60°. */
  readonly hfovDeg?: Range;
  readonly tiltDeg: Range;
  /** Tilt measured from the ray to the board centre (§5.2, the PnP cases) or from the optical axis (OQ-23); default "ray". */
  readonly normalRef?: "ray" | "axis";
  /** Fraction of the image width spanned by the board's squares, measured as in placeBoard. */
  readonly widthFraction: Range;
  /** Fraction of the image, around its centre, in which the board centre may fall; 0 (default) centres it. */
  readonly centreSpread?: number;
  readonly inPlaneDeg?: Range;
  readonly tiltAxisDeg?: Range;
}

/** Samples a board pose from the envelope; placements that cannot reach the width are redrawn (bounded, deterministic). */
export function samplePose(label: string, rng: Rng, envelope: PoseEnvelope): PoseCase {
  const width = envelope.width ?? 640;
  const height = envelope.height ?? 360;
  const spread = envelope.centreSpread ?? 0;
  for (let attempt = 0; attempt < 100; attempt++) {
    const hfovDeg = sample(rng, envelope.hfovDeg ?? 60);
    const tiltDeg = sample(rng, envelope.tiltDeg);
    const tiltAxisDeg = sample(rng, envelope.tiltAxisDeg ?? [0, 360]);
    const inPlaneDeg = sample(rng, envelope.inPlaneDeg ?? [0, 360]);
    const widthFraction = sample(rng, envelope.widthFraction);
    const centre: [number, number] = [
      ((width - 1) / 2) * (1 + spread * (2 * rng.next() - 1)),
      ((height - 1) / 2) * (1 + spread * (2 * rng.next() - 1)),
    ];
    try {
      const m = placeBoard({ width, height, hfovDeg, tiltDeg, tiltAxisDeg, inPlaneDeg, widthFraction, centre, normalRef: envelope.normalRef ?? "ray" });
      return { label, width, height, K: m.K, R: m.R, t: m.t };
    } catch {
      continue; // the board cannot be made that large at this pose
    }
  }
  throw new Error(`samplePose(${label}): no placement in 100 attempts`);
}

/**
 * A board turned by `R` (board → camera) whose centre lies on the ray through `centre` (default: the
 * principal point), at the depth where its squares span `widthFraction` of the image width.
 */
export function placeRotated(
  label: string,
  width: number,
  height: number,
  hfovDeg: number,
  R: Mat3,
  widthFraction: number,
  centre?: readonly [number, number],
): PoseCase {
  const K = intrinsicsFor(width, height, hfovDeg);
  const [uc, vc] = centre ?? [K.cx, K.cy];
  const ray = normalize3([(uc - K.cx) / K.fx, (vc - K.cy) / K.fy, 1]);
  const [hx, hy] = halfExtent(STANDARD_BOARD);
  const outer = [-hx, hx].flatMap((x) => [-hy, hy].map((y) => [x, y]));
  const at = (z: number): Triple => scale3(ray, z / ray[2]);
  const span = (z: number): number => {
    const us = project(K, R, at(z), outer.flat()).filter((_, k) => k % 2 === 0);
    return (Math.max(...us) - Math.min(...us)) / width;
  };
  // Every outer corner must stay in front of the camera
  const reach = Math.max(...outer.map(([x, y]) => -(R[6] * x + R[7] * y)));
  let near = Math.max(0.05, reach + 0.05);
  let far = 5000;
  if (!(span(near) >= widthFraction)) throw new Error(`placeRotated(${label}): the board cannot be made that large`);
  for (let k = 0; k < 100; k++) {
    const mid = Math.sqrt(near * far);
    if (span(mid) > widthFraction) near = mid;
    else far = mid;
  }
  return { label, width, height, K, R: [...R], t: at(near) };
}

/** A random rotation: a Gaussian axis and an angle uniform in [0, π). */
export function randomRotation(rng: Rng): number[] {
  return rodrigues([rng.gaussian(), rng.gaussian(), rng.gaussian()], rng.range(0, Math.PI));
}

// ---------------------------------------------------------------------------------------------
// Projection, noise and errors

/** Camera coordinates R · (X, Y, 0) + t of every board point, as [x0, y0, z0, x1, …]. */
export function cameraPoints(R: ArrayLike<number>, t: ArrayLike<number>, objectXY: ArrayLike<number>): Float64Array {
  const n = objectXY.length / 2;
  const out = new Float64Array(3 * n);
  for (let k = 0; k < n; k++) {
    const X = objectXY[2 * k];
    const Y = objectXY[2 * k + 1];
    out[3 * k] = R[0] * X + R[1] * Y + t[0];
    out[3 * k + 1] = R[3] * X + R[4] * Y + t[1];
    out[3 * k + 2] = R[6] * X + R[7] * Y + t[2];
  }
  return out;
}

/** Pinhole projection u = fx · x / z + cx, v = fy · y / z + cy of board points; the sign of z is not checked. */
export function project(K: Intrinsics, R: ArrayLike<number>, t: ArrayLike<number>, objectXY: ArrayLike<number>): Float64Array {
  const camera = cameraPoints(R, t, objectXY);
  const out = new Float64Array(objectXY.length);
  for (let k = 0; k < objectXY.length / 2; k++) {
    out[2 * k] = K.fx * (camera[3 * k] / camera[3 * k + 2]) + K.cx;
    out[2 * k + 1] = K.fy * (camera[3 * k + 1] / camera[3 * k + 2]) + K.cy;
  }
  return out;
}

/** The pose's exact image of its board points. */
export function imageOf(pose: PoseCase, objectXY: ArrayLike<number>): Float64Array {
  return project(pose.K, pose.R, pose.t, objectXY);
}

/** Adds independent Gaussian noise of standard deviation sigma to every coordinate. */
export function withNoise(points: ArrayLike<number>, sigma: number, rng: Rng): Float64Array {
  return Float64Array.from(points as ArrayLike<number>, (value) => value + sigma * rng.gaussian());
}

/** sqrt((1/N) Σ ‖image_k − K(R · (X_k, Y_k, 0) + t)‖²): the definition of `Pose.rms` (§5.3). */
export function reprojectionRms(
  objectXY: ArrayLike<number>,
  imageXY: ArrayLike<number>,
  K: Intrinsics,
  R: ArrayLike<number>,
  t: ArrayLike<number>,
): number {
  const predicted = project(K, R, t, objectXY);
  const n = objectXY.length / 2;
  let sum = 0;
  for (let k = 0; k < n; k++) sum += (imageXY[2 * k] - predicted[2 * k]) ** 2 + (imageXY[2 * k + 1] - predicted[2 * k + 1]) ** 2;
  return Math.sqrt(sum / n);
}

/** Euclidean distance between two 3-vectors given as array-likes. */
export function distance3(a: ArrayLike<number>, b: ArrayLike<number>): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

/** The rotation nearest to M in the Frobenius norm, M (MᵀM)^(−1/2), for det M > 0. */
export function nearestRotation(M: Mat3): number[] {
  const mtm = mul3(transpose3(M), M);
  const { values, vectors } = jacobiEigenSymmetric([mtm.slice(0, 3), mtm.slice(3, 6), mtm.slice(6, 9)]);
  const inverseRoot = new Array<number>(9).fill(0);
  for (let k = 0; k < 3; k++) {
    const weight = 1 / Math.sqrt(values[k]);
    for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) inverseRoot[3 * r + c] += weight * vectors[k][r] * vectors[k][c];
  }
  return mul3(M, inverseRoot);
}

/**
 * The pose read directly off the normalised-DLT homography, with no refinement: K⁻¹ H = λ [r1 r2 t]
 * with λ from the mean of the two column norms and its sign chosen so that t_z > 0, then R the
 * rotation nearest to [r1 r2 r1 × r2]. The reference for "no larger than the homography-only
 * estimate" (§5.3, P2-PNP-10).
 */
export function homographyPose(objectXY: ArrayLike<number>, imageXY: ArrayLike<number>, K: Intrinsics): { R: number[]; t: Triple } {
  const { H } = fitHomography(objectXY, imageXY);
  const kInverse = [1 / K.fx, 0, -K.cx / K.fx, 0, 1 / K.fy, -K.cy / K.fy, 0, 0, 1];
  const G = mul3(kInverse, H);
  const g1: Triple = [G[0], G[3], G[6]];
  const g2: Triple = [G[1], G[4], G[7]];
  const g3: Triple = [G[2], G[5], G[8]];
  const lambda = (2 / (norm3(g1) + norm3(g2))) * (g3[2] < 0 ? -1 : 1);
  const r1 = scale3(g1, lambda);
  const r2 = scale3(g2, lambda);
  const r3 = cross3(r1, r2);
  return { R: nearestRotation([r1[0], r2[0], r3[0], r1[1], r2[1], r3[1], r1[2], r2[2], r3[2]]), t: scale3(g3, lambda) };
}

// ---------------------------------------------------------------------------------------------
// Scene and camera conventions (§6)

/** B: scene (x, y, z) → board (x, z, −y). */
export const SCENE_TO_BOARD: Mat3 = [1, 0, 0, 0, 0, 1, 0, -1, 0];
/** F = diag(1, −1, −1): OpenCV camera → three.js camera. */
export const OPENCV_TO_THREE: Mat3 = [1, 0, 0, 0, -1, 0, 0, 0, -1];

/** F · (R · B · p + t): a scene point in three.js camera coordinates. */
export function sceneToThreeCamera(R: ArrayLike<number>, t: ArrayLike<number>, p: Vec3): Triple {
  const board = apply3(SCENE_TO_BOARD, p);
  const camera = apply3(Array.from(R), board);
  return apply3(OPENCV_TO_THREE, [camera[0] + t[0], camera[1] + t[1], camera[2] + t[2]]);
}

/** The camera centre in scene coordinates, B⁻¹ · (−Rᵀ · t). */
export function cameraCentreInScene(R: ArrayLike<number>, t: ArrayLike<number>): Triple {
  const centre = apply3(transpose3(Array.from(R)), [-t[0], -t[1], -t[2]]);
  return apply3(transpose3(SCENE_TO_BOARD), centre);
}

/** m · v for a column-major 4 × 4 matrix (entry (r, c) at m[4c + r], the `THREE.Matrix4.elements` order). */
export function applyColumnMajor(m: ArrayLike<number>, v: Quad): Quad {
  const out: Quad = [0, 0, 0, 0];
  for (let r = 0; r < 4; r++) out[r] = m[r] * v[0] + m[4 + r] * v[1] + m[8 + r] * v[2] + m[12 + r] * v[3];
  return out;
}

/** Determinant of a 4 × 4 matrix (the element order does not matter: det Mᵀ = det M). */
export function det4(m: ArrayLike<number>): number {
  const a = Array.from({ length: 4 }, (_, r) => Array.from({ length: 4 }, (__, c) => m[4 * c + r]));
  const minor = (rows: number[], cols: number[]): number =>
    rows.length === 1
      ? a[rows[0]][cols[0]]
      : cols.reduce((sum, col, k) => sum + (k % 2 === 0 ? 1 : -1) * a[rows[0]][col] * minor(rows.slice(1), cols.filter((c) => c !== col)), 0);
  return minor([0, 1, 2, 3], [0, 1, 2, 3]);
}

export interface SizeLike {
  readonly width: number;
  readonly height: number;
}

/**
 * Normalised device coordinates of pixel (u, v) of a w × h image shown in a W × H viewport like CSS
 * `object-fit: cover`, derived from the layout rather than from the §5.3 formulas: s = max(W/w, H/h),
 * viewport x = (W − s · w)/2 + s · (u + 0.5), x_ndc = 2x/W − 1, and y the same way but flipped.
 */
export function coverNdc(u: number, v: number, image: SizeLike, viewport: SizeLike): [number, number] {
  const s = Math.max(viewport.width / image.width, viewport.height / image.height);
  const x = (viewport.width - s * image.width) / 2 + s * (u + 0.5);
  const y = (viewport.height - s * image.height) / 2 + s * (v + 0.5);
  return [(2 * x) / viewport.width - 1, 1 - (2 * y) / viewport.height];
}

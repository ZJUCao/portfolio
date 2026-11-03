// Seeded inputs of the pose tests (docs/test_plan_camera_ar.md §4.2 and §4.3), kept in one place
// like catalog.ts for P1, so every test of a group sees the same trials. Each trial draws from its
// own stream, seedFor(label), and the seeds were fixed before src/ar/pose.ts was implemented
// (this plan §2.8). Ground truth comes from the helpers, never from the module under test.

import { boardCorners } from "@/ar/board";
import { rodrigues } from "./linalg";
import { type PoseCase, type PoseEnvelope, type Range, type Triple, imageOf, placeRotated, project, samplePose, withNoise } from "./poses";
import { createRng, seedFor } from "./random";
import type { Intrinsics } from "./render";
import { intrinsicsFor } from "./scenes";

/** Correspondences between board points and pixels, with the camera and pose that produced them. */
export interface Correspondences {
  readonly label: string;
  readonly objectXY: Float64Array;
  readonly imageXY: Float64Array;
  /** The true camera and pose; imageXY is their exact projection plus `sigma` noise. */
  readonly truth: PoseCase;
  /** Noise added to every image coordinate, in pixels. */
  readonly sigma: number;
}

/** Pixel noise of the noisy clauses (§5.3, OQ-18, OQ-24). */
export const SIGMA = 0.3;

const DEG = Math.PI / 180;

function exact(label: string, truth: PoseCase, objectXY: Float64Array = boardCorners()): Correspondences {
  return { label, objectXY, imageXY: imageOf(truth, objectXY), truth, sigma: 0 };
}

/** A pose drawn from the envelope, its exact image, and optionally σ noise from the same stream. */
function drawn(label: string, envelope: PoseEnvelope, sigma = 0, objectXY: Float64Array = boardCorners()): Correspondences {
  const rng = createRng(seedFor(label));
  const truth = samplePose(label, rng, envelope);
  const image = imageOf(truth, objectXY);
  return { label, objectXY, imageXY: sigma > 0 ? withNoise(image, sigma, rng) : image, truth, sigma };
}

// ---------------------------------------------------------------------------------------------
// solvePlanarPnP (§4.2)

/** The OQ-19 envelope of the exact cases: board ≥ 1/3 of the width, tilt 0–60° from the ray, any in-plane rotation. */
function exactEnvelope(k: number, tiltDeg: Range = [0, 60]): PoseEnvelope {
  return { hfovDeg: [40, 100], tiltDeg, widthFraction: [1 / 3, 0.6], centreSpread: k % 2 === 0 ? 0 : 0.5 };
}

/** P2-PNP-03: 30 exact projections; trials 0–1 are fronto-parallel and 2–3 at 60°, even trials centred, odd ones off-centre. */
export function pnpExactSet(): Correspondences[] {
  return Array.from({ length: 30 }, (_, k) => drawn(`P2-PNP-03#${k}`, exactEnvelope(k, k < 2 ? 0 : k < 4 ? 60 : [0, 60])));
}

/** P2-PNP-04: N = 4 (corners 0, 8, 45 and 53) and N = 10 random board-plane points, 5 poses each, exact. */
export function pnpSmallSets(): Correspondences[] {
  const corners = boardCorners();
  const quad = Float64Array.from([0, 8, 45, 53].flatMap((k) => [corners[2 * k], corners[2 * k + 1]]));
  const sets: Correspondences[] = [];
  for (let k = 0; k < 5; k++) sets.push(drawn(`P2-PNP-04#corners#${k}`, exactEnvelope(k), 0, quad));
  for (let k = 0; k < 5; k++) {
    const label = `P2-PNP-04#random#${k}`;
    const rng = createRng(seedFor(`${label}#points`));
    const points = Float64Array.from({ length: 20 }, (_, m) => (m % 2 === 0 ? rng.range(-1.2, 1.2) : rng.range(-0.84, 0.84)));
    sets.push(drawn(label, exactEnvelope(k), 0, points));
  }
  return sets;
}

/** The general camera of P2-PNP-05. */
export const GENERAL_K: Intrinsics = Object.freeze({ fx: 500, fy: 520, cx: 300, cy: 200 });

/** P2-PNP-05: 5 poses from the exact envelope, projected with fx 500, fy 520, cx 300, cy 200. */
export function pnpGeneralK(): Correspondences[] {
  return Array.from({ length: 5 }, (_, k) => {
    const label = `P2-PNP-05#${k}`;
    const placed = samplePose(label, createRng(seedFor(label)), { ...exactEnvelope(k), hfovDeg: 60 });
    return exact(label, { ...placed, K: GENERAL_K });
  });
}

export interface NoisyTrial extends Correspondences {
  /** The rotation bound of OQ-18 for this trial's tilt band, in degrees. */
  readonly rotationBoundDeg: number;
}

/**
 * P2-PNP-09…11: the 40 noisy trials of OQ-18 in the setting of this plan §10.1: 640×360, true K
 * (hfov 60°), board centred with its squares spanning exactly 1/3 of the width, random tilt axis
 * and in-plane rotation, σ 0.3 px on every coordinate of the 54 corners. 20 trials have tilt
 * 35–60° (bound 0.5°) and 20 tilt 0–35° (bound 3°).
 */
export function pnpNoisyTrials(): NoisyTrial[] {
  const band = (name: string, tiltDeg: readonly [number, number], rotationBoundDeg: number): NoisyTrial[] =>
    Array.from({ length: 20 }, (_, k) => ({
      ...drawn(`P2-PNP-09#${name}#${k}`, { tiltDeg, widthFraction: 1 / 3 }, SIGMA),
      rotationBoundDeg,
    }));
  return [...band("35-60", [35, 60], 0.5), ...band("0-35", [0, 35], 3)];
}

/** P2-PNP-08: noisy minimal and small sets, so that `rms` has residual degrees of freedom. */
export function pnpNoisySmallSets(): Correspondences[] {
  return pnpSmallSets().map((set) => {
    const label = `P2-PNP-08#${set.label}`;
    return { ...set, label, imageXY: withNoise(set.imageXY, SIGMA, createRng(seedFor(label))), sigma: SIGMA };
  });
}

/** P2-PNP-02, P2-PNP-14 and P2-PNP-15: one exact pose from the envelope. */
export function pnpSingle(label: string): Correspondences {
  return drawn(label, exactEnvelope(0, [10, 50]));
}

/** A degenerate PnP input (OQ-20) or a board-behind-the-camera input (OQ-21). */
export interface DegenerateInput {
  readonly label: string;
  readonly objectXY: Float64Array;
  readonly imageXY: Float64Array;
  readonly K: Intrinsics;
}

/** P2-PNP-12: the degenerate sets of OQ-20, built around one valid pose tilted 30°. */
export function pnpDegenerateSets(): DegenerateInput[] {
  const truth = samplePose("P2-PNP-12", createRng(seedFor("P2-PNP-12")), { tiltDeg: 30, widthFraction: 0.5 });
  const corners = boardCorners();
  const pick = (indices: readonly number[]) => Float64Array.from(indices.flatMap((k) => [corners[2 * k], corners[2 * k + 1]]));
  const withImage = (label: string, objectXY: Float64Array): DegenerateInput => ({ label, objectXY, imageXY: imageOf(truth, objectXY), K: truth.K });
  const image = imageOf(truth, corners);
  const onLine = image.map((value, m) => (m % 2 === 0 ? value : 180 + 0.25 * (image[m - 1] - 320)));
  return [
    withImage("all object points collinear (row j = 0)", pick([0, 1, 2, 3, 4, 5, 6, 7, 8])),
    { label: "all image points collinear", objectXY: corners, imageXY: onLine, K: truth.K },
    { label: "all image points equal", objectXY: corners, imageXY: Float64Array.from({ length: corners.length }, (_, m) => (m % 2 === 0 ? 300 : 200)), K: truth.K },
    withImage("4 copies of 2 points", pick([0, 53, 0, 53, 0, 53, 0, 53])),
    withImage("4 points with 3 collinear", pick([0, 4, 8, 53])),
  ];
}

export interface StraddlingBoard extends DegenerateInput {
  /** Camera z of every corner under the generating pose. */
  readonly depths: Float64Array;
  readonly R: number[];
  readonly t: [number, number, number];
}

/**
 * P2-PNP-13 (OQ-21): a rigid board whose plane crosses the camera's z = 0 plane between two rows or
 * columns of corners, so some corners have z > 0 and others z < 0 with |z| ≥ 0.12 · sin 70°. Every
 * corner is projected with the pinhole formula. The homography of 54 corners in general position is
 * unique, so the only poses that reproduce these pixels exactly are the generating pose and its
 * negation (R columns 1–2 and t negated), and both leave some corners behind the camera.
 */
export function straddlingBoards(): StraddlingBoard[] {
  const K = intrinsicsFor(640, 360, 60);
  const corners = boardCorners();
  const s = Math.sin(70 * DEG);
  const build = (label: string, axis: [number, number, number], angleDeg: number, t: [number, number, number]): StraddlingBoard => {
    const R = rodrigues(axis, angleDeg * DEG);
    const depths = Float64Array.from({ length: corners.length / 2 }, (_, k) => R[6] * corners[2 * k] + R[7] * corners[2 * k + 1] + t[2]);
    return { label, objectXY: corners, imageXY: project(K, R, t, corners), K, depths, R, t };
  };
  return [
    // z = sin 70° · Y + 0.24 sin 70°: rows j = 0, 1 (Y ≤ −0.36) behind, the board origin in front
    build("rows 0–1 behind, origin in front", [1, 0, 0], 70, [0.3, 1, 0.24 * s]),
    // z = −sin 70° · Y + 0.48 sin 70°: only row j = 5 (Y = 0.6) behind, the board origin in front
    build("row 5 behind, origin in front", [1, 0, 0], -70, [0.3, -1, 0.48 * s]),
    // z = −sin 70° · X − 0.36 sin 70°: columns i ≥ 3 (X ≥ −0.24) behind, the board origin behind
    build("columns 3–8 behind, origin behind", [0, 1, 0], 70, [1, 0.2, -0.36 * s]),
  ];
}

export interface ShiftedBoard extends DegenerateInput {
  /** Camera z of every corner under the generating pose. */
  readonly depths: Float64Array;
  readonly R: number[];
  /** The origin of objectXY in camera coordinates, behind the camera (t_z < 0). */
  readonly t: Triple;
  /** The same corners in their own centred coordinates, boardCorners(), and the translation that maps them to imageXY with R. */
  readonly centred: { readonly objectXY: Float64Array; readonly t: Triple };
}

/**
 * P2-PNP-16 (OQ-69): board corners whose coordinates have their origin far away, seen so that every
 * corner is well in front of the camera (z ≥ 1) while that origin is behind it (t_z < 0). The view of
 * the board itself is ordinary: the corners are shifted along the board direction in which camera
 * depth grows fastest, and with their own centred coordinates the same pixels give a pose whose
 * origin is in front (`centred`).
 */
export function originBehindBoards(): ShiftedBoard[] {
  const K = intrinsicsFor(640, 360, 60);
  const corners = boardCorners();
  const build = (label: string, axis: Triple, angleDeg: number, centre: Triple, reach: number): ShiftedBoard => {
    const R = rodrigues(axis, angleDeg * DEG);
    const slope = Math.hypot(R[6], R[7]);
    const shift = [(reach * R[6]) / slope, (reach * R[7]) / slope];
    const objectXY = corners.map((value, m) => value + shift[m % 2]);
    // R · (P + shift) + t = R · P + centre, so the board centre lands at `centre`
    const t: Triple = [0, 1, 2].map((r) => centre[r] - (R[3 * r] * shift[0] + R[3 * r + 1] * shift[1])) as Triple;
    const depths = Float64Array.from({ length: corners.length / 2 }, (_, k) => R[6] * objectXY[2 * k] + R[7] * objectXY[2 * k + 1] + t[2]);
    return { label, objectXY, imageXY: project(K, R, t, objectXY), K, depths, R, t, centred: { objectXY: corners, t: centre } };
  };
  return [
    build("shifted 6 along X, tilt 30° about the camera y axis", [0, 1, 0], -30, [0, 0, 2], 6),
    build("shifted 8 along Y, tilt 40° about the camera x axis", [1, 0, 0], 40, [0, 0, 2.5], 8),
    build("shifted 7 along a diagonal, tilt 50°, off-centre", [1, 1, 0], 50, [0.4, -0.2, 3], 7),
  ];
}

// ---------------------------------------------------------------------------------------------
// estimateFocal (§4.3); tilt is measured from the optical axis (OQ-23)

/** One focal-length input: correspondences plus the image size passed to estimateFocal. */
export interface FocalInput extends Correspondences {
  readonly width: number;
  readonly height: number;
  /** Tilt between the board normal and the optical axis, in degrees (OQ-23). */
  readonly tiltDeg: number;
}

const focal = (set: Correspondences, tiltDeg: number): FocalInput => ({ ...set, width: set.truth.width, height: set.truth.height, tiltDeg });

/** P2-FOC-02: tilt 30°, 45°, 60° about the board X, Y and 45° diagonal axes, hfov 40°, 60°, 90°, 100°, board centred spanning half the width, exact. */
export function focalExactGrid(): FocalInput[] {
  const axes: [string, [number, number, number]][] = [
    ["X", [1, 0, 0]],
    ["Y", [0, 1, 0]],
    ["diagonal", [1, 1, 0]],
  ];
  const out: FocalInput[] = [];
  for (const tiltDeg of [30, 45, 60]) {
    for (const [name, axis] of axes) {
      for (const hfovDeg of [40, 60, 90, 100]) {
        const label = `P2-FOC-02#tilt ${tiltDeg}° about ${name}, hfov ${hfovDeg}°`;
        out.push(focal(exact(label, placeRotated(label, 640, 360, hfovDeg, rodrigues(axis, tiltDeg * DEG), 0.5)), tiltDeg));
      }
    }
  }
  return out;
}

/**
 * Focal trials at a fixed optical-axis tilt about a random axis, with random in-plane rotation, on a
 * 640×360 image, by default with hfov drawn from 40–100° (the clamp range of D1). Exact trials: board
 * squares spanning 40–90 % of the width, centre within ±15 % of the image size around the principal
 * point. Noisy trials (the OQ-24 envelope at its limits): board centred spanning exactly 40 % of the
 * width, σ 0.3 px.
 */
export function focalTrials(id: string, tiltDeg: number, noisy: boolean, count: number, hfovDeg: Range = [40, 100]): FocalInput[] {
  return Array.from({ length: count }, (_, k) => {
    const label = `${id}#tilt ${tiltDeg}°#${noisy ? "noisy" : "exact"}#${k}`;
    const envelope: PoseEnvelope = noisy
      ? { hfovDeg, tiltDeg, normalRef: "axis", widthFraction: 0.4 }
      : { hfovDeg, tiltDeg, normalRef: "axis", widthFraction: [0.4, 0.9], centreSpread: 0.3 };
    return focal(drawn(label, envelope, noisy ? SIGMA : 0), tiltDeg);
  });
}

/** P2-FOC-03: tilt 45°, σ 0.3 px, board at 40 % of the width, hfov 60° as in this plan §10.1, 20 trials. */
export const focalNoisy45 = (): FocalInput[] => focalTrials("P2-FOC-03", 45, true, 20, 60);

/** P2-FOC-04: tilt 0°, 5° and 9.5°, 20 exact and 20 noisy trials each. */
export const focalNearFrontal = (): FocalInput[] => [0, 5, 9.5].flatMap((tilt) => [...focalTrials("P2-FOC-04", tilt, false, 20), ...focalTrials("P2-FOC-04", tilt, true, 20)]);

/** P2-FOC-05: tilt 10°, 15°, 20° and 24°, 5 exact and 5 noisy trials each. */
export const focalTransition = (): FocalInput[] => [10, 15, 20, 24].flatMap((tilt) => [...focalTrials("P2-FOC-05", tilt, false, 5), ...focalTrials("P2-FOC-05", tilt, true, 5)]);

/** P2-FOC-06: tilt 25°, 30°, 45° and 60°, 20 exact and 20 noisy trials each. */
export const focalTilted = (): FocalInput[] => [25, 30, 45, 60].flatMap((tilt) => [...focalTrials("P2-FOC-06", tilt, false, 20), ...focalTrials("P2-FOC-06", tilt, true, 20)]);

/**
 * P2-FOC-07: R = I (board parallel to the image plane, optical-axis tilt 0°) with the board centre
 * on a ray 25° off the optical axis towards each image corner, board spanning 20 % of the width, exact.
 */
export function focalOffCentreFrontal(): FocalInput[] {
  const K = intrinsicsFor(640, 360, 60);
  const reach = K.fx * Math.tan(25 * DEG);
  const diagonal = Math.hypot(K.cx, K.cy);
  return [
    [-1, -1],
    [1, -1],
    [-1, 1],
    [1, 1],
  ].map(([sx, sy]) => {
    const label = `P2-FOC-07#corner (${sx}, ${sy})`;
    const centre: [number, number] = [K.cx + (sx * reach * K.cx) / diagonal, K.cy + (sy * reach * K.cy) / diagonal];
    return focal(exact(label, placeRotated(label, 640, 360, 60, [1, 0, 0, 0, 1, 0, 0, 0, 1], 0.2, centre)), 0);
  });
}

/** P2-FOC-08 (OQ-25): collinear and duplicated point sets with consistent image points of a 45° view. */
export function focalDegenerateSets(): FocalInput[] {
  const truth = placeRotated("P2-FOC-08", 640, 360, 60, rodrigues([1, 1, 0], 45 * DEG), 0.5);
  const corners = boardCorners();
  const pick = (indices: readonly number[]) => Float64Array.from(indices.flatMap((k) => [corners[2 * k], corners[2 * k + 1]]));
  const line = Float64Array.from({ length: 20 }, (_, m) => (m % 2 === 0 ? -0.9 + 0.2 * (m / 2) : 0.5 * (-0.9 + 0.2 * ((m - 1) / 2))));
  const sets: [string, Float64Array][] = [
    ["collinear: row j = 0", pick([0, 1, 2, 3, 4, 5, 6, 7, 8])],
    ["collinear: 10 points on Y = X / 2", line],
    ["duplicates: 4 copies of 2 points", pick([0, 53, 0, 53, 0, 53, 0, 53])],
    ["duplicates: one point 5 times", pick([20, 20, 20, 20, 20])],
    ["duplicates: 3 distinct points and a copy", pick([0, 8, 53, 8])],
  ];
  return sets.map(([name, objectXY]) => focal(exact(`P2-FOC-08#${name}`, truth, objectXY), 45));
}

/** P2-FOC-10: one exact and one noisy 45° input, both inside the OQ-24 envelope. */
export const focalInvarianceInputs = (): FocalInput[] => [...focalTrials("P2-FOC-10", 45, false, 1), ...focalTrials("P2-FOC-10", 45, true, 1)];

/** P2-FOC-09: 50 sets of 4–60 random board points paired with random pixels of a 640×360 image. */
export function focalRandomSets(): { label: string; objectXY: Float64Array; imageXY: Float64Array; width: number; height: number }[] {
  return Array.from({ length: 50 }, (_, k) => {
    const label = `P2-FOC-09#random#${k}`;
    const rng = createRng(seedFor(label));
    const n = 4 + rng.int(57);
    const objectXY = Float64Array.from({ length: 2 * n }, (_, m) => (m % 2 === 0 ? rng.range(-1.2, 1.2) : rng.range(-0.84, 0.84)));
    const imageXY = Float64Array.from({ length: 2 * n }, (_, m) => (m % 2 === 0 ? rng.range(-0.5, 639.5) : rng.range(-0.5, 359.5)));
    return { label, objectXY, imageXY, width: 640, height: 360 };
  });
}

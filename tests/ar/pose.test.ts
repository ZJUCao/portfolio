// P2a contract tests for src/ar/pose.ts: intrinsicsFromFov, solvePlanarPnP, estimateFocal,
// viewMatrix, projectionMatrix and cameraPosition. docs/design_camera_ar.md §5.3, the conventions
// of §6 and the resolutions OQ-18–OQ-26 of §14; test plan §4.1–§4.4. The seeded inputs live in
// helpers/poseCatalog.ts and the reference maths in helpers/poses.ts.

import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { boardCorners } from "@/ar/board";
import { type Intrinsics, type Pose, cameraPosition, estimateFocal, intrinsicsFromFov, projectionMatrix, solvePlanarPnP, viewMatrix } from "@/ar/pose";
import { type Mat3, det3, mul3, norm3, rodrigues, rotationAngle, transpose3 } from "./helpers/linalg";
import { bytesOf, expectRangeError } from "./helpers/metrics";
import {
  type Correspondences,
  type FocalInput,
  GENERAL_K,
  focalDegenerateSets,
  focalExactGrid,
  focalInvarianceInputs,
  focalNearFrontal,
  focalNoisy45,
  focalOffCentreFrontal,
  focalRandomSets,
  focalTilted,
  focalTransition,
  originBehindBoards,
  pnpDegenerateSets,
  pnpExactSet,
  pnpGeneralK,
  pnpNoisySmallSets,
  pnpNoisyTrials,
  pnpSingle,
  pnpSmallSets,
  straddlingBoards,
} from "./helpers/poseCatalog";
import {
  type Quad,
  type SizeLike,
  type Triple,
  applyColumnMajor,
  cameraCentreInScene,
  cameraPoints,
  coverNdc,
  det4,
  distance3,
  homographyPose,
  project,
  randomRotation,
  reprojectionRms,
  samplePose,
  sceneToThreeCamera,
} from "./helpers/poses";
import { type Rng, createRng, seedFor } from "./helpers/random";
import { intrinsicsFor } from "./helpers/scenes";

const DEG = Math.PI / 180;
const DEFAULT_K = intrinsicsFor(640, 360, 60);
const IMAGE: SizeLike = { width: 640, height: 360 };
const VIEWPORTS: readonly SizeLike[] = [
  { width: 1280, height: 720 },
  { width: 390, height: 844 },
  { width: 1920, height: 800 },
  { width: 320, height: 180 },
];

function expectRelative(actual: number, expected: number, tolerance: number, label: string): void {
  expect(Math.abs(actual - expected), `${label}: ${actual} vs ${expected}`).toBeLessThanOrEqual(tolerance * Math.abs(expected));
}

/** Component-wise closeness within `tolerance` × max(1, largest expected magnitude). */
function expectVector(actual: ArrayLike<number>, expected: ArrayLike<number>, tolerance: number, label: string): void {
  expect(actual.length, `${label}: length`).toBe(expected.length);
  let scale = 1;
  let worst = 0;
  for (let k = 0; k < expected.length; k++) {
    scale = Math.max(scale, Math.abs(expected[k]));
    worst = Math.max(worst, Math.abs(actual[k] - expected[k]));
  }
  expect(worst, `${label}: [${Array.from(actual).join(", ")}] vs [${Array.from(expected).join(", ")}]`).toBeLessThanOrEqual(tolerance * scale);
}

// ---------------------------------------------------------------------------------------------
// Poses

/** P2-PNP-07: the §5.3 postconditions, applied to every pose returned in these tests. */
function expectPose(pose: Pose | null, label: string): asserts pose is Pose {
  expect(pose, `${label}: pose`).not.toBeNull();
  const { R, t, rms } = pose as Pose;
  expect(R, `${label}: R type`).toBeInstanceOf(Float64Array);
  expect(R.length, `${label}: R length`).toBe(9);
  expect(t, `${label}: t type`).toBeInstanceOf(Float64Array);
  expect(t.length, `${label}: t length`).toBe(3);
  const rows = Array.from(R);
  const gram = mul3(transpose3(rows), rows);
  const orthogonality = Math.max(...gram.map((value, k) => Math.abs(value - (k % 4 === 0 ? 1 : 0))));
  expect(orthogonality, `${label}: max |RᵀR − I|`).toBeLessThanOrEqual(1e-9);
  expect(Math.abs(det3(rows) - 1), `${label}: |det R − 1|`).toBeLessThanOrEqual(1e-9);
  expect(t[2], `${label}: t_z`).toBeGreaterThan(0);
  expect(Number.isFinite(rms) && rms >= 0, `${label}: rms ${rms} is finite and ≥ 0`).toBe(true);
}

function solve(set: Correspondences, objectXY: ArrayLike<number> = set.objectXY, imageXY: ArrayLike<number> = set.imageXY): Pose {
  const pose = solvePlanarPnP(objectXY, imageXY, set.truth.K);
  expectPose(pose, set.label);
  return pose;
}

const rotationError = (R: ArrayLike<number>, truth: Mat3): number => rotationAngle(Array.from(R), truth);

/** The exact-data accuracy of §5.3 (OQ-19): rotation within 1e−6 rad, R compared row-major, and ‖t − t_true‖ ≤ 1e−6 · ‖t_true‖. */
function expectExact(pose: Pose, truth: { R: Mat3; t: readonly number[] }, label: string): void {
  expect(rotationError(pose.R, truth.R), `${label}: rotation error (rad)`).toBeLessThanOrEqual(1e-6);
  expect(distance3(pose.t, truth.t), `${label}: ‖t − t_true‖`).toBeLessThanOrEqual(1e-6 * Math.hypot(truth.t[0], truth.t[1], truth.t[2]));
}

/** The array cases of P2-PNP-01, shared by P2-FOC-01. */
function invalidArrays(): [string, Float64Array, Float64Array][] {
  const object = boardCorners();
  const image = project(DEFAULT_K, rodrigues([1, 1, 0], 30 * DEG), [0, 0, 8], object);
  const replaced = (values: Float64Array, index: number, value: number): Float64Array => {
    const copy = Float64Array.from(values);
    copy[index] = value;
    return copy;
  };
  return [
    ["lengths 108 and 106", object, image.slice(0, 106)],
    ["lengths 106 and 108", object.slice(0, 106), image],
    ["length 7", object.slice(0, 7), image.slice(0, 7)],
    ["N = 3", object.slice(0, 6), image.slice(0, 6)],
    ["empty arrays", new Float64Array(0), new Float64Array(0)],
    ...[NaN, Infinity, -Infinity].flatMap((value): [string, Float64Array, Float64Array][] => [
      [`${value} in objectXY`, replaced(object, 17, value), image],
      [`${value} in imageXY`, object, replaced(image, 40, value)],
    ]),
  ];
}

describe("intrinsicsFromFov (§5.3)", () => {
  it("P2-INT-01 640×360 at 60° gives fx = fy = 554.2562584, cx 319.5 and cy 179.5", () => {
    const K = intrinsicsFromFov(640, 360, 60);
    expectRelative(K.fx, 554.2562584, 1e-9, "fx");
    expectRelative(K.fy, 554.2562584, 1e-9, "fy");
    expectRelative(K.cx, 319.5, 1e-9, "cx");
    expectRelative(K.cy, 179.5, 1e-9, "cy");
  });

  it("P2-INT-02 fx = fy = (width / 2) / tan(hfov / 2), cx = (width − 1) / 2, cy = (height − 1) / 2 for other sizes", () => {
    const cases: [number, number, number, number, number, number][] = [
      // width, height, hfov, fx, cx, cy
      [1280, 720, 90, 640, 639.5, 359.5],
      [360, 640, 60, 311.7691454, 179.5, 319.5],
      [1, 1, 60, 0.5 / Math.tan(30 * DEG), 0, 0],
    ];
    for (const [width, height, hfov, fx, cx, cy] of cases) {
      const K = intrinsicsFromFov(width, height, hfov);
      const label = `${width}×${height} at ${hfov}°`;
      expectRelative(K.fx, fx, 1e-9, `${label} fx`);
      expectRelative(K.fy, fx, 1e-9, `${label} fy`);
      expectRelative(K.fx, width / 2 / Math.tan((hfov / 2) * DEG), 1e-12, `${label} fx from the formula`);
      expect(Math.abs(K.cx - cx), `${label} cx`).toBeLessThanOrEqual(1e-12 * Math.max(1, cx));
      expect(Math.abs(K.cy - cy), `${label} cy`).toBeLessThanOrEqual(1e-12 * Math.max(1, cy));
    }
  });

  it("P2-INT-03 a size ≤ 0 or hfovDeg outside (0, 180) throws RangeError", () => {
    for (const [width, height] of [
      [0, 360],
      [-1, 360],
      [640, 0],
      [640, -1],
    ]) {
      expectRangeError(() => intrinsicsFromFov(width, height, 60), `size ${width}×${height}`);
    }
    for (const hfov of [0, 180, -1, 181, NaN, Infinity, -Infinity]) expectRangeError(() => intrinsicsFromFov(640, 360, hfov), `hfovDeg ${hfov}`);
  });

  it("P2-INT-04 non-finite sizes throw RangeError; non-integer sizes are accepted (OQ-22)", () => {
    for (const value of [NaN, Infinity, -Infinity]) {
      expectRangeError(() => intrinsicsFromFov(value, 360, 60), `width ${value}`);
      expectRangeError(() => intrinsicsFromFov(640, value, 60), `height ${value}`);
    }
    const K = intrinsicsFromFov(640.5, 360, 60);
    expectRelative(K.fx, 320.25 / Math.tan(30 * DEG), 1e-12, "640.5: fx");
    expectRelative(K.fy, 320.25 / Math.tan(30 * DEG), 1e-12, "640.5: fy");
    expectRelative(K.cx, 319.75, 1e-12, "640.5: cx");
    expectRelative(K.cy, 179.5, 1e-12, "640.5: cy");
    expectRelative(intrinsicsFromFov(640, 360.5, 60).cy, 179.75, 1e-12, "height 360.5: cy");
  });
});

describe("solvePlanarPnP (§5.3)", () => {
  it("P2-PNP-01 mismatched, odd, short or non-finite arrays and invalid intrinsics throw RangeError", () => {
    for (const [label, object, image] of invalidArrays()) expectRangeError(() => solvePlanarPnP(object, image, DEFAULT_K), label);
    const object = boardCorners();
    const image = project(DEFAULT_K, rodrigues([1, 1, 0], 30 * DEG), [0, 0, 8], object);
    const badK: [string, Intrinsics][] = [
      ["fx 0", { ...DEFAULT_K, fx: 0 }],
      ["fy −1", { ...DEFAULT_K, fy: -1 }],
      ["fx NaN", { ...DEFAULT_K, fx: NaN }],
      ["cx Infinity", { ...DEFAULT_K, cx: Infinity }],
    ];
    for (const [label, K] of badK) expectRangeError(() => solvePlanarPnP(object, image, K), label);
  });

  it("P2-PNP-02 number[], Float64Array and Float32Array inputs are accepted; number[] and Float64Array give identical poses", () => {
    const set = pnpSingle("P2-PNP-02");
    const fromArray = solvePlanarPnP(Array.from(set.objectXY), Array.from(set.imageXY), set.truth.K);
    const fromFloat64 = solvePlanarPnP(Float64Array.from(set.objectXY), Float64Array.from(set.imageXY), set.truth.K);
    const fromFloat32 = solvePlanarPnP(Float32Array.from(set.objectXY), Float32Array.from(set.imageXY), set.truth.K);
    expectPose(fromArray, "number[]");
    expectPose(fromFloat64, "Float64Array");
    expectPose(fromFloat32, "Float32Array");
    expect(bytesOf(fromArray.R), "R").toEqual(bytesOf(fromFloat64.R));
    expect(bytesOf(fromArray.t), "t").toEqual(bytesOf(fromFloat64.t));
    expect(Object.is(fromArray.rms, fromFloat64.rms), "rms").toBe(true);
  });

  it("P2-PNP-03 exact projections of 30 seeded poses: rotation within 1e−6 rad, translation within 1e−6 · ‖t‖ (OQ-19)", () => {
    for (const set of pnpExactSet()) expectExact(solve(set), set.truth, set.label);
  });

  it("P2-PNP-04 exact minimal (corners 0, 8, 45, 53) and 10-point sets meet the same bounds", () => {
    for (const set of pnpSmallSets()) expectExact(solve(set), set.truth, set.label);
  });

  it("P2-PNP-05 exact data from a general K (fx 500, fy 520, cx 300, cy 200) meets the same bounds", () => {
    for (const set of pnpGeneralK()) {
      expect(set.truth.K).toEqual(GENERAL_K);
      expectExact(solve(set), set.truth, set.label);
    }
  });

  it("P2-PNP-07 every returned pose has R orthonormal with det +1, t_z > 0 and a finite rms ≥ 0", () => {
    for (const set of [...pnpExactSet(), ...pnpSmallSets(), ...pnpGeneralK(), ...pnpNoisyTrials(), ...pnpNoisySmallSets()]) {
      expectPose(solvePlanarPnP(set.objectXY, set.imageXY, set.truth.K), set.label);
    }
  });

  it("P2-PNP-08 rms is the root mean square, over the N points, of the pixel distance to K(R [X Y 0]ᵀ + t)", () => {
    for (const set of [...pnpNoisyTrials(), ...pnpNoisySmallSets()]) {
      const pose = solve(set);
      const expected = reprojectionRms(set.objectXY, set.imageXY, set.truth.K, pose.R, pose.t);
      expect(Math.abs(pose.rms - expected), `${set.label}: rms ${pose.rms} vs ${expected}`).toBeLessThanOrEqual(1e-9 * expected);
    }
  });

  it("P2-PNP-09 σ 0.3 px: rotation ≤ 0.5° for tilt 35–60° and ≤ 3° for tilt 0–35°, translation ≤ 1 % (OQ-18)", () => {
    for (const trial of pnpNoisyTrials()) {
      const pose = solve(trial);
      expect(rotationError(pose.R, trial.truth.R) / DEG, `${trial.label}: rotation error (°)`).toBeLessThanOrEqual(trial.rotationBoundDeg);
      expect(distance3(pose.t, trial.truth.t) / norm3(trial.truth.t), `${trial.label}: translation error / ‖t_true‖`).toBeLessThanOrEqual(0.01);
    }
  });

  it("P2-PNP-10 the rms is no larger than that of the true pose or of the homography-only pose", () => {
    for (const trial of pnpNoisyTrials()) {
      const pose = solve(trial);
      const { objectXY, imageXY, truth } = trial;
      const atTruth = reprojectionRms(objectXY, imageXY, truth.K, truth.R, truth.t);
      const homography = homographyPose(objectXY, imageXY, truth.K);
      const atHomography = reprojectionRms(objectXY, imageXY, truth.K, homography.R, homography.t);
      expect(pose.rms, `${trial.label}: rms vs the true pose's ${atTruth}`).toBeLessThanOrEqual(atTruth + 1e-9);
      expect(pose.rms, `${trial.label}: rms vs the homography-only pose's ${atHomography}`).toBeLessThanOrEqual(atHomography + 1e-9);
    }
  });

  it("P2-PNP-11 the pose is a local minimum: ±1e−4 rad about each axis or ±1e−4 · ‖t‖ per component never lowers the rms", () => {
    for (const trial of pnpNoisyTrials()) {
      const pose = solve(trial);
      const { objectXY, imageXY, truth } = trial;
      const R = Array.from(pose.R);
      const t = Array.from(pose.t);
      const base = reprojectionRms(objectXY, imageXY, truth.K, R, t);
      const step = 1e-4 * norm3(t as Triple);
      for (let axis = 0; axis < 3; axis++) {
        for (const sign of [-1, 1]) {
          const direction: Triple = [0, 0, 0];
          direction[axis] = 1;
          // Rotation about the camera axis through the board origin, R ← Rot(±1e−4) · R
          const turned = reprojectionRms(objectXY, imageXY, truth.K, mul3(rodrigues(direction, sign * 1e-4), R), t);
          expect(turned, `${trial.label}: rotation ${sign * 1e-4} rad about axis ${axis}`).toBeGreaterThanOrEqual(base * (1 - 1e-9));
          const moved = [...t];
          moved[axis] += sign * step;
          const shifted = reprojectionRms(objectXY, imageXY, truth.K, R, moved);
          expect(shifted, `${trial.label}: t[${axis}] ${sign > 0 ? "+" : "−"} 1e−4 · ‖t‖`).toBeGreaterThanOrEqual(base * (1 - 1e-9));
        }
      }
    }
  });

  it("P2-PNP-12 degenerate sets give null: collinear object or image points, coincident image points, repeated points, 3 of 4 collinear (OQ-20)", () => {
    for (const set of pnpDegenerateSets()) expect(solvePlanarPnP(set.objectXY, set.imageXY, set.K), set.label).toBeNull();
  });

  it("P2-PNP-13 correspondences of a board straddling the camera's z = 0 plane give null (OQ-21)", () => {
    for (const board of straddlingBoards()) {
      const depths = Array.from(board.depths);
      // The construction: corners on both sides of z = 0, none close to it, so every pixel is finite
      expect(depths.some((z) => z > 0) && depths.some((z) => z < 0), `${board.label}: corners on both sides`).toBe(true);
      expect(Math.min(...depths.map(Math.abs)), `${board.label}: min |z|`).toBeGreaterThanOrEqual(0.1);
      expect(Array.from(board.imageXY).every(Number.isFinite), `${board.label}: finite pixels`).toBe(true);
      expect(solvePlanarPnP(board.objectXY, board.imageXY, board.K), board.label).toBeNull();
    }
  });

  it("P2-PNP-14 the same input gives bitwise-identical poses and is not modified (§8)", () => {
    for (const set of [pnpSingle("P2-PNP-14"), pnpNoisyTrials()[39]]) {
      const objectXY = Float64Array.from(set.objectXY);
      const imageXY = Float64Array.from(set.imageXY);
      const K = { ...set.truth.K };
      const before = [bytesOf(objectXY), bytesOf(imageXY), JSON.stringify(K)];
      const first = solvePlanarPnP(objectXY, imageXY, K);
      const second = solvePlanarPnP(objectXY, imageXY, K);
      expectPose(first, `${set.label}: first`);
      expectPose(second, `${set.label}: second`);
      expect(bytesOf(second.R), `${set.label}: R`).toEqual(bytesOf(first.R));
      expect(bytesOf(second.t), `${set.label}: t`).toEqual(bytesOf(first.t));
      expect(Object.is(second.rms, first.rms), `${set.label}: rms`).toBe(true);
      expect([bytesOf(objectXY), bytesOf(imageXY), JSON.stringify(K)], `${set.label}: inputs`).toEqual(before);
    }
  });

  it("P2-PNP-15 object points × 7 with t × 7 give the same R and t × 7 within 1e−6 relative", () => {
    const set = pnpSingle("P2-PNP-15");
    const truth = set.truth;
    const scaledObject = set.objectXY.map((value) => 7 * value);
    const scaledT: Triple = [7 * truth.t[0], 7 * truth.t[1], 7 * truth.t[2]];
    const base = solve(set);
    const scaled = solve(set, scaledObject, project(truth.K, truth.R, scaledT, scaledObject));
    expectExact(base, truth, "unscaled");
    expect(rotationError(scaled.R, truth.R), "scaled: rotation error (rad)").toBeLessThanOrEqual(1e-6);
    expect(rotationError(scaled.R, Array.from(base.R)), "scaled vs unscaled R (rad)").toBeLessThanOrEqual(1e-6);
    expect(distance3(scaled.t, scaledT), "scaled: ‖t − 7 t_true‖").toBeLessThanOrEqual(1e-6 * norm3(scaledT));
    expect(distance3(scaled.t, Array.from(base.t, (value) => 7 * value)), "scaled t vs 7 × unscaled t").toBeLessThanOrEqual(1e-6 * norm3(scaledT));
  });

  it("P2-PNP-16 corners far from their origin, all in front of the camera while the origin is behind it, give null (OQ-69)", () => {
    for (const board of originBehindBoards()) {
      // The construction: every corner well in front of the camera, the origin of objectXY behind it
      expect(Math.min(...board.depths), `${board.label}: nearest corner depth`).toBeGreaterThanOrEqual(1);
      expect(board.t[2], `${board.label}: origin depth t_z`).toBeLessThan(0);
      expect(solvePlanarPnP(board.objectXY, board.imageXY, board.K), board.label).toBeNull();
      // The same pixels with the corners' own centred coordinates are an ordinary exact case
      const pose = solvePlanarPnP(board.centred.objectXY, board.imageXY, board.K);
      expectPose(pose, `${board.label}, centred`);
      expectExact(pose, { R: board.R, t: board.centred.t }, `${board.label}, centred`);
    }
  });
});

describe("estimateFocal (§5.3; tilt from the optical axis, OQ-23)", () => {
  const call = (input: FocalInput, objectXY: ArrayLike<number> = input.objectXY): number | null => estimateFocal(objectXY, input.imageXY, input.width, input.height);
  const relativeError = (value: number | null, input: FocalInput): number => (value === null ? Infinity : Math.abs(value - input.truth.K.fx) / input.truth.K.fx);

  function expectFocalDomain(value: number | null, label: string): void {
    if (value !== null) expect(Number.isFinite(value) && value > 0, `${label}: ${value} is null or a finite number > 0`).toBe(true);
  }

  it("P2-FOC-01 the P2-PNP-01 array cases and non-positive or non-finite image sizes throw RangeError (OQ-22)", () => {
    for (const [label, object, image] of invalidArrays()) expectRangeError(() => estimateFocal(object, image, 640, 360), label);
    const [valid] = focalInvarianceInputs();
    for (const value of [0, -1, NaN, Infinity, -Infinity]) {
      expectRangeError(() => estimateFocal(valid.objectXY, valid.imageXY, value, 360), `width ${value}`);
      expectRangeError(() => estimateFocal(valid.objectXY, valid.imageXY, 640, value), `height ${value}`);
    }
  });

  it("P2-FOC-02 exact data, tilt 30°, 45°, 60° about X, Y and the diagonal, hfov 40–100°: within 1 %", () => {
    for (const input of focalExactGrid()) {
      const value = call(input);
      expect(value, input.label).not.toBeNull();
      expect(relativeError(value, input), `${input.label}: relative error`).toBeLessThanOrEqual(0.01);
    }
  });

  it("P2-FOC-03 σ 0.3 px, tilt 45°, board at 40 % of the width: within 10 % in each of 20 trials", () => {
    for (const input of focalNoisy45()) {
      const value = call(input);
      expect(value, input.label).not.toBeNull();
      expect(relativeError(value, input), `${input.label}: relative error`).toBeLessThanOrEqual(0.1);
    }
  });

  it("P2-FOC-04 tilt 0°, 5° and 9.5°, exact and σ 0.3 px, give null", () => {
    for (const input of focalNearFrontal()) expect(call(input), input.label).toBeNull();
  });

  it("P2-FOC-05 tilt 10°, 15°, 20° and 24° give null or a finite positive number", () => {
    for (const input of focalTransition()) expectFocalDomain(call(input), input.label);
  });

  it("P2-FOC-06 tilt 25°, 30°, 45° and 60°, exact and σ 0.3 px, board ≥ 40 % of the width, give a value (OQ-24)", () => {
    for (const input of focalTilted()) {
      const value = call(input);
      expect(value, input.label).not.toBeNull();
      expectFocalDomain(value, input.label);
    }
  });

  it("P2-FOC-07 a fronto-parallel board 25° off the optical axis gives null (OQ-23)", () => {
    for (const input of focalOffCentreFrontal()) {
      const [x, y, z] = input.truth.t;
      expect(Math.atan(Math.hypot(x, y) / z) / DEG, `${input.label}: ray angle (°)`).toBeCloseTo(25, 6);
      expect(call(input), input.label).toBeNull();
    }
  });

  it("P2-FOC-08 collinear and duplicated point sets give null without throwing (OQ-25)", () => {
    for (const input of focalDegenerateSets()) expect(call(input), input.label).toBeNull();
  });

  it("P2-FOC-09 every P2-FOC input and 50 random correspondences give null or a finite number > 0", () => {
    const inputs = [
      ...focalExactGrid(),
      ...focalNoisy45(),
      ...focalNearFrontal(),
      ...focalTransition(),
      ...focalTilted(),
      ...focalOffCentreFrontal(),
      ...focalDegenerateSets(),
      ...focalInvarianceInputs(),
    ];
    for (const input of inputs) {
      expectFocalDomain(call(input), input.label);
      expectFocalDomain(call(input, input.objectXY.map((value) => 7 * value)), `${input.label} × 7`);
    }
    for (const random of focalRandomSets()) expectFocalDomain(estimateFocal(random.objectXY, random.imageXY, random.width, random.height), random.label);
  });

  it("P2-FOC-10 object points × 7 give the same estimate within 1e−9; the same input gives the same output and is not modified (§8)", () => {
    for (const input of focalInvarianceInputs()) {
      const objectXY = Float64Array.from(input.objectXY);
      const imageXY = Float64Array.from(input.imageXY);
      const before = [bytesOf(objectXY), bytesOf(imageXY)];
      const first = estimateFocal(objectXY, imageXY, input.width, input.height);
      const second = estimateFocal(objectXY, imageXY, input.width, input.height);
      const scaled = estimateFocal(objectXY.map((value) => 7 * value), imageXY, input.width, input.height);
      expect(first, input.label).not.toBeNull();
      expect(scaled, `${input.label} × 7`).not.toBeNull();
      expectRelative(scaled as number, first as number, 1e-9, `${input.label}: × 7`);
      expect(Object.is(second, first), `${input.label}: repeated call`).toBe(true);
      expect([bytesOf(objectXY), bytesOf(imageXY)], `${input.label}: inputs`).toEqual(before);
    }
  });
});

// ---------------------------------------------------------------------------------------------
// Matrices

function randomPose(rng: Rng): Pose {
  return {
    R: Float64Array.from(randomRotation(rng)),
    t: Float64Array.from([rng.range(-2, 2), rng.range(-2, 2), rng.range(1, 10)]),
    rms: rng.range(0, 1),
  };
}

const randomScenePoint = (rng: Rng): Triple => [rng.range(-3, 3), rng.range(-3, 3), rng.range(-3, 3)];
const homogeneous = (p: readonly number[]): Quad => [p[0], p[1], p[2], 1];

/** The §5.3 NDC of the OpenCV camera point (X, Y, Z), Z > 0, for an image shown with cover fit. */
function contractNdc(K: Intrinsics, image: SizeLike, viewport: SizeLike, [X, Y, Z]: Triple): [number, number] {
  const s = Math.max(viewport.width / image.width, viewport.height / image.height);
  return [
    ((2 * s * K.fx) / viewport.width) * (X / Z) + (s / viewport.width) * (2 * K.cx + 1 - image.width),
    -((2 * s * K.fy) / viewport.height) * (Y / Z) - (s / viewport.height) * (2 * K.cy + 1 - image.height),
  ];
}

/** P · [X, −Y, −Z, 1] after perspective division, and the clip-space w. */
function ndcOf(P: ArrayLike<number>, [X, Y, Z]: Triple): { ndc: Triple; w: number } {
  const clip = applyColumnMajor(P, [X, -Y, -Z, 1]);
  return { ndc: [clip[0] / clip[3], clip[1] / clip[3], clip[2] / clip[3]], w: clip[3] };
}

/** Random OpenCV camera points with Z in [near, far] inside a ±0.7 × ±0.5 cone. */
function randomCameraPoints(rng: Rng, near: number, far: number, count: number): Triple[] {
  return Array.from({ length: count }, () => {
    const Z = rng.range(near, far);
    return [rng.range(-0.7, 0.7) * Z, rng.range(-0.5, 0.5) * Z, Z];
  });
}

const NEAR = 0.1;
const FAR = 100;

describe("viewMatrix (§5.3, §6)", () => {
  it("P2-VM-01 V · [p, 1] = [F (R · B · p + t), 1] for 20 random poses × 10 scene points, column-major", () => {
    const rng = createRng(seedFor("P2-VM-01"));
    for (let k = 0; k < 20; k++) {
      const pose = randomPose(rng);
      const V = viewMatrix(pose);
      for (let m = 0; m < 10; m++) {
        const p = randomScenePoint(rng);
        expectVector(applyColumnMajor(V, homogeneous(p)), homogeneous(sceneToThreeCamera(pose.R, pose.t, p)), 1e-12, `pose ${k}, point ${m}`);
      }
    }
  });

  it("P2-VM-02 a new Float64Array(16) per call with bottom row (0, 0, 0, 1); the pose is not modified", () => {
    const rng = createRng(seedFor("P2-VM-02"));
    for (let k = 0; k < 5; k++) {
      const pose = randomPose(rng);
      const before = [bytesOf(pose.R), bytesOf(pose.t), pose.rms];
      const V = viewMatrix(pose);
      const again = viewMatrix(pose);
      expect(V).toBeInstanceOf(Float64Array);
      expect(V.length).toBe(16);
      expect([V[3], V[7], V[11], V[15]].map((value) => value + 0), "bottom row").toEqual([0, 0, 0, 1]);
      expect(again).not.toBe(V);
      expect(again.buffer).not.toBe(V.buffer);
      expect([bytesOf(pose.R), bytesOf(pose.t), pose.rms], "pose").toEqual(before);
    }
  });

  it("P2-VM-03 THREE.Matrix4.fromArray(V) applied with Vector3.applyMatrix4 gives the same result", () => {
    const rng = createRng(seedFor("P2-VM-03"));
    for (let k = 0; k < 10; k++) {
      const pose = randomPose(rng);
      const matrix = new THREE.Matrix4().fromArray(viewMatrix(pose));
      for (let m = 0; m < 5; m++) {
        const p = randomScenePoint(rng);
        const v = new THREE.Vector3(p[0], p[1], p[2]).applyMatrix4(matrix);
        expectVector([v.x, v.y, v.z], sceneToThreeCamera(pose.R, pose.t, p), 1e-12, `pose ${k}, point ${m}`);
      }
    }
  });

  it("P2-VM-04 R = I, t = (0, 0, 5) maps (0,0,0), (0,1,0), (1,0,0), (0,0,1) to (0,0,−5), (0,0,−4), (1,0,−5), (0,−1,−5)", () => {
    const V = viewMatrix({ R: Float64Array.from([1, 0, 0, 0, 1, 0, 0, 0, 1]), t: Float64Array.from([0, 0, 5]), rms: 0 });
    const cases: [Triple, Triple][] = [
      [[0, 0, 0], [0, 0, -5]],
      [[0, 1, 0], [0, 0, -4]],
      [[1, 0, 0], [1, 0, -5]],
      [[0, 0, 1], [0, -1, -5]],
    ];
    for (const [p, expected] of cases) expectVector(applyColumnMajor(V, homogeneous(p)), homogeneous(expected), 1e-12, `scene point (${p.join(", ")})`);
  });
});

describe("projectionMatrix (§5.3, §6)", () => {
  const cameras: [string, Intrinsics][] = [
    ["fx 500, fy 520, cx 300, cy 200", GENERAL_K],
    ["640×360 at 60°", DEFAULT_K],
  ];

  it("P2-PM-01 P · [X, −Y, −Z, 1] after perspective division gives the §5.3 x_ndc and y_ndc", () => {
    const rng = createRng(seedFor("P2-PM-01"));
    for (const [name, K] of cameras) {
      for (const viewport of VIEWPORTS) {
        const P = projectionMatrix(K, IMAGE, viewport, NEAR, FAR);
        for (const point of randomCameraPoints(rng, NEAR, FAR, 20)) {
          const { ndc } = ndcOf(P, point);
          expectVector(ndc.slice(0, 2), contractNdc(K, IMAGE, viewport, point), 1e-9, `${name}, ${viewport.width}×${viewport.height}, (${point.join(", ")})`);
        }
      }
    }
  });

  it("P2-PM-02 the NDC equals the K-projection mapped through an object-fit: cover layout, derived independently", () => {
    const rng = createRng(seedFor("P2-PM-02"));
    for (const [name, K] of cameras) {
      for (const viewport of VIEWPORTS) {
        const P = projectionMatrix(K, IMAGE, viewport, NEAR, FAR);
        for (const [X, Y, Z] of randomCameraPoints(rng, NEAR, FAR, 20)) {
          const { ndc } = ndcOf(P, [X, Y, Z]);
          const expected = coverNdc(K.fx * (X / Z) + K.cx, K.fy * (Y / Z) + K.cy, IMAGE, viewport);
          expectVector(ndc.slice(0, 2), expected, 1e-9, `${name}, ${viewport.width}×${viewport.height}, (${X}, ${Y}, ${Z})`);
        }
      }
    }
  });

  it("P2-PM-03 cover fit: the image's left and right edges meet a wide viewport's, its top and bottom a tall viewport's", () => {
    const wide = { width: 1920, height: 800 };
    const tall = { width: 390, height: 844 };
    expect(wide.width / IMAGE.width).toBeGreaterThan(wide.height / IMAGE.height); // s = W / w
    expect(tall.height / IMAGE.height).toBeGreaterThan(tall.width / IMAGE.width); // s = H / h
    const at = (K: Intrinsics, u: number, v: number, Z: number): Triple => [((u - K.cx) * Z) / K.fx, ((v - K.cy) * Z) / K.fy, Z];
    for (const [name, K] of cameras) {
      for (const Z of [0.5, 3, 40]) {
        const pw = projectionMatrix(K, IMAGE, wide, NEAR, FAR);
        expect(Math.abs(ndcOf(pw, at(K, -0.5, K.cy, Z)).ndc[0] + 1), `${name}, wide, u = −0.5, Z ${Z}`).toBeLessThanOrEqual(1e-9);
        expect(Math.abs(ndcOf(pw, at(K, IMAGE.width - 0.5, K.cy, Z)).ndc[0] - 1), `${name}, wide, u = w − 0.5, Z ${Z}`).toBeLessThanOrEqual(1e-9);
        const pt = projectionMatrix(K, IMAGE, tall, NEAR, FAR);
        expect(Math.abs(ndcOf(pt, at(K, K.cx, -0.5, Z)).ndc[1] - 1), `${name}, tall, v = −0.5, Z ${Z}`).toBeLessThanOrEqual(1e-9);
        expect(Math.abs(ndcOf(pt, at(K, K.cx, IMAGE.height - 0.5, Z)).ndc[1] + 1), `${name}, tall, v = h − 0.5, Z ${Z}`).toBeLessThanOrEqual(1e-9);
      }
    }
  });

  it("P2-PM-04 depth: Z = near maps to −1, Z = far to +1, increasing in between", () => {
    for (const [near, far] of [
      [0.1, 100],
      [0.05, 20],
      [1, 2],
    ]) {
      for (const [name, K] of cameras) {
        const P = projectionMatrix(K, IMAGE, VIEWPORTS[1], near, far);
        const label = `${name}, near ${near}, far ${far}`;
        expect(Math.abs(ndcOf(P, [0.1 * near, -0.05 * near, near]).ndc[2] + 1), `${label}: Z = near`).toBeLessThanOrEqual(1e-9);
        expect(Math.abs(ndcOf(P, [0.1 * far, -0.05 * far, far]).ndc[2] - 1), `${label}: Z = far`).toBeLessThanOrEqual(1e-9);
        let previous = -Infinity;
        for (let k = 0; k <= 20; k++) {
          const Z = near * (far / near) ** (k / 20);
          const depth = ndcOf(P, [0.3 * Z, 0.2 * Z, Z]).ndc[2];
          expect(depth, `${label}: Z ${Z}`).toBeGreaterThan(previous);
          previous = depth;
        }
      }
    }
  });

  it("P2-PM-05 clip w = k · Z with k > 0 for points in front, and det P ≠ 0 (OQ-26)", () => {
    const rng = createRng(seedFor("P2-PM-05"));
    for (const [name, K] of cameras) {
      for (const viewport of VIEWPORTS) {
        const P = projectionMatrix(K, IMAGE, viewport, NEAR, FAR);
        const label = `${name}, ${viewport.width}×${viewport.height}`;
        const ratios = randomCameraPoints(rng, NEAR, FAR, 20).map((point) => ndcOf(P, point).w / point[2]);
        expect(ratios[0], `${label}: k`).toBeGreaterThan(0);
        for (const ratio of ratios) expectRelative(ratio, ratios[0], 1e-12, `${label}: w / Z`);
        const det = det4(P);
        expect(Number.isFinite(det) && det !== 0, `${label}: det P = ${det}`).toBe(true);
      }
    }
  });

  it("P2-PM-06 non-positive or non-finite sizes, near, far outside 0 < near < far, and invalid K throw RangeError (OQ-22, OQ-64, OQ-70)", () => {
    for (const value of [0, -1, NaN, Infinity, -Infinity]) {
      expectRangeError(() => projectionMatrix(DEFAULT_K, { width: value, height: 360 }, VIEWPORTS[0], NEAR, FAR), `image width ${value}`);
      expectRangeError(() => projectionMatrix(DEFAULT_K, { width: 640, height: value }, VIEWPORTS[0], NEAR, FAR), `image height ${value}`);
      expectRangeError(() => projectionMatrix(DEFAULT_K, IMAGE, { width: value, height: 720 }, NEAR, FAR), `viewport width ${value}`);
      expectRangeError(() => projectionMatrix(DEFAULT_K, IMAGE, { width: 1280, height: value }, NEAR, FAR), `viewport height ${value}`);
    }
    for (const [near, far] of [
      [0, FAR],
      [-1, FAR],
      [5, 5],
      [10, 5],
      [NaN, FAR],
      [NEAR, NaN],
      [NEAR, Infinity],
    ]) {
      expectRangeError(() => projectionMatrix(DEFAULT_K, IMAGE, VIEWPORTS[0], near, far), `near ${near}, far ${far}`);
    }
    // K is validated as in solvePlanarPnP (OQ-70)
    const badK: [string, Intrinsics][] = [
      ["fx 0", { ...DEFAULT_K, fx: 0 }],
      ["fx −1", { ...DEFAULT_K, fx: -1 }],
      ["fy 0", { ...DEFAULT_K, fy: 0 }],
      ["fy −1", { ...DEFAULT_K, fy: -1 }],
      ["fx NaN", { ...DEFAULT_K, fx: NaN }],
      ["fy Infinity", { ...DEFAULT_K, fy: Infinity }],
      ["cx NaN", { ...DEFAULT_K, cx: NaN }],
      ["cx Infinity", { ...DEFAULT_K, cx: Infinity }],
      ["cy −Infinity", { ...DEFAULT_K, cy: -Infinity }],
    ];
    for (const [label, K] of badK) expectRangeError(() => projectionMatrix(K, IMAGE, VIEWPORTS[0], NEAR, FAR), `K with ${label}`);
  });

  it("P2-PM-07 a new Float64Array(16) per call that gives the same NDC through THREE.Matrix4 and Vector3.applyMatrix4", () => {
    const rng = createRng(seedFor("P2-PM-07"));
    for (const [name, K] of cameras) {
      for (const viewport of VIEWPORTS) {
        const P = projectionMatrix(K, IMAGE, viewport, NEAR, FAR);
        const again = projectionMatrix(K, IMAGE, viewport, NEAR, FAR);
        expect(P).toBeInstanceOf(Float64Array);
        expect(P.length).toBe(16);
        expect(again).not.toBe(P);
        expect(again.buffer).not.toBe(P.buffer);
        const matrix = new THREE.Matrix4().fromArray(P);
        for (const [X, Y, Z] of randomCameraPoints(rng, NEAR, FAR, 10)) {
          const v = new THREE.Vector3(X, -Y, -Z).applyMatrix4(matrix);
          const label = `${name}, ${viewport.width}×${viewport.height}, (${X}, ${Y}, ${Z})`;
          expectVector([v.x, v.y, v.z], ndcOf(P, [X, Y, Z]).ndc, 1e-9, label);
          expectVector([v.x, v.y], contractNdc(K, IMAGE, viewport, [X, Y, Z]), 1e-9, `${label} vs §5.3`);
        }
      }
    }
  });
});

describe("cameraPosition (§5.3, §6)", () => {
  it("P2-CP-01 B⁻¹ · (−Rᵀ t) for 20 random poses, as a new Float64Array(3) per call", () => {
    const rng = createRng(seedFor("P2-CP-01"));
    for (let k = 0; k < 20; k++) {
      const pose = randomPose(rng);
      const c = cameraPosition(pose);
      expect(c).toBeInstanceOf(Float64Array);
      expect(c.length).toBe(3);
      expectVector(c, cameraCentreInScene(pose.R, pose.t), 1e-12, `pose ${k}`);
      const again = cameraPosition(pose);
      expect(again).not.toBe(c);
      expect(again.buffer).not.toBe(c.buffer);
    }
  });

  it("P2-CP-02 the camera position maps to the three.js camera's origin under the view matrix", () => {
    const rng = createRng(seedFor("P2-CP-01")); // the same 20 poses as P2-CP-01
    for (let k = 0; k < 20; k++) {
      const pose = randomPose(rng);
      const c = cameraPosition(pose);
      expectVector(applyColumnMajor(viewMatrix(pose), homogeneous(Array.from(c))), [0, 0, 0, 1], 1e-9, `pose ${k}`);
    }
  });

  it("P2-CP-03 R = I, t = (0, 0, 5) puts the camera at scene (0, 5, 0)", () => {
    const c = cameraPosition({ R: Float64Array.from([1, 0, 0, 0, 1, 0, 0, 0, 1]), t: Float64Array.from([0, 0, 5]), rms: 0 });
    expectVector(c, [0, 5, 0], 1e-12, "camera position");
  });
});

describe("view and projection together (§5.3, §6, D11)", () => {
  const frontViews = (label: string): Pose[] =>
    Array.from({ length: 10 }, (_, k) => {
      const placed = samplePose(`${label}#${k}`, createRng(seedFor(`${label}#${k}`)), { tiltDeg: [0, 60], widthFraction: [1 / 3, 0.8], centreSpread: 0.4 });
      return { R: Float64Array.from(placed.R), t: Float64Array.from(placed.t), rms: 0 };
    });

  it("P2-CHN-01 board corners drawn at scene (X, 0, Y) land on the cover-mapped K-projection of (X, Y, 0)", () => {
    const corners = boardCorners();
    frontViews("P2-CHN-01").forEach((pose, k) => {
      const viewport = VIEWPORTS[k % VIEWPORTS.length];
      const V = viewMatrix(pose);
      const P = projectionMatrix(DEFAULT_K, IMAGE, viewport, 0.05, 100);
      const pixels = project(DEFAULT_K, pose.R, pose.t, corners);
      expect(Math.min(...cameraPoints(pose.R, pose.t, corners).filter((_, m) => m % 3 === 2)), `pose ${k}: corners in front`).toBeGreaterThan(0);
      for (let m = 0; m < corners.length / 2; m++) {
        const clip = applyColumnMajor(P, applyColumnMajor(V, [corners[2 * m], 0, corners[2 * m + 1], 1]));
        const expected = coverNdc(pixels[2 * m], pixels[2 * m + 1], IMAGE, viewport);
        expectVector([clip[0] / clip[3], clip[1] / clip[3]], expected, 1e-9, `pose ${k}, corner ${m}`);
      }
    });
  });

  it("P2-CHN-02 scene up points towards the camera: (0, 0.5, 0) is nearer than (0, 0, 0) for boards seen from the front", () => {
    frontViews("P2-CHN-02").forEach((pose, k) => {
      const V = viewMatrix(pose);
      const lifted = applyColumnMajor(V, [0, 0.5, 0, 1]);
      const origin = applyColumnMajor(V, [0, 0, 0, 1]);
      expect(Math.hypot(lifted[0], lifted[1], lifted[2]), `pose ${k}: distance of (0, 0.5, 0) vs (0, 0, 0)`).toBeLessThan(Math.hypot(origin[0], origin[1], origin[2]));
    });
  });
});

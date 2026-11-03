// P2 contract tests for createPipeline on the real detector and pose modules: docs/design_camera_ar.md
// §5.4 steps 1–6 and §14 (OQ-33–OQ-35); test plan §4.7. The cases that spy on or mock the detector
// call, estimateFocal or solvePlanarPnP are in pipeline.spy.test.ts.

import { describe, expect, it } from "vitest";
import { boardCorners } from "@/ar/board";
import { type FrameInput, type FrameOutput, createPipeline } from "@/ar/pipeline";
import { solvePlanarPnP } from "@/ar/pose";
import {
  FRAME_MS,
  type Frame,
  blankFrame,
  comparable,
  focalBoard,
  input,
  invertedRedBoard,
  movingBoard,
  portraitBoard,
  poseBoards,
} from "./helpers/frames";
import { rotationAngle } from "./helpers/linalg";
import { bytesOf, expectRangeError } from "./helpers/metrics";

const SLOW = { timeout: 120_000 };
const DEG = Math.PI / 180;
const focalAt = (width: number, fovDeg: number): number => width / 2 / Math.tan((fovDeg / 2) * DEG);

type Pipeline = ReturnType<typeof createPipeline>;

/** A step of a scripted run: a frame, or a call to reset(). */
type Step = Frame | "reset";

function expectRelative(actual: number, expected: number, tolerance: number, label: string): void {
  expect(Math.abs(actual - expected), `${label}: ${actual} vs ${expected}`).toBeLessThanOrEqual(tolerance * Math.abs(expected));
}

/** Runs the steps through the pipeline; the k-th step happens at time (start + k) · FRAME_MS. */
function run(pipeline: Pipeline, steps: readonly Step[], start = 0): FrameOutput[] {
  const outputs: FrameOutput[] = [];
  steps.forEach((step, k) => {
    if (step === "reset") pipeline.reset();
    else outputs.push(pipeline.process(input(step, (start + k) * FRAME_MS)));
  });
  return outputs;
}

function expectSameOutputs(actual: readonly FrameOutput[], expected: readonly FrameOutput[], label: string): void {
  expect(actual.length, `${label}: number of outputs`).toBe(expected.length);
  actual.forEach((output, k) => expect(comparable(output), `${label}: output ${k}`).toEqual(comparable(expected[k])));
}

const blank320 = (): Frame => blankFrame(320, 180);

describe("createPipeline on the real modules (§5.4)", () => {
  it("P2-PIP-01 a blank frame: not found, no corners or pose, the default intrinsics (step 3)", () => {
    const output = createPipeline().process(input(blank320(), 0));
    expect(output.found).toBe(false);
    expect(output.corners).toBeNull();
    expect(output.pose).toBeNull();
    expectRelative(output.intrinsics.fx, 277.1281292, 1e-9, "fx");
    expectRelative(output.intrinsics.fy, 277.1281292, 1e-9, "fy");
    expect(output.intrinsics.cx).toBe(159.5);
    expect(output.intrinsics.cy).toBe(89.5);
    expect(Number.isFinite(output.ms) && output.ms >= 0, `ms ${output.ms}`).toBe(true);
  });

  it("P2-PIP-02 a board frame: found, 108 corners, a pose, and intrinsics with fx = fy at the image centre (step 4)", SLOW, () => {
    const output = createPipeline().process(input(movingBoard()[0], 0));
    expect(output.found).toBe(true);
    expect(output.corners).toBeInstanceOf(Float32Array);
    expect(output.corners?.length).toBe(108);
    expect(output.pose).not.toBeNull();
    expect(output.intrinsics.fy).toBe(output.intrinsics.fx);
    expect(output.intrinsics.cx).toBe(159.5);
    expect(output.intrinsics.cy).toBe(89.5);
    expect(Number.isFinite(output.ms) && output.ms >= 0, `ms ${output.ms}`).toBe(true);
  });

  it("P2-PIP-03 the pose is solvePlanarPnP(boardCorners(), corners, intrinsics) of the output itself, bitwise (step 4)", SLOW, () => {
    // The first frame, whose corners are a copy of the raw ones, and four smoothed frames after it
    const outputs = run(createPipeline(), movingBoard().slice(0, 5));
    outputs.forEach((output, k) => {
      expect(output.found, `frame ${k}`).toBe(true);
      const recomputed = solvePlanarPnP(boardCorners(), output.corners as Float32Array, output.intrinsics);
      expect(recomputed, `frame ${k}`).not.toBeNull();
      expect(Array.from(output.pose?.R ?? []), `frame ${k}: R`).toEqual(Array.from(recomputed?.R ?? []));
      expect(Array.from(output.pose?.t ?? []), `frame ${k}: t`).toEqual(Array.from(recomputed?.t ?? []));
      expect(Object.is(output.pose?.rms, recomputed?.rms), `frame ${k}: rms`).toBe(true);
    });
  });

  it("P2-PIP-11 end to end the focal length learned from the board is within 10 % of a true hfov of 50° after 12 frames (OQ-71)", SLOW, () => {
    // The 40° clamp is checked with scripted estimates in P2-PIP-10: a camera narrower than 40° is
    // outside the 40–100° range for which estimateFocal promises values (OQ-62, OQ-71)
    const frames = focalBoard(50);
    const last = run(createPipeline(), frames).at(-1) as FrameOutput;
    const fTrue = frames[0].mapping.K.fx;
    expect(Math.abs(last.intrinsics.fx / fTrue - 1), `fx ${last.intrinsics.fx} vs the true ${fTrue}`).toBeLessThanOrEqual(0.1);
    expect(last.intrinsics.fy).toBe(last.intrinsics.fx);
  });

  it("P2-PIP-12 detaching the returned buffers after every call changes nothing: the pipeline keeps no reference to them (step 5)", SLOW, () => {
    const frames = movingBoard();
    const steps: Step[] = [...frames.slice(0, 8), blank320(), ...frames.slice(8, 12)];
    for (const smoothing of [true, false]) {
      const reference = run(createPipeline({ smoothing }), steps).map(comparable);
      const pipeline = createPipeline({ smoothing });
      steps.forEach((step, k) => {
        const output = pipeline.process(input(step as Frame, k * FRAME_MS));
        expect(comparable(output), `smoothing ${smoothing}, frame ${k}`).toEqual(reference[k]);
        const buffers = [output.corners?.buffer, output.pose?.R.buffer, output.pose?.t.buffer].filter((buffer): buffer is ArrayBuffer => buffer !== undefined);
        structuredClone(output, { transfer: [...new Set(buffers)] });
        expect(output.corners?.length ?? 0, `smoothing ${smoothing}, frame ${k}: corners detached`).toBe(0);
      });
    }
  });

  it("P2-PIP-13 the same 20 frames, with lost frames, reset() and a size change, give the same outputs twice (step 5)", SLOW, () => {
    const moving = movingBoard();
    const portrait = portraitBoard();
    const steps: Step[] = [...moving.slice(0, 8), blank320(), blank320(), ...moving.slice(8, 11), "reset", ...moving.slice(11, 14), ...portrait.slice(0, 4)];
    expectSameOutputs(run(createPipeline(), steps), run(createPipeline(), steps), "second run");
  });

  it("P2-PIP-14 a size change resets every state: the frames after it match a fresh pipeline's (step 1)", SLOW, () => {
    const moving = movingBoard().slice(0, 8);
    const portrait = portraitBoard().slice(0, 6);
    const a = run(createPipeline(), [...moving, ...portrait]);
    // Before the change the focal length has been learned, so the reset is visible in the intrinsics
    expect(a[7].intrinsics.fx, "fx learned at 320×180").not.toBe(focalAt(320, 60));
    const b = run(createPipeline(), portrait, moving.length);
    expectSameOutputs(a.slice(moving.length), b, "after the size change");
    expectRelative(a[moving.length].intrinsics.fx, focalAt(180, 60), 1e-12, "fx back to the 180×320 default");
    expect(a[moving.length].intrinsics.cx).toBe(89.5);
    expect(a[moving.length].intrinsics.cy).toBe(159.5);
  });

  it("P2-PIP-15 after reset() the outputs equal a fresh pipeline's (step 6)", SLOW, () => {
    const frames = movingBoard();
    const a = run(createPipeline(), [...frames.slice(0, 8), "reset", ...frames.slice(8, 14)]);
    expect(a[7].intrinsics.fx, "fx learned before reset()").not.toBe(focalAt(320, 60));
    const b = run(createPipeline(), frames.slice(8, 14), 9);
    expectSameOutputs(a.slice(8), b, "after reset()");
  });

  it("P2-PIP-17 the frame is converted to grey before detection: a board visible only in the BT.601 luma is found", SLOW, () => {
    const frame = invertedRedBoard();
    const output = createPipeline().process(input(frame, 0));
    expect(output.found).toBe(true);
    const truth = frame.scene.truth();
    const corners = output.corners as Float32Array;
    expect(Math.hypot(corners[0] - truth[0], corners[1] - truth[1]), "corner 0 vs the grey truth (px)").toBeLessThanOrEqual(1);
  });

  it("P2-PIP-18 sanity, not a contract bound: with the true K the pose is within 2° and 3 %", SLOW, () => {
    for (const frame of poseBoards()) {
      const output = createPipeline({ autoFocal: false }).process(input(frame, 0));
      expect(output.found, frame.label).toBe(true);
      const pose = output.pose;
      expect(pose, frame.label).not.toBeNull();
      const { R, t } = frame.mapping;
      expect(rotationAngle(Array.from(pose?.R ?? []), R) / DEG, `${frame.label}: rotation error (°)`).toBeLessThanOrEqual(2);
      const error = Math.hypot((pose?.t[0] ?? 0) - t[0], (pose?.t[1] ?? 0) - t[1], (pose?.t[2] ?? 0) - t[2]) / Math.hypot(t[0], t[1], t[2]);
      expect(error, `${frame.label}: translation error / ‖t‖`).toBeLessThanOrEqual(0.03);
    }
  });

  it("P2-PIP-19 createPipeline() behaves like hfovDeg 60, autoFocal and smoothing on", SLOW, () => {
    const frames = movingBoard().slice(0, 15);
    expectSameOutputs(run(createPipeline(), frames), run(createPipeline({ hfovDeg: 60, autoFocal: true, smoothing: true }), frames), "explicit defaults");
  });

  it("P2-PIP-20 process does not modify the frame's bytes (§8)", SLOW, () => {
    const pipeline = createPipeline();
    const frames: Frame[] = [movingBoard()[0], movingBoard()[1], blank320(), movingBoard()[2]];
    frames.forEach((frame, k) => {
      const frameInput = input(frame, k * FRAME_MS);
      const before = bytesOf(frameInput.rgba);
      pipeline.process(frameInput);
      expect(bytesOf(frameInput.rgba), `${frame.label}: rgba bytes`).toEqual(before);
    });
  });

  it("P2-PIP-21 a malformed frame throws RangeError and leaves the state as it was (OQ-35)", SLOW, () => {
    const frames = movingBoard().slice(0, 8);
    const reference = run(createPipeline(), frames);
    const pipeline = createPipeline();
    const outputs = run(pipeline, frames.slice(0, 4));
    const rgba = frames[3].rgba;
    const longer = new Uint8ClampedArray(rgba.length + 4);
    longer.set(rgba);
    const malformed: [string, FrameInput][] = [
      ["rgba 4 bytes short", { width: 320, height: 180, rgba: rgba.slice(0, rgba.length - 4), time: 3.2 * FRAME_MS }],
      ["rgba 4 bytes long", { width: 320, height: 180, rgba: longer, time: 3.3 * FRAME_MS }],
      ["width 320.5", { width: 320.5, height: 180, rgba: rgba.slice(), time: 3.4 * FRAME_MS }],
      ["width 0", { width: 0, height: 180, rgba: rgba.slice(), time: 3.5 * FRAME_MS }],
      ["height NaN", { width: 320, height: NaN, rgba: rgba.slice(), time: 3.6 * FRAME_MS }],
      ["160×90 with the bytes of 320×180", { width: 160, height: 90, rgba: rgba.slice(), time: 3.7 * FRAME_MS }],
    ];
    for (const [label, frame] of malformed) expectRangeError(() => pipeline.process(frame), label);
    outputs.push(...run(pipeline, frames.slice(4), 4));
    expectSameOutputs(outputs, reference, "with the malformed frames between frames 3 and 4");
  });
});

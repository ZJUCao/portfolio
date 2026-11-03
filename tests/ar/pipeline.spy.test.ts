// P2 contract tests for createPipeline that watch the calls §5.4 specifies: the detector call with its
// hint, estimateFocal and solvePlanarPnP (docs/design_camera_ar.md §5.4, §14 OQ-33 and OQ-34; test
// plan §1.1 and §4.7). Module mocks wrap exactly these three functions and call the real ones unless
// a test scripts them; nothing else is mocked.

import { afterEach, describe, expect, it, vi } from "vitest";
import { boardCorners } from "@/ar/board";
import { findChessboardCorners, rgbaToGray } from "@/ar/chessboard";
import { type FrameOutput, createCornerFilter, createPipeline } from "@/ar/pipeline";
import { estimateFocal, solvePlanarPnP } from "@/ar/pose";
import { FRAME_MS, type Frame, blankFrame, focalBoard, input, movingBoard, portraitBoard, trackerRule } from "./helpers/frames";

vi.mock(import("@/ar/chessboard"), async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, findChessboardCorners: vi.fn(actual.findChessboardCorners) };
});
vi.mock(import("@/ar/pose"), async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, estimateFocal: vi.fn(actual.estimateFocal), solvePlanarPnP: vi.fn(actual.solvePlanarPnP) };
});

const actualChessboard = await vi.importActual<typeof import("@/ar/chessboard")>("@/ar/chessboard");
const actualPose = await vi.importActual<typeof import("@/ar/pose")>("@/ar/pose");
const detector = vi.mocked(findChessboardCorners);
const focal = vi.mocked(estimateFocal);
const pnp = vi.mocked(solvePlanarPnP);

afterEach(() => {
  // mockReset() clears the calls and puts each wrapper back on the real function; in Vitest 4
  // restoreAllMocks() only restores spies made with vi.spyOn
  for (const mock of [detector, focal, pnp]) mock.mockReset();
  vi.restoreAllMocks();
});

const SLOW = { timeout: 120_000 };
const DEG = Math.PI / 180;
const focalAt = (width: number, fovDeg: number): number => width / 2 / Math.tan((fovDeg / 2) * DEG);

type Pipeline = ReturnType<typeof createPipeline>;
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

const blank320 = (): Frame => blankFrame(320, 180);

interface DetectorCall {
  readonly width: number;
  readonly height: number;
  /** The grey bytes as they were during the call; a pipeline may reuse its grey buffer afterwards. */
  readonly gray: Uint8Array;
  readonly size: readonly [number, number];
  readonly previous: Float32Array | null;
  /** The raw corners the call returned. */
  readonly raw: Float32Array | null;
}

/** Makes the detector record every call, with copies of its arguments and result, and still detect for real. */
function recordDetector(): DetectorCall[] {
  const calls: DetectorCall[] = [];
  detector.mockImplementation((image, cornersX, cornersY, options) => {
    const previous = options?.previous ?? null;
    const gray = Uint8Array.from(image.data);
    const copy = previous === null ? null : Float32Array.from(previous);
    const raw = actualChessboard.findChessboardCorners(image, cornersX, cornersY, options);
    calls.push({ width: image.width, height: image.height, gray, size: [cornersX, cornersY], previous: copy, raw: raw === null ? null : Float32Array.from(raw) });
    return raw;
  });
  return calls;
}

interface FocalCall {
  readonly objectXY: number[];
  readonly imageXY: number[];
  readonly width: number;
  readonly height: number;
  readonly value: number | null;
}

/** Makes estimateFocal record every call; `script(n)` gives the n-th return value, else the real estimate. */
function recordFocal(script?: (n: number) => number | null): FocalCall[] {
  const calls: FocalCall[] = [];
  focal.mockImplementation((objectXY, imageXY, width, height) => {
    const value = script ? script(calls.length) : actualPose.estimateFocal(objectXY, imageXY, width, height);
    calls.push({ objectXY: Array.from(objectXY), imageXY: Array.from(imageXY), width, height, value });
    return value;
  });
  return calls;
}

describe("createPipeline, watching the §5.4 calls", () => {
  it("P2-PIP-04 the detector gets the frame in grey, 9 × 6, and the previous frame's raw corners as its hint (step 2)", SLOW, () => {
    const frames = movingBoard().slice(0, 5);
    const calls = recordDetector();
    const outputs = run(createPipeline(), frames);
    expect(calls.length, "one detector call per frame").toBe(5);
    frames.forEach((frame, k) => {
      const call = calls[k];
      expect([call.width, call.height], `call ${k}: image size`).toEqual([frame.width, frame.height]);
      const gray = rgbaToGray(frame.rgba, frame.width, frame.height).data;
      expect(Buffer.from(call.gray).equals(Buffer.from(gray)), `call ${k}: the grey bytes are rgbaToGray(rgba)`).toBe(true);
      expect(call.size, `call ${k}`).toEqual([9, 6]);
      if (k === 0) {
        expect(call.previous, "call 0: no hint").toBeNull();
        return;
      }
      expect(call.previous, `call ${k}: the previous frame's raw corners`).toEqual(calls[k - 1].raw);
      // From the third frame on the smoothed output lags the raw corners, so the two differ
      if (k >= 2) expect(call.previous, `call ${k}: the hint is not the smoothed output`).not.toEqual(outputs[k - 1].corners);
    });
  });

  it("P2-PIP-05 the hint is dropped after a lost frame, after reset() and after a size change (step 2)", SLOW, () => {
    const frames = movingBoard();
    const cases: [string, Step[], number][] = [
      ["after a lost frame", [frames[0], blank320(), frames[1]], 2],
      ["after reset()", [frames[0], "reset", frames[1]], 1],
      ["after a size change", [frames[0], portraitBoard()[0]], 1],
    ];
    for (const [label, steps, call] of cases) {
      const calls = recordDetector();
      run(createPipeline(), steps);
      expect(calls[0].raw, `${label}: the first frame was found`).not.toBeNull();
      expect(calls[call].previous, label).toBeNull();
    }
  });

  it("P2-PIP-06 when solvePlanarPnP fails after a detection, that frame's raw corners are still the next hint (OQ-33)", SLOW, () => {
    const frames = movingBoard();
    const calls = recordDetector();
    pnp.mockImplementationOnce(() => null);
    const outputs = run(createPipeline(), [frames[0], frames[1]]);
    expect(calls[0].raw, "frame 0 was detected").not.toBeNull();
    expect(outputs[0].found, "frame 0 counts as not found").toBe(false);
    expect(calls[1].previous, "the hint of frame 1").toEqual(calls[0].raw);
  });

  it("P2-PIP-07 smoothing on, the corners are createCornerFilter() fed the raw corners and frame times; off, the raw corners (step 4, OQ-75)", SLOW, () => {
    const frames = movingBoard().slice(0, 10);
    const smoothedCalls = recordDetector();
    const smoothed = run(createPipeline(), frames);
    const filter = createCornerFilter();
    smoothed.forEach((output, k) => {
      expect(output.found, `smoothing on, frame ${k}`).toBe(true);
      expect(output.corners, `smoothing on, frame ${k}`).toEqual(filter.apply(smoothedCalls[k].raw as Float32Array, k * FRAME_MS));
    });
    const rawCalls = recordDetector();
    const raw = run(createPipeline({ smoothing: false }), frames);
    raw.forEach((output, k) => expect(output.corners, `smoothing off, frame ${k}`).toEqual(rawCalls[k].raw));
  });

  it("P2-PIP-08 a lost frame resets the corner filter: the next found frame's corners are its raw corners (step 3)", SLOW, () => {
    const frames = movingBoard();
    const calls = recordDetector();
    const outputs = run(createPipeline(), [frames[0], frames[1], blank320(), frames[2]]);
    expect(outputs[2].found).toBe(false);
    expect(outputs[3].corners).toEqual(calls[3].raw);
  });

  it("P2-PIP-09 with autoFocal off estimateFocal is never called and fx is (w / 2) / tan(hfov / 2) on every frame", SLOW, () => {
    const frames = movingBoard();
    const steps: Step[] = [...frames.slice(0, 5), blank320(), ...frames.slice(5, 9)];
    for (const hfovDeg of [60, 75]) {
      const outputs = run(createPipeline({ autoFocal: false, hfovDeg }), steps);
      expect(focal, `hfov ${hfovDeg}°`).not.toHaveBeenCalled();
      outputs.forEach((output, k) => {
        expectRelative(output.intrinsics.fx, focalAt(320, hfovDeg), 1e-12, `hfov ${hfovDeg}°, frame ${k}: fx`);
        expectRelative(output.intrinsics.fy, focalAt(320, hfovDeg), 1e-12, `hfov ${hfovDeg}°, frame ${k}: fy`);
      });
    }
  });

  it("P2-PIP-10 with autoFocal on each found frame's estimate is added before K is built, and fx follows the tracker rule, its 40° clamp included (OQ-71, OQ-75)", SLOW, () => {
    const moving = movingBoard();
    const blank = blank320();
    // The plan's script on 320×180 frames with a lost frame; then estimates of about 1194 px on
    // 640×360 frames, a camera narrower than the 40° bound, which the median must be clamped to
    const runs: { name: string; steps: Step[]; script: (number | null)[]; size: [number, number]; clampFrom?: number }[] = [
      { name: "320×180", steps: [...moving.slice(0, 5), blank, ...moving.slice(5, 10)], script: [400, null, 410, 405, 395, 402, 398, 401, 399, 403], size: [320, 180] },
      { name: "640×360 at the clamp", steps: focalBoard(50).slice(0, 8), script: [1190, 1196, 1194, null, 1200, 1188, 1193, 1197], size: [640, 360], clampFrom: 5 },
    ];
    for (const { name, steps, script, size, clampFrom } of runs) {
      const focalCalls = recordFocal((n) => script[n]);
      const detectorCalls = recordDetector();
      const outputs = run(createPipeline(), steps);
      const found = detectorCalls.filter((call) => call.raw !== null);
      expect(found.length, `${name}: found frames`).toBe(script.length);
      expect(focalCalls.length, `${name}: one estimateFocal call per found frame`).toBe(script.length);
      focalCalls.forEach((call, n) => {
        expect(call.objectXY, `${name}, call ${n}: objectXY`).toEqual(Array.from(boardCorners()));
        expect(call.imageXY, `${name}, call ${n}: the raw corners`).toEqual(Array.from(found[n].raw as Float32Array));
        expect([call.width, call.height], `${name}, call ${n}`).toEqual(size);
      });
      const estimates: (number | null)[] = [];
      outputs.forEach((output, k) => {
        if (steps[k] !== blank) estimates.push(script[estimates.length]);
        const expected = trackerRule(estimates, size[0]);
        expectRelative(output.intrinsics.fx, expected, 1e-12, `${name}, frame ${k}: fx`);
        expectRelative(output.intrinsics.fy, expected, 1e-12, `${name}, frame ${k}: fy`);
      });
      // From the 5th valid estimate on, fx sits at the focal length of the 40° bound
      if (clampFrom !== undefined) {
        for (const [k, output] of outputs.entries()) {
          if (k < clampFrom) continue;
          expectRelative(output.intrinsics.fx, focalAt(size[0], 40), 1e-9, `${name}, frame ${k}: fx at the 40° clamp`);
          expect(Math.abs(output.intrinsics.fx - 879.1928), `${name}, frame ${k}: fx vs 879.1928`).toBeLessThanOrEqual(5e-5);
        }
      }
    }
  });

  it("P2-PIP-16 a null pose makes the frame not found, with the tracker's intrinsics, and restarts the smoothing (step 4, OQ-75)", SLOW, () => {
    let pnpCalls = 0;
    pnp.mockImplementation((objectXY, imageXY, K) => (++pnpCalls === 7 ? null : actualPose.solvePlanarPnP(objectXY, imageXY, K)));
    const focalCalls = recordFocal();
    const detectorCalls = recordDetector();
    const outputs = run(createPipeline(), movingBoard().slice(0, 8));
    outputs.slice(0, 6).forEach((output, k) => expect(output.found, `frame ${k}`).toBe(true));
    const failed = outputs[6];
    expect(failed.found).toBe(false);
    expect(failed.corners).toBeNull();
    expect(failed.pose).toBeNull();
    const expected = trackerRule(
      focalCalls.slice(0, 7).map((call) => call.value),
      320,
    );
    expect(expected, "the focal length was learned by frame 6").not.toBe(focalAt(320, 60));
    expectRelative(failed.intrinsics.fx, expected, 1e-12, "frame 6: fx");
    expectRelative(failed.intrinsics.fy, expected, 1e-12, "frame 6: fy");
    expect(outputs[7].found).toBe(true);
    expect(outputs[7].corners, "frame 7: the smoothing restarts from its raw corners").toEqual(detectorCalls[7].raw);
  });

  it("P2-PIP-22 a lost frame reports the tracker's focal length, with the principal point at the image centre (OQ-34, OQ-75)", SLOW, () => {
    const focalCalls = recordFocal(() => 420);
    const outputs = run(createPipeline(), [...movingBoard().slice(0, 5), blank320()]);
    expect(focalCalls.length).toBe(5);
    const lost = outputs[5];
    expect(lost.found).toBe(false);
    expectRelative(lost.intrinsics.fx, 420, 1e-12, "fx");
    expectRelative(lost.intrinsics.fy, 420, 1e-12, "fy");
    expect(lost.intrinsics.cx).toBe(159.5);
    expect(lost.intrinsics.cy).toBe(89.5);
  });
});

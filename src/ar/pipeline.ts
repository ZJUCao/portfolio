// Per-frame processing for camera AR, run inside the tracking worker: grey conversion, chessboard
// detection with the previous frame's corners as a hint, corner smoothing, focal-length tracking and
// the board pose; plus the worker's message handling, kept here so that it runs in Node for tests.
// Contract: docs/design_camera_ar.md §5.4 and the resolved details in §14.

import { boardCorners } from "./board";
import { findChessboardCorners, rgbaToGray } from "./chessboard";
import { type Intrinsics, type Pose, estimateFocal, solvePlanarPnP } from "./pose";

/** One RGBA analysis frame. */
export interface FrameInput {
  readonly width: number;
  readonly height: number;
  /** 4 · width · height bytes, row-major. */
  readonly rgba: Uint8ClampedArray;
  /** Capture time in milliseconds. */
  readonly time: number;
}

/** The result of processing one frame. */
export interface FrameOutput {
  readonly found: boolean;
  /** Smoothed corners in the detector's layout, or null when the board was not found. */
  readonly corners: Float32Array | null;
  /** The board pose, or null when the board was not found. */
  readonly pose: Pose | null;
  /** The intrinsics the pose was solved with; when not found, the ones it would have used (OQ-34). */
  readonly intrinsics: Intrinsics;
  /** Processing time in milliseconds. */
  readonly ms: number;
}

/** Options for {@link createPipeline}. */
export interface PipelineOptions {
  /** Horizontal field of view in degrees until the focal length is learned; default 60. */
  readonly hfovDeg?: number;
  /** Learn the focal length from the board (D1); default true. */
  readonly autoFocal?: boolean;
  /** Smooth the corners with {@link createCornerFilter}; default true. */
  readonly smoothing?: boolean;
}

/**
 * Creates the per-frame pipeline. `process(frame)`, following §5.4:
 * 1. resets all state when the frame's width or height differs from the previous frame's;
 * 2. converts the frame to grey and runs `findChessboardCorners(gray, 9, 6, { previous })`, where
 *    `previous` is the previous frame's raw (unsmoothed) corners;
 * 3. when the board is not found, returns `found` false with `corners` and `pose` null, resets the
 *    corner filter, and reports the intrinsics the focal tracker currently gives;
 * 4. when it is found: with `autoFocal`, adds `estimateFocal(boardCorners(), raw, width, height)` to
 *    the focal tracker; builds K with fx = fy = the tracker's focal length at this width,
 *    cx = (width − 1) / 2 and cy = (height − 1) / 2; smooths the corners when `smoothing` is on; and
 *    solves `pose = solvePlanarPnP(boardCorners(), smoothed, K)`. A null pose makes the frame count
 *    as not found, but its raw corners remain the next frame's hint (OQ-33).
 *
 * The smoothing is `createCornerFilter()` with its default parameters, and the focal tracker is
 * `createFocalTracker({ hfovDeg })` with the other options at their defaults (OQ-75).
 *
 * The pipeline keeps no reference to the arrays it returns, so callers may transfer them, and the
 * same frame sequence always gives the same outputs apart from `ms`. `reset()` clears tracking,
 * smoothing and focal state.
 *
 * @throws RangeError on creation if hfovDeg is outside (0, 180) (OQ-32). `process` throws RangeError
 *   for a frame whose width or height is not a positive integer or whose `rgba` does not hold
 *   4 · width · height bytes, and then leaves the pipeline state unchanged (OQ-35).
 */
export function createPipeline(options?: PipelineOptions): { process(frame: FrameInput): FrameOutput; reset(): void } {
  const hfovDeg = options?.hfovDeg ?? 60;
  if (!(hfovDeg > 0 && hfovDeg < 180)) throw new RangeError("createPipeline: hfovDeg must lie in (0, 180)");
  const autoFocal = options?.autoFocal ?? true;
  const smoothing = options?.smoothing ?? true;
  const object = boardCorners();
  const filter = createCornerFilter();
  const tracker = createFocalTracker({ hfovDeg });
  // The previous frame's raw corners: the detector's own array, which is never handed out, so a
  // caller transferring an output cannot detach it
  let hint: Float32Array | null = null;
  let size: readonly [number, number] | null = null;
  let gray = new Uint8Array(0); // reused between frames; never handed out either
  const reset = (): void => {
    filter.reset();
    tracker.reset();
    hint = null;
  };
  return {
    process(frame: FrameInput): FrameOutput {
      const start = performance.now();
      const { width, height, rgba, time } = frame;
      // Checked before anything changes, so a malformed frame leaves the state as it was (OQ-35)
      if (!isPositiveInteger(width) || !isPositiveInteger(height) || rgba.length !== 4 * width * height) {
        throw new RangeError("process: a frame needs positive integer width and height and 4 · width · height bytes");
      }
      if (size !== null && (size[0] !== width || size[1] !== height)) reset();
      size = [width, height];
      if (gray.length !== width * height) gray = new Uint8Array(width * height);
      const raw = findChessboardCorners(rgbaToGray(rgba, width, height, gray), 9, 6, { previous: hint });
      // A lost frame drops the hint; a frame whose pose fails keeps its raw corners as the hint (OQ-33)
      hint = raw;
      if (raw !== null && autoFocal) tracker.add(estimateFocal(object, raw, width, height));
      const f = tracker.focal(width);
      const intrinsics = { fx: f, fy: f, cx: (width - 1) / 2, cy: (height - 1) / 2 };
      const corners = raw === null ? null : smoothing ? filter.apply(raw, time) : raw.slice();
      const pose = corners === null ? null : solvePlanarPnP(object, corners, intrinsics);
      if (pose === null) filter.reset(); // the frame counts as not found
      return { found: pose !== null, corners: pose === null ? null : corners, pose, intrinsics, ms: performance.now() - start };
    },
    reset,
  };
}

/** One Euro filter parameters for {@link createCornerFilter}; cutoffs in Hz. */
export interface CornerFilterOptions {
  /** Cutoff frequency at rest; default 1.0. */
  readonly minCutoff?: number;
  /** How fast the cutoff rises with speed; default 0.05. */
  readonly beta?: number;
  /** Cutoff frequency of the speed estimate; default 1.0. */
  readonly dCutoff?: number;
}

/**
 * A One Euro filter applied to each coordinate independently, with `time` in milliseconds like
 * `FrameInput.time` (OQ-01).
 *
 * `apply(corners, time)` returns a copy of its input and restarts the filter from it on the first
 * call after creation or `reset()`, when the array length differs from the previous call's, and when
 * `time` is not later than the previous call's. It returns a new array on every call and never
 * modifies its input. At 30 fps, a static board with σ = 0.3 px jitter comes out with at most half
 * the input's standard deviation after the first 10 frames (OQ-28), and after a noise-free step of
 * 12 px or more every corner is within 0.5 px of its new position from the 6th output on (OQ-29).
 *
 * @throws RangeError on creation if minCutoff or dCutoff is not positive and finite, or beta is not
 *   finite and ≥ 0 (OQ-32).
 */
export function createCornerFilter(options?: CornerFilterOptions): {
  apply(corners: Float32Array, time: number): Float32Array;
  reset(): void;
} {
  const minCutoff = options?.minCutoff ?? 1;
  const beta = options?.beta ?? 0.05;
  const dCutoff = options?.dCutoff ?? 1;
  if (!isPositiveFinite(minCutoff) || !isPositiveFinite(dCutoff) || !(beta >= 0 && beta < Infinity)) {
    throw new RangeError("createCornerFilter: minCutoff and dCutoff must be positive and finite, and beta finite and ≥ 0");
  }
  // The previous output (a private copy, so outputs may be transferred), each coordinate's smoothed
  // speed in px/s, and the previous call's time
  let value: Float32Array | null = null;
  let speed = new Float64Array(0);
  let last = 0;
  return {
    apply(corners: Float32Array, time: number): Float32Array {
      if (value === null || corners.length !== value.length || !(time > last)) {
        value = corners.slice();
        speed = new Float64Array(corners.length);
      } else {
        const dt = (time - last) / 1000;
        const speedAlpha = lowPassAlpha(dCutoff, dt);
        for (let c = 0; c < corners.length; c++) {
          // The speed is measured against the previous filtered value, not the previous input (§7):
          // a step then raises the cutoff for as long as the output lags, not just for one frame
          speed[c] += speedAlpha * ((corners[c] - value[c]) / dt - speed[c]);
          // value and the input are float32, so their difference is exact and the rounded result
          // cannot leave the interval between the previous output and the input
          value[c] += lowPassAlpha(minCutoff + beta * Math.abs(speed[c]), dt) * (corners[c] - value[c]);
        }
      }
      last = time;
      return value.slice();
    },
    reset(): void {
      value = null;
    },
  };
}

// The smoothing factor 1 − exp(−2π · cutoff · dt) of a first-order low-pass sampled every dt seconds,
// exact for any frame interval. On the §5.4 test signals at the default parameters it settles a 12 px
// step within 0.5 px from the 4th output (6 allowed) and leaves at most 0.43 of σ 0.3 px jitter (0.5
// allowed); Casiez's 1 / (1 + τ / dt) gives 6 and 0.40, with no margin left on the step
const lowPassAlpha = (cutoff: number, dt: number): number => 1 - Math.exp(-2 * Math.PI * cutoff * dt);

/** Options for {@link createFocalTracker}. */
export interface FocalTrackerOptions {
  /** Horizontal field of view in degrees until enough estimates have arrived. */
  readonly hfovDeg: number;
  /** Narrowest field of view the learned focal length may imply, in degrees; default 40. */
  readonly minFovDeg?: number;
  /** Widest field of view the learned focal length may imply, in degrees; default 100. */
  readonly maxFovDeg?: number;
  /** Number of recent estimates the median is taken over; default 15. */
  readonly window?: number;
  /** Estimates needed before the median replaces the default; default 5. */
  readonly minSamples?: number;
}

/**
 * Learns the focal length from per-frame estimates (D1).
 *
 * `focal(width)` is (width / 2) / tan(hfovDeg / 2), unclamped, until `minSamples` estimates have
 * been added; after that, the median of the last `window` estimates (the mean of the two middle
 * values for an even count, OQ-30), clamped to the focal lengths that maxFovDeg and minFovDeg give
 * at that width. `add` ignores null, NaN, ±Infinity, 0 and negative estimates (OQ-31); ignored
 * values neither count towards `minSamples` nor take a place in the window. `reset()` forgets every
 * estimate.
 *
 * @throws RangeError on creation if a field of view is outside (0, 180), minFovDeg ≥ maxFovDeg, or
 *   window or minSamples is not a positive integer (OQ-32).
 */
export function createFocalTracker(options: FocalTrackerOptions): {
  add(estimate: number | null): void;
  focal(width: number): number;
  reset(): void;
} {
  const { hfovDeg, minFovDeg = 40, maxFovDeg = 100, minSamples = 5 } = options;
  const capacity = options.window ?? 15;
  const isFov = (deg: number): boolean => deg > 0 && deg < 180;
  if (![hfovDeg, minFovDeg, maxFovDeg].every(isFov) || !(minFovDeg < maxFovDeg)) {
    throw new RangeError("createFocalTracker: fields of view must lie in (0, 180), with minFovDeg < maxFovDeg");
  }
  if (!isPositiveInteger(capacity) || !isPositiveInteger(minSamples)) {
    throw new RangeError("createFocalTracker: window and minSamples must be positive integers");
  }
  const focalAt = (width: number, fovDeg: number): number => width / 2 / Math.tan((fovDeg * Math.PI) / 360);
  let recent: number[] = []; // the last `capacity` valid estimates, oldest first
  let count = 0; // valid estimates since creation or reset(), which may exceed the window
  return {
    add(estimate: number | null): void {
      if (estimate === null || !(estimate > 0 && estimate < Infinity)) return;
      recent.push(estimate);
      if (recent.length > capacity) recent.shift();
      count++;
    },
    focal(width: number): number {
      if (count < minSamples) return focalAt(width, hfovDeg);
      const sorted = [...recent].sort((a, b) => a - b);
      const m = sorted.length;
      const median = m % 2 === 1 ? sorted[(m - 1) / 2] : (sorted[m / 2 - 1] + sorted[m / 2]) / 2;
      // A wider field of view means a shorter focal length
      return Math.min(focalAt(width, minFovDeg), Math.max(focalAt(width, maxFovDeg), median));
    },
    reset(): void {
      recent = [];
      count = 0;
    },
  };
}

/** A message from the main thread to the tracking worker. */
export type WorkerRequest =
  | {
      readonly type: "frame";
      readonly id: number;
      readonly width: number;
      readonly height: number;
      /** The frame's RGBA bytes, transferred. */
      readonly buffer: ArrayBuffer;
      /** Capture time in milliseconds. */
      readonly time: number;
    }
  | { readonly type: "reset" };

/** A message from the tracking worker to the main thread. */
export type WorkerResponse =
  | {
      readonly type: "result";
      readonly id: number;
      readonly found: boolean;
      readonly corners: Float32Array | null;
      /** The pose with R (row-major) and t as plain arrays. */
      readonly pose: { readonly R: number[]; readonly t: number[]; readonly rms: number } | null;
      readonly intrinsics: Intrinsics;
      readonly ms: number;
      /** The frame's buffer, handed back so the main thread can reuse it. */
      readonly buffer: ArrayBuffer;
    }
  | { readonly type: "error"; readonly id: number; readonly message: string };

/**
 * Handles one message inside the worker.
 *
 * A `frame` message wraps `buffer` as RGBA, calls `pipeline.process` and replies with a `result`
 * carrying the output, with the pose as plain arrays, and the same `buffer` back; `transfer` holds
 * that buffer and the corners' buffer. A `reset` message calls `pipeline.reset()` and returns null,
 * and so does any other message, a non-object included, without calling the pipeline (OQ-36). An
 * exception thrown by `process` becomes `{ type: "error", id, message }` with an empty transfer
 * list, where `message` is the `message` of an `Error` and `String(value)` of anything else.
 */
export function handleWorkerMessage(
  pipeline: ReturnType<typeof createPipeline>,
  message: WorkerRequest,
): { reply: WorkerResponse; transfer: Transferable[] } | null {
  if (typeof message !== "object" || message === null) return null;
  if (message.type === "reset") {
    pipeline.reset();
    return null;
  }
  if (message.type !== "frame") return null;
  const { id, width, height, buffer, time } = message;
  try {
    const { found, corners, pose, intrinsics, ms } = pipeline.process({ width, height, rgba: new Uint8ClampedArray(buffer), time });
    const plainPose = pose === null ? null : { R: Array.from(pose.R), t: Array.from(pose.t), rms: pose.rms };
    // postMessage rejects a buffer listed twice, which corners over the frame's own buffer would cause
    const transfer: Transferable[] = [buffer];
    if (corners !== null && corners.buffer !== buffer) transfer.push(corners.buffer);
    return { reply: { type: "result", id, found, corners, pose: plainPose, intrinsics, ms, buffer }, transfer };
  } catch (error) {
    return { reply: { type: "error", id, message: error instanceof Error ? error.message : String(error) }, transfer: [] };
  }
}

const isPositiveInteger = (value: number): boolean => Number.isInteger(value) && value > 0;
const isPositiveFinite = (value: number): boolean => value > 0 && value < Infinity;

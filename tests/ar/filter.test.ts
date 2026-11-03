// P2 contract tests for the corner filter and the focal tracker of src/ar/pipeline.ts:
// docs/design_camera_ar.md §5.4 and §14 (OQ-01, OQ-27–OQ-31); test plan §4.5 and §4.6.

import { describe, expect, it } from "vitest";
import { createCornerFilter, createFocalTracker } from "@/ar/pipeline";
import { type Signal, jitterSignal, movingSignal, randomSignal, restCorners, stepSignal } from "./helpers/filterInputs";
import { FRAME_MS } from "./helpers/frames";
import { bytesOf } from "./helpers/metrics";
import { createRng, seedFor } from "./helpers/random";

type CornerFilter = ReturnType<typeof createCornerFilter>;

const DEG = Math.PI / 180;
const focalAt = (width: number, fovDeg: number): number => width / 2 / Math.tan((fovDeg / 2) * DEG);

function expectRelative(actual: number, expected: number, tolerance: number, label: string): void {
  expect(Math.abs(actual - expected), `${label}: ${actual} vs ${expected}`).toBeLessThanOrEqual(tolerance * Math.abs(expected));
}

/** A literal from the test plan, given to `decimals` places: within half a unit of its last digit. */
function expectLiteral(actual: number, literal: number, decimals: number, label: string): void {
  expect(Math.abs(actual - literal), `${label}: ${actual} vs ${literal}`).toBeLessThanOrEqual(0.5 * 10 ** -decimals);
}

/** Feeds a signal through a filter and returns every output. */
function filterAll(filter: CornerFilter, signal: Signal): Float32Array[] {
  return signal.frames.map((frame, k) => filter.apply(frame, signal.times[k]));
}

/** Largest per-corner Euclidean distance between two corner arrays. */
function worstCornerDistance(a: ArrayLike<number>, b: ArrayLike<number>): number {
  let worst = 0;
  for (let k = 0; k < a.length / 2; k++) worst = Math.max(worst, Math.hypot(a[2 * k] - b[2 * k], a[2 * k + 1] - b[2 * k + 1]));
  return worst;
}

const shifted = (corners: Float32Array, dx: number, dy: number): Float32Array => corners.map((value, m) => value + (m % 2 === 0 ? dx : dy));

/** Population standard deviation. */
function std(values: readonly number[]): number {
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  return Math.sqrt(values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length);
}

/**
 * Restart semantics (§5.4): after a call that returns a copy of `start` at `time`, the filter must
 * continue exactly like a fresh filter that was started with the same call.
 */
function expectRestartedLike(filter: CornerFilter, start: Float32Array, time: number, next: Float32Array[], label: string): void {
  const fresh = createCornerFilter();
  expect(fresh.apply(start, time), `${label}: fresh start`).toEqual(start);
  next.forEach((frame, k) => {
    const at = time + (k + 1) * FRAME_MS;
    expect(filter.apply(frame, at), `${label}: call ${k + 1} after the restart`).toEqual(fresh.apply(frame, at));
  });
}

describe("createCornerFilter (§5.4)", () => {
  it("P2-CF-01 the first call returns a copy of its input in a new array", () => {
    for (const corners of [restCorners(), Float32Array.of(12.5, -3, 400.25), new Float32Array(0)]) {
      const filter = createCornerFilter();
      const out = filter.apply(corners, 1234);
      expect(out).toBeInstanceOf(Float32Array);
      expect(out).toEqual(corners);
      expect(out).not.toBe(corners);
      if (corners.length > 0) expect(out.buffer).not.toBe(corners.buffer);
    }
  });

  it("P2-CF-02 after reset() a far-away input comes back exactly, and filtering restarts from it", () => {
    const filter = createCornerFilter();
    const rest = restCorners();
    for (let k = 0; k < 30; k++) filter.apply(rest, k * FRAME_MS);
    filter.reset();
    const far = shifted(rest, 300, -150);
    const time = 30 * FRAME_MS;
    expect(filter.apply(far, time)).toEqual(far);
    expectRestartedLike(filter, far, time, [shifted(far, 5, 0), shifted(far, 9, 2), shifted(far, 12, 3)], "after reset()");
  });

  it("P2-CF-03 a change of array length returns a copy, and later calls smooth from that new start", () => {
    const filter = createCornerFilter();
    const long = movingSignal("P2-CF-03 long", 12);
    const short = Float32Array.of(10, 20, 30, 40, 50, 60, 70, 80, 90, 100);
    for (let k = 0; k < 6; k++) filter.apply(long.frames[k], long.times[k]);
    // 108 → 10 values
    let time = 6 * FRAME_MS;
    expect(filter.apply(short, time), "108 → 10").toEqual(short);
    const shortNext = [shifted(short, 4, 4), shifted(short, 7, 7)];
    const smoothed = filter.apply(shortNext[0], time + FRAME_MS);
    expect(smoothed, "the call after the change is smoothed").not.toEqual(shortNext[0]);
    const fresh = createCornerFilter();
    fresh.apply(short, time);
    expect(smoothed, "the call after the change starts from the new array").toEqual(fresh.apply(shortNext[0], time + FRAME_MS));
    // 10 → 108 values
    time += 2 * FRAME_MS;
    expect(filter.apply(long.frames[8], time), "10 → 108").toEqual(long.frames[8]);
    expectRestartedLike(filter, long.frames[8], time, [long.frames[9], long.frames[10], long.frames[11]], "after 10 → 108");
  });

  it("P2-CF-04 a time that is not later than the previous call's returns a copy and restarts the filter", () => {
    const filter = createCornerFilter();
    const signal = movingSignal("P2-CF-04", 12);
    for (let k = 0; k < 6; k++) filter.apply(signal.frames[k], signal.times[k]);
    const same = signal.times[5];
    expect(filter.apply(signal.frames[6], same), "the same time twice").toEqual(signal.frames[6]);
    expectRestartedLike(filter, signal.frames[6], same, [signal.frames[7], signal.frames[8]], "after the same time");
    const earlier = signal.times[2];
    expect(filter.apply(signal.frames[9], earlier), "an earlier time").toEqual(signal.frames[9]);
    expectRestartedLike(filter, signal.frames[9], earlier, [signal.frames[10], signal.frames[11]], "after an earlier time");
  });

  it("P2-CF-05 a constant input comes out unchanged on every call", () => {
    const filter = createCornerFilter();
    const corners = movingSignal("P2-CF-05", 1).frames[0];
    for (let k = 0; k < 100; k++) expect(filter.apply(corners, k * FRAME_MS), `frame ${k}`).toEqual(corners);
  });

  it("P2-CF-06 each coordinate is filtered on its own: one array equals separate one-coordinate filters (OQ-72)", () => {
    const rng = createRng(seedFor("P2-CF-06"));
    // The pair a static and b moving at 300 px/s, and the same pair with a jittering by σ 0.3 px: a
    // static coordinate comes out unchanged whatever its cutoff, so only the jitter reveals a speed
    // estimate shared across coordinates (OQ-72)
    for (const jitter of [0, 0.3]) {
      const joint = createCornerFilter();
      const alone = [createCornerFilter(), createCornerFilter()];
      for (let k = 0; k < 120; k++) {
        const time = k * FRAME_MS;
        const a = 100 + jitter * rng.gaussian();
        const b = 50 + 300 * (time / 1000);
        const out = joint.apply(Float32Array.of(a, b), time);
        const outA = alone[0].apply(Float32Array.of(a), time);
        const outB = alone[1].apply(Float32Array.of(b), time);
        expect(Math.abs(out[0] - outA[0]), `jitter ${jitter}, frame ${k}, coordinate a`).toBeLessThanOrEqual(1e-12);
        expect(Math.abs(out[1] - outB[0]), `jitter ${jitter}, frame ${k}, coordinate b`).toBeLessThanOrEqual(1e-12);
      }
    }
  });

  it("P2-CF-07 every output lies between the previous output and the current input, so steps never overshoot", () => {
    const check = (signal: Signal, label: string): Float32Array[] => {
      const outputs = filterAll(createCornerFilter(), signal);
      for (let k = 1; k < outputs.length; k++) {
        for (let c = 0; c < outputs[k].length; c++) {
          const low = Math.min(outputs[k - 1][c], signal.frames[k][c]);
          const high = Math.max(outputs[k - 1][c], signal.frames[k][c]);
          if (!(outputs[k][c] >= low && outputs[k][c] <= high)) {
            expect.fail(`${label}, frame ${k}, coordinate ${c}: ${outputs[k][c]} is outside [${low}, ${high}]`);
          }
        }
      }
      return outputs;
    };
    check(randomSignal("P2-CF-07"), "random frames");
    for (const [dx, dy] of [
      [12, 0],
      [-50, 30],
    ]) {
      const step = stepSignal(dx, dy);
      const outputs = check(step, `step (${dx}, ${dy})`);
      const rest = restCorners();
      for (let k = 30; k < outputs.length; k++) {
        for (let c = 0; c < 108; c++) {
          expect((outputs[k][c] - step.target[c]) * (rest[c] - step.target[c]), `step (${dx}, ${dy}), frame ${k}, coordinate ${c}`).toBeGreaterThanOrEqual(0);
        }
      }
    }
  });

  it("P2-CF-08 σ 0.3 px jitter at 30 fps: every coordinate's output std over frames 11–300 is at most half its input's (OQ-28)", () => {
    const signal = jitterSignal("P2-CF-08");
    const outputs = filterAll(createCornerFilter(), signal);
    for (let c = 0; c < 108; c++) {
      const input = std(signal.frames.slice(10).map((frame) => frame[c]));
      const output = std(outputs.slice(10).map((frame) => frame[c]));
      expect(output / input, `coordinate ${c}: output std / input std`).toBeLessThanOrEqual(0.5);
    }
  });

  it("P2-CF-09 after a noise-free 12 px step every corner is within 0.5 px of its new position from the 6th output on (OQ-29)", () => {
    for (const [name, dx, dy] of [
      ["+12 px in x", 12, 0],
      ["−12 px in y", 0, -12],
      ["12 px diagonally", 12 / Math.SQRT2, 12 / Math.SQRT2],
    ] as const) {
      const step = stepSignal(dx, dy);
      const outputs = filterAll(createCornerFilter(), step);
      for (let k = 6; k <= 30; k++) {
        expect(worstCornerDistance(outputs[30 + k - 1], step.target), `${name}: output ${k} at the new position (px)`).toBeLessThanOrEqual(0.5);
      }
    }
  });

  it("P2-CF-10 the same holds for 50 px and 200 px steps", () => {
    for (const size of [50, 200]) {
      for (const [name, dx, dy] of [
        ["in x", size, 0],
        ["diagonally", size / Math.SQRT2, -size / Math.SQRT2],
      ] as const) {
        const step = stepSignal(dx, dy);
        const outputs = filterAll(createCornerFilter(), step);
        for (let k = 6; k <= 30; k++) {
          expect(worstCornerDistance(outputs[30 + k - 1], step.target), `${size} px ${name}: output ${k} (px)`).toBeLessThanOrEqual(0.5);
        }
      }
    }
  });

  it("P2-CF-11 options are honoured: minCutoff 1e6 follows the input, minCutoff 0.01 with beta 0 barely moves", () => {
    const moving = movingSignal("P2-CF-11");
    const fast = createCornerFilter({ minCutoff: 1e6 });
    moving.frames.forEach((frame, k) => {
      const out = fast.apply(frame, moving.times[k]);
      let worst = 0;
      for (let c = 0; c < frame.length; c++) worst = Math.max(worst, Math.abs(out[c] - frame[c]));
      expect(worst, `minCutoff 1e6, frame ${k}: max |out − in| (px)`).toBeLessThanOrEqual(1e-3);
    });
    const step = stepSignal(12, 0, 30, 10);
    const outputs = filterAll(createCornerFilter({ minCutoff: 0.01, beta: 0 }), step);
    const rest = restCorners();
    for (let k = 30; k < 40; k++) {
      expect(worstCornerDistance(outputs[k], rest), `minCutoff 0.01, beta 0: output ${k - 29} after a 12 px step, distance moved (px)`).toBeLessThan(1);
    }
  });

  it("P2-CF-12 every call returns a new array and leaves its input untouched", () => {
    const filter = createCornerFilter();
    const signal = movingSignal("P2-CF-12", 8);
    let previous: Float32Array | null = null;
    signal.frames.forEach((frame, k) => {
      const before = bytesOf(frame);
      const out = filter.apply(frame, signal.times[k]);
      expect(bytesOf(frame), `frame ${k}: input bytes`).toEqual(before);
      expect(out, `frame ${k}`).not.toBe(frame);
      expect(out.buffer, `frame ${k}`).not.toBe(frame.buffer);
      if (previous) {
        expect(out, `frame ${k} vs the previous output`).not.toBe(previous);
        expect(out.buffer, `frame ${k} vs the previous output`).not.toBe(previous.buffer);
      }
      previous = out;
    });
  });
});

describe("createFocalTracker (§5.4)", () => {
  /** Adds the estimates one by one and returns focal(width) after each. */
  const feed = (tracker: ReturnType<typeof createFocalTracker>, estimates: readonly (number | null)[], width = 640): number[] =>
    estimates.map((estimate) => {
      tracker.add(estimate);
      return tracker.focal(width);
    });

  it("P2-FT-01 until minSamples estimates arrive, focal(width) is (width / 2) / tan(hfov / 2)", () => {
    const tracker = createFocalTracker({ hfovDeg: 60 });
    expectLiteral(tracker.focal(640), 554.2562584, 7, "hfov 60°, width 640");
    expectRelative(tracker.focal(640), focalAt(640, 60), 1e-12, "hfov 60°, width 640, formula");
    expectLiteral(tracker.focal(360), 311.7691454, 7, "hfov 60°, width 360");
    expectRelative(tracker.focal(360), focalAt(360, 60), 1e-12, "hfov 60°, width 360, formula");
    const wide = createFocalTracker({ hfovDeg: 75 });
    expectLiteral(wide.focal(640), 417.0321, 4, "hfov 75°, width 640");
    expectRelative(wide.focal(640), focalAt(640, 75), 1e-12, "hfov 75°, width 640, formula");
  });

  it("P2-FT-02 the median replaces the default at the 5th estimate", () => {
    const tracker = createFocalTracker({ hfovDeg: 60 });
    const values = feed(tracker, [500, 510, 490, 520]);
    for (const value of values) expectRelative(value, focalAt(640, 60), 1e-12, "before the 5th estimate");
    tracker.add(480);
    expectRelative(tracker.focal(640), 500, 1e-12, "after the 5th estimate");
  });

  it("P2-FT-03 add(null) is ignored: nulls neither count towards minSamples nor take window slots", () => {
    const tracker = createFocalTracker({ hfovDeg: 60 });
    feed(tracker, [500, null, 510, null, null, 490, 520]);
    expectRelative(tracker.focal(640), focalAt(640, 60), 1e-12, "4 estimates and 3 nulls");
    tracker.add(480);
    expectRelative(tracker.focal(640), 500, 1e-12, "the 5th estimate");
    const small = createFocalTracker({ hfovDeg: 60, window: 3, minSamples: 3 });
    feed(small, [500, null, 510, null]);
    expectRelative(small.focal(640), focalAt(640, 60), 1e-12, "window 3: 2 estimates and 2 nulls");
    small.add(520);
    expectRelative(small.focal(640), 510, 1e-12, "window 3: the 3rd estimate");
    feed(small, [null, null]);
    expectRelative(small.focal(640), 510, 1e-12, "window 3: nulls take no slots");
    small.add(600);
    expectRelative(small.focal(640), 520, 1e-12, "window 3: the last three estimates are 510, 520, 600");
  });

  it("P2-FT-04 the median covers the last 15 estimates", () => {
    const tracker = createFocalTracker({ hfovDeg: 60 });
    feed(tracker, [...Array<number>(5).fill(1000), ...Array<number>(15).fill(500)]);
    expectRelative(tracker.focal(640), 500, 1e-12, "5 × 1000, then 15 × 500");
    tracker.add(1000);
    expectRelative(tracker.focal(640), 500, 1e-12, "one more 1000");
  });

  it("P2-FT-05 the median of 7 and of 15 unsorted estimates is the middle value", () => {
    const seven = createFocalTracker({ hfovDeg: 60 });
    feed(seven, [520, 480, 505, 495, 530, 470, 500]);
    expectRelative(seven.focal(640), 500, 1e-12, "7 estimates");
    const rng = createRng(seedFor("P2-FT-05"));
    const values = Array.from({ length: 15 }, (_, k) => 450 + 13 * k);
    for (let k = values.length - 1; k > 0; k--) {
      const m = rng.int(k + 1);
      [values[k], values[m]] = [values[m], values[k]];
    }
    const fifteen = createFocalTracker({ hfovDeg: 60 });
    feed(fifteen, values);
    expectRelative(fifteen.focal(640), 450 + 13 * 7, 1e-12, `15 estimates in the order ${values.join(", ")}`);
  });

  it("P2-FT-06 an even count gives the mean of the two middle values (OQ-30)", () => {
    const six = createFocalTracker({ hfovDeg: 60 });
    feed(six, [100, 200, 300, 400, 500, 600]);
    expectRelative(six.focal(640), 350, 1e-12, "100, 200, …, 600");
    const eight = createFocalTracker({ hfovDeg: 60 });
    feed(eight, [510, 470, 530, 490, 500, 520, 480, 540]);
    expectRelative(eight.focal(640), 505, 1e-12, "8 estimates: the 4th and 5th smallest are 500 and 510");
    const window4 = createFocalTracker({ hfovDeg: 60, window: 4, minSamples: 1 });
    feed(window4, [300, 400, 500, 600, 700]);
    expectRelative(window4.focal(640), 550, 1e-12, "window 4: the last four are 400, 500, 600, 700");
  });

  it("P2-FT-07 the median is clamped to the focal lengths of 100° and 40° at the queried width", () => {
    const large = createFocalTracker({ hfovDeg: 60 });
    feed(large, Array<number>(5).fill(1e6));
    expectLiteral(large.focal(640), 879.1928, 4, "estimates of 1e6 at width 640");
    expectRelative(large.focal(640), focalAt(640, 40), 1e-12, "estimates of 1e6, formula");
    const small = createFocalTracker({ hfovDeg: 60 });
    feed(small, Array<number>(5).fill(1));
    expectLiteral(small.focal(640), 268.5119, 4, "estimates of 1 at width 640");
    expectRelative(small.focal(640), focalAt(640, 100), 1e-12, "estimates of 1, formula");
    const narrow = createFocalTracker({ hfovDeg: 60 });
    feed(narrow, Array<number>(5).fill(500));
    expectRelative(narrow.focal(640), 500, 1e-12, "a median of 500 at width 640");
    expectLiteral(narrow.focal(320), 439.5964, 4, "a median of 500 at width 320");
    expectRelative(narrow.focal(320), focalAt(320, 40), 1e-12, "a median of 500 at width 320, formula");
  });

  it("P2-FT-08 window, minSamples, minFovDeg, maxFovDeg and hfovDeg are honoured", () => {
    const tracker = createFocalTracker({ hfovDeg: 60, window: 3, minSamples: 1, minFovDeg: 50, maxFovDeg: 90 });
    tracker.add(500);
    expectRelative(tracker.focal(640), 500, 1e-12, "minSamples 1");
    feed(tracker, [510, 490]);
    expectRelative(tracker.focal(640), 500, 1e-12, "500, 510, 490");
    tracker.add(600);
    expectRelative(tracker.focal(640), 510, 1e-12, "window 3: 510, 490, 600");
    feed(tracker, [1000, 1000, 1000]);
    expectRelative(tracker.focal(640), focalAt(640, 50), 1e-12, "clamped at minFovDeg 50");
    feed(tracker, [100, 100, 100]);
    expectRelative(tracker.focal(640), focalAt(640, 90), 1e-12, "clamped at maxFovDeg 90");
    const slow = createFocalTracker({ hfovDeg: 70, minSamples: 3 });
    feed(slow, [400, 410]);
    expectRelative(slow.focal(640), focalAt(640, 70), 1e-12, "hfovDeg 70 before minSamples 3");
    slow.add(420);
    expectRelative(slow.focal(640), 410, 1e-12, "minSamples 3 reached");
  });

  it("P2-FT-09 reset() forgets every estimate", () => {
    const tracker = createFocalTracker({ hfovDeg: 60 });
    feed(tracker, Array<number>(5).fill(500));
    expectRelative(tracker.focal(640), 500, 1e-12, "learned");
    tracker.reset();
    expectRelative(tracker.focal(640), focalAt(640, 60), 1e-12, "after reset()");
    const values = feed(tracker, [400, 400, 400, 400]);
    for (const value of values) expectRelative(value, focalAt(640, 60), 1e-12, "4 new estimates");
    tracker.add(400);
    expectRelative(tracker.focal(640), 400, 1e-12, "the 5th new estimate; the old ones are gone");
  });

  it("P2-FT-10 the default focal length is not clamped", () => {
    const tracker = createFocalTracker({ hfovDeg: 30 });
    expectLiteral(tracker.focal(640), 1194.2563, 4, "hfov 30°, width 640");
    expectRelative(tracker.focal(640), focalAt(640, 30), 1e-12, "hfov 30°, width 640, formula");
  });

  it("P2-FT-11 NaN, ±Infinity, 0 and negative estimates are ignored like null (OQ-31)", () => {
    const tracker = createFocalTracker({ hfovDeg: 60 });
    feed(tracker, [500, NaN, 510, Infinity, -Infinity, 490, 0, 520, -1]);
    expectRelative(tracker.focal(640), focalAt(640, 60), 1e-12, "4 estimates and 5 invalid values");
    tracker.add(480);
    expectRelative(tracker.focal(640), 500, 1e-12, "the 5th estimate");
    const small = createFocalTracker({ hfovDeg: 60, window: 3, minSamples: 3 });
    feed(small, [500, NaN, 510, 0, 520, -Infinity, -5, Infinity]);
    expectRelative(small.focal(640), 510, 1e-12, "window 3: invalid values take no slots");
  });
});

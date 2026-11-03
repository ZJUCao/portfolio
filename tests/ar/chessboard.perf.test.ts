// P1 performance smoke test for findChessboardCorners (docs/design_camera_ar.md §5.2 "Performance",
// test plan §3.4). Wall-clock medians in the default suite, with bounds 3× the targets (OQ-05):
// 90 ms for full detection, 15 ms with a valid hint, 90 ms for a frame without a board (OQ-16).

import { describe, expect, it } from "vitest";
import { findChessboardCorners } from "@/ar/chessboard";
import { noBoardPerfScene, perfHintMotion, renderItem, s0 } from "./helpers/catalog";

const SLOW = { timeout: 120_000 };

function medianMs(run: () => unknown, warmUp = 3, runs = 15): number {
  for (let k = 0; k < warmUp; k++) run();
  const times: number[] = [];
  for (let k = 0; k < runs; k++) {
    const start = performance.now();
    run();
    times.push(performance.now() - start);
  }
  times.sort((a, b) => a - b);
  return times[Math.floor(runs / 2)];
}

describe("findChessboardCorners: performance smoke test (§5.2, §9)", () => {
  it("P1-PERF-01 full detection on a 640×360 frame: median ≤ 90 ms (target 30 ms)", SLOW, () => {
    const { image } = renderItem(s0());
    expect(findChessboardCorners(image, 9, 6), "the timed frame must contain a detectable board").not.toBeNull();
    const median = medianMs(() => findChessboardCorners(image, 9, 6));
    console.info(`P1-PERF-01 full detection median ${median.toFixed(1)} ms`);
    expect(median).toBeLessThanOrEqual(90);
  });

  it("P1-PERF-02 with the previous frame's corners as hint: median ≤ 15 ms (target 5 ms)", SLOW, () => {
    const previous = findChessboardCorners(renderItem(s0()).image, 9, 6);
    expect(previous, "previous frame").not.toBeNull();
    const { image } = renderItem(perfHintMotion());
    expect(findChessboardCorners(image, 9, 6, { previous }), "the timed frame must contain a detectable board").not.toBeNull();
    const median = medianMs(() => findChessboardCorners(image, 9, 6, { previous }));
    console.info(`P1-PERF-02 tracking median ${median.toFixed(1)} ms`);
    expect(median).toBeLessThanOrEqual(15);
  });

  it("P1-PERF-03 a 640×360 frame without a board: median ≤ 90 ms (OQ-16)", SLOW, () => {
    const { image } = renderItem(noBoardPerfScene());
    expect(findChessboardCorners(image, 9, 6), "the timed frame has no board").toBeNull();
    const median = medianMs(() => findChessboardCorners(image, 9, 6));
    console.info(`P1-PERF-03 no-board median ${median.toFixed(1)} ms`);
    expect(median).toBeLessThanOrEqual(90);
  });
});

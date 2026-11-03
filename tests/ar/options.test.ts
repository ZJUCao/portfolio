// P2 contract test for the option checks of src/ar/pipeline.ts: docs/design_camera_ar.md §5.4 and
// §14 (OQ-32); test plan §4.9.

import { describe, expect, it } from "vitest";
import { createCornerFilter, createFocalTracker, createPipeline } from "@/ar/pipeline";
import { expectRangeError } from "./helpers/metrics";

describe("option validation (§5.4)", () => {
  it("P2-OPT-01 invalid options throw RangeError on creation; boundary values are accepted (OQ-32)", () => {
    for (const hfovDeg of [0, 180, -1, 181, NaN, Infinity]) expectRangeError(() => createPipeline({ hfovDeg }), `createPipeline hfovDeg ${hfovDeg}`);
    for (const minCutoff of [0, -1, NaN, Infinity]) expectRangeError(() => createCornerFilter({ minCutoff }), `createCornerFilter minCutoff ${minCutoff}`);
    for (const dCutoff of [0, -1, NaN, Infinity]) expectRangeError(() => createCornerFilter({ dCutoff }), `createCornerFilter dCutoff ${dCutoff}`);
    for (const beta of [-0.01, NaN, Infinity]) expectRangeError(() => createCornerFilter({ beta }), `createCornerFilter beta ${beta}`);
    for (const hfovDeg of [0, 180, NaN]) expectRangeError(() => createFocalTracker({ hfovDeg }), `createFocalTracker hfovDeg ${hfovDeg}`);
    for (const window of [0, -1, 1.5, NaN, Infinity]) expectRangeError(() => createFocalTracker({ hfovDeg: 60, window }), `createFocalTracker window ${window}`);
    for (const minSamples of [0, -1, 2.5, NaN]) expectRangeError(() => createFocalTracker({ hfovDeg: 60, minSamples }), `createFocalTracker minSamples ${minSamples}`);
    for (const [minFovDeg, maxFovDeg] of [
      [60, 60],
      [80, 50],
      [0, 100],
      [40, 180],
      [NaN, 100],
      [40, NaN],
    ]) {
      expectRangeError(() => createFocalTracker({ hfovDeg: 60, minFovDeg, maxFovDeg }), `createFocalTracker minFovDeg ${minFovDeg}, maxFovDeg ${maxFovDeg}`);
    }
    expectRangeError(() => createFocalTracker({ hfovDeg: 60, minFovDeg: 120 }), "minFovDeg 120 against the default maxFovDeg 100");
    expectRangeError(() => createFocalTracker({ hfovDeg: 60, maxFovDeg: 30 }), "maxFovDeg 30 against the default minFovDeg 40");
    // Boundary values inside the rules are accepted
    expect(() => createPipeline({ hfovDeg: 179.5 })).not.toThrow();
    expect(() => createCornerFilter({ beta: 0 })).not.toThrow();
    expect(() => createFocalTracker({ hfovDeg: 30, window: 1, minSamples: 1, minFovDeg: 1, maxFovDeg: 179 })).not.toThrow();
  });
});

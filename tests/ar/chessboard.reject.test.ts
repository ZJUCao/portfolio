// P1 contract tests for src/ar/chessboard.ts, part 2: rejection (a)–(d), "null over a wrong
// answer" and the near-border allowance. docs/design_camera_ar.md §5.2, test plan §3.3.

import { describe, expect, it } from "vitest";
import { findChessboardCorners } from "@/ar/chessboard";
import {
  type CatalogItem,
  WRONG_REQUESTS,
  cutInsideScenes,
  destroyedCornerScenes,
  largerLatticeScenes,
  nearBorderInsideScenes,
  nearBorderOutsideScenes,
  noBoardScenes,
  occludedScenes,
  outsideScenes,
  partialOcclusionScenes,
  renderItem,
  s0,
  smallerLatticeScenes,
  stressScenes,
  twoBoardsScene,
} from "./helpers/catalog";
import { cornerErrors, expectAccurate, expectNullOrAccurate, expectNullOrIdentityCorrect } from "./helpers/metrics";

const SLOW = { timeout: 120_000 };

function expectAllNull(items: readonly CatalogItem[], request: readonly [number, number] = [9, 6]): void {
  for (const entry of items) {
    const scene = renderItem(entry);
    expect(findChessboardCorners(scene.image, request[0], request[1]), entry.label).toBeNull();
  }
}

describe("findChessboardCorners: rejection (§5.2)", () => {
  it("P1-DET-26 (a) images without a board give null", SLOW, () => {
    expectAllNull(noBoardScenes());
  });

  it("P1-DET-27 (b) any inner corner outside the image gives null", SLOW, () => {
    expectAllNull(outsideScenes());
  });

  it("P1-DET-28 (c) an inner corner covered by a disc of radius 0.4 square, or a bar over a row, gives null", SLOW, () => {
    expectAllNull(occludedScenes());
  });

  it("P1-DET-29 (c) partial occlusion, or an occluder away from every corner: null or accurate (OQ-13)", SLOW, () => {
    for (const entry of partialOcclusionScenes()) {
      const scene = renderItem(entry);
      expectNullOrAccurate(findChessboardCorners(scene.image, 9, 6), scene, entry.label);
    }
  });

  it("P1-DET-30 (d) a larger visible lattice (10×7, 9×7, 10×6 inner corners) gives null for 9×6", SLOW, () => {
    expectAllNull(largerLatticeScenes());
  });

  it("P1-DET-31 (d) a smaller visible lattice (8×5, 8×6, 9×5 inner corners) gives null for 9×6", SLOW, () => {
    expectAllNull(smallerLatticeScenes());
  });

  it("P1-DET-32 (d) requesting another size on the 9×6 board gives null (OQ-09)", SLOW, () => {
    const scene = renderItem(s0());
    for (const [x, y] of WRONG_REQUESTS) expect(findChessboardCorners(scene.image, x, y), `request ${x}×${y}`).toBeNull();
  });

  it("P1-DET-33 (c) a corner destroyed by a square of the wrong colour gives null (OQ-13)", SLOW, () => {
    expectAllNull(destroyedCornerScenes());
  });

  it("P1-DET-34 two complete boards: null, or one of them accurate (OQ-14)", SLOW, () => {
    const { both, left, right } = twoBoardsScene();
    const scene = renderItem(both);
    const result = findChessboardCorners(scene.image, 9, 6);
    if (result === null) return;
    const leftTruth = renderItem(left).truth();
    const rightTruth = renderItem(right).truth();
    const nearer = cornerErrors(result, leftTruth).rms <= cornerErrors(result, rightTruth).rms ? leftTruth : rightTruth;
    expectAccurate(result, { ...scene, truth: () => nearer }, "two boards");
  });

  it("P1-DET-35 60 off-nominal scenes: null or identity-correct, never a wrong lattice (OQ-10)", SLOW, () => {
    for (const entry of stressScenes()) {
      const scene = renderItem(entry);
      expectNullOrIdentityCorrect(findChessboardCorners(scene.image, 9, 6), scene.truth(), 9, 6, entry.label);
    }
  });
});

describe("findChessboardCorners: near the image border (§5.2)", () => {
  it("P1-DET-36 corners 0.5–3 px inside the border, outer squares cut: null or accurate", SLOW, () => {
    for (const entry of nearBorderInsideScenes()) {
      const scene = renderItem(entry);
      expectNullOrAccurate(findChessboardCorners(scene.image, 9, 6), scene, entry.label);
    }
  });

  it("P1-DET-37 corners 0.5–3 px outside the border: null or accurate (OQ-11, two-sided band)", SLOW, () => {
    for (const entry of nearBorderOutsideScenes()) {
      const scene = renderItem(entry);
      expectNullOrAccurate(findChessboardCorners(scene.image, 9, 6), scene, entry.label);
    }
  });

  it("P1-DET-38 outer squares and margin cut, every corner ≥ 4 px inside: null or accurate (OQ-11)", SLOW, () => {
    for (const entry of cutInsideScenes()) {
      const scene = renderItem(entry);
      expectNullOrAccurate(findChessboardCorners(scene.image, 9, 6), scene, entry.label);
    }
  });
});

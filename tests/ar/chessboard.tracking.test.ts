// P1 contract tests for src/ar/chessboard.ts, part 3: the tracking hint, determinism and input
// immutability. docs/design_camera_ar.md §5.2, test plan §3.3.

import { describe, expect, it } from "vitest";
import { findChessboardCorners } from "@/ar/chessboard";
import { cornerXY } from "./helpers/boardModel";
import {
  garbageHints,
  garbageHintScenes,
  largerLatticeScenes,
  nominalSet,
  noBoardScenes,
  occludedScenes,
  oneSquareMotion,
  outsideScenes,
  renderItem,
  s0,
  smallerLatticeScenes,
  smallMotions,
  staleHintScenes,
  stressScenes,
  trackingSequence,
} from "./helpers/catalog";
import { applyHomography } from "./helpers/linalg";
import { bytesOf, expectAccurate, expectLayout, expectNullOrIdentityCorrect, toFloat32 } from "./helpers/metrics";
import { describeScene } from "./helpers/render";

const SLOW = { timeout: 120_000 };

/** Truth of the S0 scene as a hint. */
const s0Hint = (): Float32Array => toFloat32(renderItem(s0()).truth());

/** Rebuilds a hint from a 9×6 truth by mapping each new index (i, j) to an old one. */
function reorder(truth: ArrayLike<number>, map: (i: number, j: number) => [number, number]): Float32Array {
  const out = new Float32Array(108);
  for (let j = 0; j < 6; j++) {
    for (let i = 0; i < 9; i++) {
      const [si, sj] = map(i, j);
      out[2 * (j * 9 + i)] = truth[2 * (sj * 9 + si)];
      out[2 * (j * 9 + i) + 1] = truth[2 * (sj * 9 + si) + 1];
    }
  }
  return out;
}

describe("findChessboardCorners: tracking hint (§5.2)", () => {
  it("P1-DET-39 a correct hint (own result or ground truth) gives an accurate, new result", SLOW, () => {
    const scene = renderItem(s0());
    const own = findChessboardCorners(scene.image, 9, 6);
    expectLayout(own, 9, 6, "without hint");
    const withOwn = findChessboardCorners(scene.image, 9, 6, { previous: own });
    expectAccurate(withOwn, scene, "hint = own result");
    expect(withOwn).not.toBe(own);
    expectAccurate(findChessboardCorners(scene.image, 9, 6, { previous: s0Hint() }), scene, "hint = truth");
  });

  it("P1-DET-40 a board moved ≤ 0.25 square since the hint is found accurately (OQ-15)", SLOW, () => {
    const previous = findChessboardCorners(renderItem(s0()).image, 9, 6);
    expectLayout(previous, 9, 6, "previous frame");
    for (const entry of smallMotions()) {
      const scene = renderItem(entry);
      expectAccurate(findChessboardCorners(scene.image, 9, 6, { previous }), scene, entry.label);
    }
  });

  it("P1-DET-41 a 30-frame sequence fed its own results stays accurate", SLOW, () => {
    let previous: Float32Array | null = null;
    for (const entry of trackingSequence()) {
      const scene = renderItem(entry);
      const result: Float32Array | null = findChessboardCorners(scene.image, 9, 6, { previous });
      expectAccurate(result, scene, entry.label);
      previous = result;
    }
  });

  it("P1-DET-42 a stale hint (2 squares away, rotated 30°, scaled ×1.5) still gives an accurate result", SLOW, () => {
    const scene = renderItem(s0());
    for (const entry of staleHintScenes()) {
      const previous = toFloat32(describeScene(entry.options).truth());
      expectAccurate(findChessboardCorners(scene.image, 9, 6, { previous }), scene, entry.label);
    }
  });

  it("P1-DET-43 a hint on the right points in a wrong order never passes its order on", SLOW, () => {
    const scene = renderItem(s0());
    const truth = scene.truth();
    const hints: [string, Float32Array][] = [
      ["reversed (180°)", reorder(truth, (i, j) => [8 - i, 5 - j])],
      ["i flipped", reorder(truth, (i, j) => [8 - i, j])],
      ["j flipped", reorder(truth, (i, j) => [i, 5 - j])],
    ];
    for (const [name, previous] of hints) expectAccurate(findChessboardCorners(scene.image, 9, 6, { previous }), scene, name);
  });

  it("P1-DET-44 a hint shifted by one column or one row gives an accurate result", SLOW, () => {
    const scene = renderItem(s0());
    const H = scene.H as number[];
    const shifted = (di: number, dj: number) => {
      const out = new Float32Array(108);
      for (let j = 0; j < 6; j++) {
        for (let i = 0; i < 9; i++) {
          const [x, y] = cornerXY({ cornersX: 9, cornersY: 6, square: 0.24 }, i + di, j + dj);
          const [u, v] = applyHomography(H, x, y);
          out[2 * (j * 9 + i)] = u;
          out[2 * (j * 9 + i) + 1] = v;
        }
      }
      return out;
    };
    for (const [name, previous] of [
      ["one column", shifted(1, 0)],
      ["one row", shifted(0, 1)],
    ] as const) {
      expectAccurate(findChessboardCorners(scene.image, 9, 6, { previous }), scene, name);
    }
  });

  it("P1-DET-45 garbage hints (zeros, NaN, ±Infinity, random, huge, one point, negative) change nothing", SLOW, () => {
    for (const entry of garbageHintScenes()) {
      const scene = renderItem(entry);
      for (const { name, hint } of garbageHints(scene.image.width, scene.image.height)) {
        expectAccurate(findChessboardCorners(scene.image, 9, 6, { previous: hint }), scene, `${entry.label}, hint ${name}`);
      }
    }
  });

  it("P1-DET-46 with a valid hint, images without a board still give null", SLOW, () => {
    const previous = s0Hint();
    for (const entry of noBoardScenes()) expect(findChessboardCorners(renderItem(entry).image, 9, 6, { previous }), entry.label).toBeNull();
  });

  it("P1-DET-47 with the unoccluded frame's corners as hint, an occluded corner still gives null", SLOW, () => {
    const previous = findChessboardCorners(renderItem(s0()).image, 9, 6);
    expectLayout(previous, 9, 6, "unoccluded frame");
    for (const entry of occludedScenes()) expect(findChessboardCorners(renderItem(entry).image, 9, 6, { previous }), entry.label).toBeNull();
  });

  it("P1-DET-48 with the true corners as hint, a corner outside the image still gives null", SLOW, () => {
    for (const entry of outsideScenes()) {
      const scene = renderItem(entry);
      expect(findChessboardCorners(scene.image, 9, 6, { previous: toFloat32(scene.truth()) }), entry.label).toBeNull();
    }
  });

  it("P1-DET-49 a hint on an exact 9×6 sub-lattice of a 10×7-corner board still gives null", SLOW, () => {
    const entry = largerLatticeScenes()[0];
    const scene = renderItem(entry);
    const physical = scene.physical as Float64Array; // 10 × 7 corners in the board's own order
    const previous = new Float32Array(108);
    for (let j = 0; j < 6; j++) {
      for (let i = 0; i < 9; i++) {
        previous[2 * (j * 9 + i)] = physical[2 * (j * 10 + i)];
        previous[2 * (j * 9 + i) + 1] = physical[2 * (j * 10 + i) + 1];
      }
    }
    expect(findChessboardCorners(scene.image, 9, 6, { previous }), entry.label).toBeNull();
  });

  it("P1-DET-50 a 9×6 hint extrapolated beyond an 8×5-corner board still gives null", SLOW, () => {
    const entry = smallerLatticeScenes()[0];
    const scene = renderItem(entry);
    const H = scene.H as number[];
    const board = { cornersX: 8, cornersY: 5, square: 0.24 };
    const previous = new Float32Array(108);
    for (let j = 0; j < 6; j++) {
      for (let i = 0; i < 9; i++) {
        const [x, y] = cornerXY(board, i, j); // i = 8 and j = 5 lie one square beyond the lattice
        const [u, v] = applyHomography(H, x, y);
        previous[2 * (j * 9 + i)] = u;
        previous[2 * (j * 9 + i) + 1] = v;
      }
    }
    expect(findChessboardCorners(scene.image, 9, 6, { previous }), entry.label).toBeNull();
  });

  it("P1-DET-51 a board moved 1 square since the hint is still found accurately", SLOW, () => {
    const previous = findChessboardCorners(renderItem(s0()).image, 9, 6);
    expectLayout(previous, 9, 6, "previous frame");
    const entry = oneSquareMotion();
    const scene = renderItem(entry);
    expectAccurate(findChessboardCorners(scene.image, 9, 6, { previous }), scene, entry.label);
  });

  it("P1-DET-52 with the true corners as hint, off-nominal scenes still give null or an identity-correct result", SLOW, () => {
    for (const entry of stressScenes()) {
      const scene = renderItem(entry);
      const truth = scene.truth();
      expectNullOrIdentityCorrect(findChessboardCorners(scene.image, 9, 6, { previous: toFloat32(truth) }), truth, 9, 6, entry.label);
    }
  });
});

describe("findChessboardCorners: determinism and input immutability (§5.2)", () => {
  it("P1-DET-53 the same input gives the same output, with and without a hint", SLOW, () => {
    const scene = renderItem(s0());
    expect(findChessboardCorners(scene.image, 9, 6)).toEqual(findChessboardCorners(scene.image, 9, 6));
    const previous = s0Hint();
    expect(findChessboardCorners(scene.image, 9, 6, { previous })).toEqual(findChessboardCorners(scene.image, 9, 6, { previous }));
  });

  it("P1-DET-54 earlier calls on other images do not change a result", SLOW, () => {
    const a = renderItem(s0());
    const b = renderItem(nominalSet()[0]);
    const first = findChessboardCorners(a.image, 9, 6);
    findChessboardCorners(b.image, 9, 6);
    findChessboardCorners(b.image, 9, 6, { previous: toFloat32(b.truth()) });
    expect(findChessboardCorners(a.image, 9, 6)).toEqual(first);
    const previous = s0Hint();
    const hinted = findChessboardCorners(a.image, 9, 6, { previous });
    findChessboardCorners(b.image, 9, 6);
    expect(findChessboardCorners(a.image, 9, 6, { previous })).toEqual(hinted);
  });

  it("P1-DET-55 the image is not modified, whether a board is found or not", SLOW, () => {
    for (const entry of [s0(), noBoardScenes()[0]]) {
      const { image } = renderItem(entry);
      const before = bytesOf(image.data);
      findChessboardCorners(image, 9, 6);
      expect(bytesOf(image.data), entry.label).toEqual(before);
      expect([image.width, image.height]).toEqual([entry.options.width, entry.options.height]);
    }
  });

  it("P1-DET-56 the hint is not modified, NaN payloads included", SLOW, () => {
    const scene = renderItem(s0());
    const previous = s0Hint();
    const view = new DataView(previous.buffer);
    view.setUint32(4 * 10, 0x7fc00123, true); // NaN with a distinctive payload
    view.setUint32(4 * 11, 0xffc00456, true);
    const before = bytesOf(previous);
    findChessboardCorners(scene.image, 9, 6, { previous });
    expect(bytesOf(previous)).toEqual(before);
  });

  it("P1-DET-57 the result is a new array with its own, exactly sized buffer (OQ-17)", SLOW, () => {
    const scene = renderItem(s0());
    const previous = s0Hint();
    const result = findChessboardCorners(scene.image, 9, 6, { previous });
    expectLayout(result, 9, 6, "result");
    expect(result).not.toBe(previous);
    expect(result.buffer).not.toBe(previous.buffer);
    expect(result.buffer).not.toBe(scene.image.data.buffer);
    expect(result.byteOffset).toBe(0);
    expect(result.buffer.byteLength).toBe(4 * 108);
    expect(findChessboardCorners(scene.image, 9, 6, { previous })).not.toBe(result);
  });
});

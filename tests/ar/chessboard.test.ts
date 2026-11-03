// P1 contract tests for src/ar/chessboard.ts, part 1: rgbaToGray, and findChessboardCorners'
// validation, result layout, ordering O1–O3 and accuracy under nominal conditions.
// docs/design_camera_ar.md §5.2, test plan §3.2 and §3.3.

import { describe, expect, it } from "vitest";
import { findChessboardCorners, rgbaToGray } from "@/ar/chessboard";
import {
  type CatalogItem,
  allLimitScenes,
  clutterScenes,
  gradientScenes,
  imageShapeScenes,
  largeSquareScenes,
  longSideVertical,
  maxBlurScenes,
  maxNoiseScenes,
  maxTiltScenes,
  minContrastScenes,
  minEdgeScenes,
  nominalSet,
  pixelCentreScenes,
  renderItem,
  rotated180,
  rotationSweep,
  s0,
  swappedRequest,
  tightFramingScenes,
} from "./helpers/catalog";
import { expectAccurate, expectLayout, expectOrderProperties, expectRangeError } from "./helpers/metrics";
import { createRng, seedFor } from "./helpers/random";

const SLOW = { timeout: 120_000 };

const luma = (r: number, g: number, b: number): number => Math.round(0.299 * r + 0.587 * g + 0.114 * b);

/** RGBA pixels from [r, g, b] triples, with a constant or per-pixel alpha. */
function rgbaFrom(colours: readonly number[], alpha: (k: number) => number = () => 255): Uint8ClampedArray {
  const n = colours.length / 3;
  const out = new Uint8ClampedArray(4 * n);
  for (let k = 0; k < n; k++) {
    out[4 * k] = colours[3 * k];
    out[4 * k + 1] = colours[3 * k + 1];
    out[4 * k + 2] = colours[3 * k + 2];
    out[4 * k + 3] = alpha(k);
  }
  return out;
}

function expectAllAccurate(items: readonly CatalogItem[]): void {
  for (const entry of items) {
    const scene = renderItem(entry);
    expectAccurate(findChessboardCorners(scene.image, entry.request[0], entry.request[1]), scene, entry.label, entry.request);
  }
}

describe("rgbaToGray (§5.2)", () => {
  it("P1-GRY-01 every value is within 1 of the rounded BT.601 luma", () => {
    const colours: number[] = [];
    for (let channel = 0; channel < 3; channel++) {
      for (const a of [0, 255]) {
        for (const b of [0, 255]) {
          for (let value = 0; value < 256; value++) {
            const rgb = [0, 0, 0];
            rgb[channel] = value;
            rgb[(channel + 1) % 3] = a;
            rgb[(channel + 2) % 3] = b;
            colours.push(...rgb);
          }
        }
      }
    }
    for (let r = 0; r < 256; r += 17) for (let g = 0; g < 256; g += 17) for (let b = 0; b < 256; b += 17) colours.push(r, g, b);
    const rng = createRng(seedFor("P1-GRY-01"));
    for (let k = 0; k < 65_536; k++) colours.push(rng.int(256), rng.int(256), rng.int(256));
    const n = colours.length / 3;
    const gray = rgbaToGray(rgbaFrom(colours, () => rng.int(256)), n, 1);
    expect(gray.width).toBe(n);
    expect(gray.height).toBe(1);
    for (let k = 0; k < n; k++) {
      const expected = luma(colours[3 * k], colours[3 * k + 1], colours[3 * k + 2]);
      if (Math.abs(gray.data[k] - expected) > 1) {
        expect.fail(`colour (${colours.slice(3 * k, 3 * k + 3).join(", ")}) gave ${gray.data[k]}, expected ${expected} ± 1`);
      }
    }
  });

  it("P1-GRY-02 black, white and the primaries map to their BT.601 values (catches channel order)", () => {
    const gray = rgbaToGray(rgbaFrom([0, 0, 0, 255, 255, 255, 255, 0, 0, 0, 255, 0, 0, 0, 255]), 5, 1);
    const ranges = [
      [0, 1],
      [254, 255],
      [75, 77],
      [149, 151],
      [28, 30],
    ];
    ranges.forEach(([lo, hi], k) => {
      expect(gray.data[k], `pixel ${k}`).toBeGreaterThanOrEqual(lo);
      expect(gray.data[k], `pixel ${k}`).toBeLessThanOrEqual(hi);
    });
  });

  it("P1-GRY-03 alpha is ignored", () => {
    const rng = createRng(seedFor("P1-GRY-03"));
    const colours = Array.from({ length: 3 * 1000 }, () => rng.int(256));
    const opaque = rgbaToGray(rgbaFrom(colours), 1000, 1).data;
    for (const alpha of [0, 1, 128]) {
      expect(Array.from(rgbaToGray(rgbaFrom(colours, () => alpha), 1000, 1).data), `alpha ${alpha}`).toEqual(Array.from(opaque));
    }
    expect(Array.from(rgbaToGray(rgbaFrom(colours, () => rng.int(256)), 1000, 1).data)).toEqual(Array.from(opaque));
  });

  it("P1-GRY-04 output is row-major, one byte per pixel", () => {
    const colours = [10, 20, 30, 200, 10, 10, 10, 200, 10, 10, 10, 200, 90, 90, 90, 250, 240, 230];
    const gray = rgbaToGray(rgbaFrom(colours), 3, 2);
    expect(gray.width).toBe(3);
    expect(gray.height).toBe(2);
    expect(gray.data.length).toBe(6);
    expect(gray.data instanceof Uint8Array || gray.data instanceof Uint8ClampedArray).toBe(true);
    for (let v = 0; v < 2; v++) {
      for (let u = 0; u < 3; u++) {
        const k = v * 3 + u;
        expect(Math.abs(gray.data[k] - luma(colours[3 * k], colours[3 * k + 1], colours[3 * k + 2])), `pixel (${u}, ${v})`).toBeLessThanOrEqual(1);
      }
    }
  });

  it("P1-GRY-05 a given out buffer is filled and returned as data", () => {
    const colours = [10, 20, 30, 200, 10, 10, 10, 200, 10, 10, 10, 200, 90, 90, 90, 250, 240, 230];
    const out = new Uint8Array(6).fill(0xaa);
    const gray = rgbaToGray(rgbaFrom(colours), 3, 2, out);
    expect(gray.data).toBe(out);
    for (let k = 0; k < 6; k++) {
      expect(Math.abs(out[k] - luma(colours[3 * k], colours[3 * k + 1], colours[3 * k + 2])), `pixel ${k}`).toBeLessThanOrEqual(1);
    }
  });

  it("P1-GRY-06 Uint8Array and Uint8ClampedArray inputs agree and views are respected", () => {
    const rng = createRng(seedFor("P1-GRY-06"));
    const n = 64;
    const colours = Array.from({ length: 3 * n }, () => rng.int(200));
    const clamped = rgbaFrom(colours);
    const expected = Array.from(rgbaToGray(clamped, n, 1).data);
    expect(Array.from(rgbaToGray(new Uint8Array(clamped), n, 1).data)).toEqual(expected);

    // Input view with byteOffset 4: the white pixels outside the view must not be read
    const backing = new Uint8ClampedArray(4 * (n + 2)).fill(255);
    backing.set(clamped, 4);
    const view = new Uint8ClampedArray(backing.buffer, 4, 4 * n);
    expect(Array.from(rgbaToGray(view, n, 1).data)).toEqual(expected);

    // Output view inside a larger buffer: the bytes around it must not be written
    const big = new Uint8Array(n + 6).fill(0x55);
    const out = big.subarray(3, 3 + n);
    rgbaToGray(clamped, n, 1, out);
    expect(Array.from(out)).toEqual(expected);
    expect(Array.from(big.subarray(0, 3))).toEqual([0x55, 0x55, 0x55]);
    expect(Array.from(big.subarray(3 + n))).toEqual([0x55, 0x55, 0x55]);
  });

  it("P1-GRY-07 a 1×1 image works", () => {
    const gray = rgbaToGray(new Uint8ClampedArray([100, 100, 100, 255]), 1, 1);
    expect(gray.width).toBe(1);
    expect(gray.height).toBe(1);
    expect(Math.abs(gray.data[0] - 100)).toBeLessThanOrEqual(1);
  });

  it("P1-GRY-08 invalid sizes and buffer lengths throw RangeError", () => {
    const rgba = new Uint8ClampedArray(4 * 6);
    for (const [w, h] of [
      [0, 2],
      [-1, 2],
      [2.5, 2],
      [NaN, 2],
      [Infinity, 2],
      [3, 0],
      [3, -1],
      [3, 2.5],
      [3, NaN],
      [3, Infinity],
    ]) {
      expectRangeError(() => rgbaToGray(rgba, w, h), `size ${w}×${h}`);
    }
    for (const length of [4 * 6 - 1, 4 * 6 + 4, 0]) expectRangeError(() => rgbaToGray(new Uint8ClampedArray(length), 3, 2), `rgba length ${length}`);
    for (const length of [5, 7]) expectRangeError(() => rgbaToGray(rgba, 3, 2, new Uint8Array(length)), `out length ${length}`);
  });

  it("P1-GRY-09 the input is not modified and calls without out share no data (§8)", () => {
    const rng = createRng(seedFor("P1-GRY-09"));
    const rgba = rgbaFrom(Array.from({ length: 3 * 100 }, () => rng.int(256)), () => rng.int(256));
    const before = Array.from(rgba);
    const first = rgbaToGray(rgba, 10, 10);
    const second = rgbaToGray(rgba, 10, 10);
    expect(Array.from(rgba)).toEqual(before);
    expect(second.data).not.toBe(first.data);
    expect(second.data.buffer).not.toBe(first.data.buffer);
  });
});

describe("findChessboardCorners: validation and result layout (§5.2)", () => {
  const image = { width: 32, height: 32, data: new Uint8Array(32 * 32) };

  it("P1-DET-01 invalid image sizes throw RangeError", () => {
    for (const [width, height] of [
      [0, 32],
      [-1, 32],
      [1.5, 32],
      [NaN, 32],
      [32, 0],
      [32, -1],
      [32, 1.5],
      [32, NaN],
    ]) {
      expectRangeError(() => findChessboardCorners({ width, height, data: new Uint8Array(32 * 32) }, 9, 6), `size ${width}×${height}`);
    }
    expectRangeError(() => findChessboardCorners({ width: 32, height: 32, data: new Uint8Array(32 * 32 - 1) }, 9, 6), "data one byte short");
    expectRangeError(() => findChessboardCorners({ width: 32, height: 32, data: new Uint8Array(32 * 32 + 1) }, 9, 6), "data one byte long");
  });

  it("P1-DET-02 invalid lattice sizes throw RangeError", () => {
    for (const [x, y] of [
      [1, 6],
      [0, 6],
      [2.5, 6],
      [NaN, 6],
      [9, 1],
      [9, 0],
      [9, 2.5],
      [9, NaN],
      [5, 5],
      [4, 6],
      [9, 7],
    ]) {
      expectRangeError(() => findChessboardCorners(image, x, y), `lattice ${x}×${y}`);
    }
  });

  it("P1-DET-03 a hint of the wrong length throws RangeError; any values of the right length are accepted", () => {
    for (const length of [107, 109, 0]) expectRangeError(() => findChessboardCorners(image, 9, 6, { previous: new Float32Array(length) }), `previous length ${length}`);
    expect(() => findChessboardCorners(image, 9, 6, { previous: new Float32Array(108).fill(NaN) })).not.toThrow();
  });

  it("P1-DET-04 tiny images give null, and the four ways of passing no hint agree", () => {
    const pixel = { width: 1, height: 1, data: new Uint8Array(1) };
    expect(findChessboardCorners(pixel, 2, 3)).toBeNull();
    expect(findChessboardCorners(pixel, 3, 2)).toBeNull();
    for (const size of [1, 3, 16]) expect(findChessboardCorners({ width: size, height: size, data: new Uint8Array(size * size).fill(128) }, 9, 6), `${size}×${size}`).toBeNull();
    const scene = renderItem(s0());
    const plain = findChessboardCorners(scene.image, 9, 6);
    for (const options of [undefined, {}, { previous: null }, { previous: undefined }]) {
      expect(findChessboardCorners(scene.image, 9, 6, options), JSON.stringify(options) ?? "undefined").toEqual(plain);
    }
  });

  it("P1-DET-05 a result is a new Float32Array of 2 · cornersX · cornersY values", () => {
    const scene = renderItem(s0());
    for (const [x, y] of [
      [9, 6],
      [6, 9],
    ]) {
      const first = findChessboardCorners(scene.image, x, y);
      expectLayout(first, x, y, `${x}×${y}`);
      const second = findChessboardCorners(scene.image, x, y);
      expect(second, `${x}×${y}`).not.toBe(first);
    }
  });
});

describe("findChessboardCorners: ordering O1–O3 (§5.2)", () => {
  it("P1-DET-06 the result is accurate, hence ordered, at every in-plane rotation", SLOW, () => {
    expectAllAccurate(rotationSweep());
  });

  it("P1-DET-07 O2 and O3 hold when measured on the result itself", SLOW, () => {
    for (const entry of [s0(), ...rotationSweep().filter((_, k) => k % 6 === 0)]) {
      const scene = renderItem(entry);
      const result = findChessboardCorners(scene.image, 9, 6);
      expectLayout(result, 9, 6, entry.label);
      expectOrderProperties(result, scene.image, 9, 6, entry.label);
    }
  });

  it("P1-DET-08 the colour rule, not the image position, picks corner 0 on a board turned 180°", SLOW, () => {
    expectAllAccurate(rotated180());
  });

  it("P1-DET-09 i runs along the 9-corner side when that side is vertical", SLOW, () => {
    expectAllAccurate(longSideVertical());
  });

  it("P1-DET-10 a 6×9 request on the 9×6 board returns the transposed canonical order", SLOW, () => {
    expectAllAccurate(swappedRequest());
  });
});

describe("findChessboardCorners: accuracy under nominal conditions (§5.2)", () => {
  it("P1-DET-12 40 seeded nominal scenes are each accurate", SLOW, () => {
    expectAllAccurate(nominalSet());
  });

  it("P1-DET-13 squares with 12 px edges", SLOW, () => {
    expectAllAccurate(minEdgeScenes());
  });

  it("P1-DET-14 tilt 60° about the board's X, Y and diagonal axes", SLOW, () => {
    expectAllAccurate(maxTiltScenes());
  });

  it("P1-DET-15 Gaussian blur σ 1.0", SLOW, () => {
    expectAllAccurate(maxBlurScenes());
  });

  it("P1-DET-16 noise σ 4 at contrast 80", SLOW, () => {
    expectAllAccurate(maxNoiseScenes());
  });

  it("P1-DET-17 contrast of exactly 80 grey levels at three brightness levels", SLOW, () => {
    expectAllAccurate(minContrastScenes());
  });

  it("P1-DET-18 a ±25 % illumination gradient with contrast ≥ 80 everywhere (OQ-12)", SLOW, () => {
    expectAllAccurate(gradientScenes());
  });

  it("P1-DET-19 a 0.25-square margin touching the image border", SLOW, () => {
    expectAllAccurate(tightFramingScenes());
  });

  it("P1-DET-20 clutter beyond the margin", SLOW, () => {
    expectAllAccurate(clutterScenes());
  });

  it("P1-DET-21 every nominal limit at once", SLOW, () => {
    expectAllAccurate(allLimitScenes());
  });

  it("P1-DET-22 large squares (45 px and 90 px)", SLOW, () => {
    expectAllAccurate(largeSquareScenes());
  });

  it("P1-DET-23 portrait, small, odd-sized and large images", SLOW, () => {
    expectAllAccurate(imageShapeScenes());
  });

  it("P1-DET-24 corners on integer and half-integer pixel positions (pixel-centre convention)", SLOW, () => {
    expectAllAccurate(pixelCentreScenes());
  });

  it("P1-DET-25 Uint8Array, Uint8ClampedArray and offset views of the same image give the same result", SLOW, () => {
    const scene = renderItem(s0());
    const { width, height, data } = scene.image;
    const clamped = findChessboardCorners({ width, height, data }, 9, 6);
    expectAccurate(clamped, scene, "Uint8ClampedArray");
    expect(findChessboardCorners({ width, height, data: new Uint8Array(data) }, 9, 6)).toEqual(clamped);
    const backing = new Uint8Array(data.length + 7);
    backing.set(data, 7);
    expect(findChessboardCorners({ width, height, data: backing.subarray(7) }, 9, 6)).toEqual(clamped);
  });
});

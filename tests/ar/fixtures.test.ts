// Real-photo fixture tests (decision D12, test plan §7). There are no ground-truth corners, so each
// found board is checked for O1–O3 and a homography-fit residual ≤ 1.5 px RMS (design §9). The suite
// is skipped while tests/fixtures/board/manifest.json is an empty list.

import { describe, expect, it } from "vitest";
import { findChessboardCorners } from "@/ar/chessboard";
import { STANDARD_BOARD, cornerGrid, isDarkSquare, squareCentre, squaresX, squaresY } from "./helpers/boardModel";
import { type FixtureEntry, entryProblems, loadManifest, loadPhoto } from "./helpers/fixtures";
import { crossAtCorner0, expectLayout, fitHomography, patchMean } from "./helpers/metrics";
import type { TestImage } from "./helpers/render";

const SLOW = { timeout: 120_000 };
const manifest = loadManifest();
const entries = manifest as FixtureEntry[]; // validated by P1-FIX-01
const photos = new Map<string, TestImage>();
const photo = (entry: FixtureEntry): TestImage => {
  let image = photos.get(entry.file);
  if (!image) {
    image = loadPhoto(entry.file);
    photos.set(entry.file, image);
  }
  return image;
};

/** P1-FIX-02…05: layout, O2, O3 (by square colours) and the homography-fit residual. */
function expectPlausibleBoard(result: Float32Array | null, image: TestImage, label: string): asserts result is Float32Array {
  expectLayout(result, 9, 6, label);
  expect(crossAtCorner0(result, 9), `${label}: O2`).toBeGreaterThan(0);
  const grid = cornerGrid(STANDARD_BOARD);
  const { H, rms } = fitHomography(grid, result);
  expect(rms, `${label}: homography-fit residual (px)`).toBeLessThanOrEqual(1.5);
  const dark: number[] = [];
  const light: number[] = [];
  let first: number | null = null;
  for (let r = 0; r < squaresY(STANDARD_BOARD); r++) {
    for (let c = 0; c < squaresX(STANDARD_BOARD); c++) {
      const [x, y] = squareCentre(STANDARD_BOARD, r, c);
      const mean = patchMean(image, H, x, y, STANDARD_BOARD.square / 4);
      if (mean === null) continue;
      (isDarkSquare(r, c) ? dark : light).push(mean);
      if (r === 0 && c === 0) first = mean;
    }
  }
  const average = (values: number[]) => values.reduce((s, v) => s + v, 0) / values.length;
  expect(average(dark), `${label}: O3 designated-dark squares are darker`).toBeLessThanOrEqual(average(light) - 20);
  const sortedLight = [...light].sort((a, b) => a - b);
  if (first !== null) expect(first, `${label}: O3 square (0, 0) is dark`).toBeLessThan(sortedLight[Math.floor(sortedLight.length / 2)]);
}

describe.skipIf(manifest.length === 0)("P1-FIX real-photo fixtures (D12; skipped while tests/fixtures/board/manifest.json is empty)", () => {
  it("P1-FIX-01 the manifest is valid and every photo decodes to a 640 px long side", SLOW, () => {
    expect(manifest.length).toBeGreaterThanOrEqual(5);
    manifest.forEach((entry, k) => expect(entryProblems(entry), `entry ${k}`).toEqual([]));
    expect(new Set(entries.map((e) => e.file)).size).toBe(entries.length);
    for (const entry of entries) {
      const image = photo(entry);
      expect(Math.max(image.width, image.height), entry.file).toBe(640);
      expect(image.data.length, entry.file).toBe(image.width * image.height);
    }
  });

  it("P1-FIX-02 photos expected to show the board give a 9×6 result", SLOW, () => {
    for (const entry of entries.filter((e) => e.expect === "found")) expectLayout(findChessboardCorners(photo(entry), 9, 6), 9, 6, entry.file);
  });

  it("P1-FIX-03 O2 holds on every found board", SLOW, () => {
    for (const entry of entries.filter((e) => e.expect === "found")) {
      const result = findChessboardCorners(photo(entry), 9, 6);
      expectLayout(result, 9, 6, entry.file);
      expect(crossAtCorner0(result, 9), entry.file).toBeGreaterThan(0);
    }
  });

  it("P1-FIX-04 O3: the designated-dark squares are dark, square (0, 0) included", SLOW, () => {
    for (const entry of entries.filter((e) => e.expect === "found")) {
      expectPlausibleBoard(findChessboardCorners(photo(entry), 9, 6), photo(entry), entry.file);
    }
  });

  it("P1-FIX-05 a homography fits every found board within 1.5 px RMS", SLOW, () => {
    for (const entry of entries.filter((e) => e.expect === "found")) {
      const result = findChessboardCorners(photo(entry), 9, 6);
      expectLayout(result, 9, 6, entry.file);
      expect(fitHomography(cornerGrid(STANDARD_BOARD), result).rms, entry.file).toBeLessThanOrEqual(1.5);
    }
  });

  it('P1-FIX-06 "null" photos give null; "either" photos give null or a plausible board', SLOW, () => {
    for (const entry of entries.filter((e) => e.expect !== "found")) {
      const result = findChessboardCorners(photo(entry), 9, 6);
      if (entry.expect === "null") expect(result, entry.file).toBeNull();
      else if (result !== null) expectPlausibleBoard(result, photo(entry), entry.file);
    }
  });

  it("P1-FIX-07 annotated corners 0, 8, 45 and 53 are found within 3 px", SLOW, () => {
    for (const entry of entries.filter((e) => e.corners && e.expect !== "null")) {
      const result = findChessboardCorners(photo(entry), 9, 6);
      if (entry.expect === "either" && result === null) continue;
      expectLayout(result, 9, 6, entry.file);
      for (const [key, point] of Object.entries(entry.corners ?? {})) {
        if (!point) continue;
        const k = Number(key);
        expect(Math.hypot(result[2 * k] - point[0], result[2 * k + 1] - point[1]), `${entry.file} corner ${k}`).toBeLessThanOrEqual(3);
      }
    }
  });

  it("P1-FIX-08 results repeat, and a hint (own result, or reversed) keeps them plausible", SLOW, () => {
    for (const entry of entries.filter((e) => e.expect !== "null")) {
      const image = photo(entry);
      const result = findChessboardCorners(image, 9, 6);
      expect(findChessboardCorners(image, 9, 6), entry.file).toEqual(result);
      if (result === null) continue;
      const reversed = new Float32Array(108);
      for (let k = 0; k < 54; k++) {
        reversed[2 * k] = result[2 * (53 - k)];
        reversed[2 * k + 1] = result[2 * (53 - k) + 1];
      }
      for (const previous of [result, reversed]) {
        const hinted = findChessboardCorners(image, 9, 6, { previous });
        expectPlausibleBoard(hinted, image, `${entry.file} with hint`);
        for (const [key, point] of Object.entries(entry.corners ?? {})) {
          if (!point) continue;
          const k = Number(key);
          expect(Math.hypot(hinted[2 * k] - point[0], hinted[2 * k + 1] - point[1]), `${entry.file} corner ${k} with hint`).toBeLessThanOrEqual(3);
        }
      }
    }
  });
});

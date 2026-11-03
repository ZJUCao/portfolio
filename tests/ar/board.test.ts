// P1 contract tests for src/ar/board.ts: docs/design_camera_ar.md §5.1, test plan §3.1.

import { describe, expect, it } from "vitest";
import { BOARD, boardCorners } from "@/ar/board";
import { STANDARD_BOARD, isDarkSquare, squareAt } from "./helpers/boardModel";

describe("board.ts (§5.1)", () => {
  it("P1-BRD-01 BOARD describes the 10×7-square, 9×6-corner board with 0.24-unit, 25 mm squares", () => {
    expect({ ...BOARD }).toEqual({ squaresX: 10, squaresY: 7, cornersX: 9, cornersY: 6, squareSize: 0.24, squareMeters: 0.025 });
  });

  it("P1-BRD-02 boardCorners returns a Float64Array of 2 · 9 · 6 values", () => {
    const corners = boardCorners();
    expect(corners).toBeInstanceOf(Float64Array);
    expect(corners.length).toBe(108);
  });

  it("P1-BRD-03 corner k = j · 9 + i is at ((i + 1 − 5) · 0.24, (j + 1 − 3.5) · 0.24)", () => {
    const corners = boardCorners();
    for (let j = 0; j < 6; j++) {
      for (let i = 0; i < 9; i++) {
        const k = j * 9 + i;
        expect(corners[2 * k], `corner ${k} X`).toBeCloseTo((i + 1 - 5) * 0.24, 12);
        expect(corners[2 * k + 1], `corner ${k} Y`).toBeCloseTo((j + 1 - 3.5) * 0.24, 12);
      }
    }
  });

  it("P1-BRD-04 corners 0, 8, 45 and 53 are the lattice's extremes and the centroid is the origin", () => {
    const corners = boardCorners();
    const at = (k: number) => [corners[2 * k], corners[2 * k + 1]];
    for (const [k, x, y] of [
      [0, -0.96, -0.6],
      [8, 0.96, -0.6],
      [45, -0.96, 0.6],
      [53, 0.96, 0.6],
    ]) {
      expect(at(k)[0], `corner ${k} X`).toBeCloseTo(x, 12);
      expect(at(k)[1], `corner ${k} Y`).toBeCloseTo(y, 12);
    }
    let sx = 0;
    let sy = 0;
    for (let k = 0; k < 54; k++) {
      sx += corners[2 * k];
      sy += corners[2 * k + 1];
    }
    expect(Math.abs(sx / 54)).toBeLessThan(1e-12);
    expect(Math.abs(sy / 54)).toBeLessThan(1e-12);
  });

  it("P1-BRD-05 every call returns a new array", () => {
    const first = boardCorners();
    first.fill(99);
    const second = boardCorners();
    expect(second).not.toBe(first);
    expect(second.buffer).not.toBe(first.buffer);
    expect(second[0]).toBeCloseTo(-0.96, 12);
  });

  it("P1-BRD-06 corner (i, j) is the common vertex of squares (j, i), (j, i+1), (j+1, i), (j+1, i+1), and square (0, 0) is dark", () => {
    const corners = boardCorners();
    const half = STANDARD_BOARD.square / 2;
    for (let j = 0; j < 6; j++) {
      for (let i = 0; i < 9; i++) {
        const k = j * 9 + i;
        const x = corners[2 * k];
        const y = corners[2 * k + 1];
        expect(squareAt(STANDARD_BOARD, x - half, y - half), `corner ${k}`).toEqual([j, i]);
        expect(squareAt(STANDARD_BOARD, x + half, y - half), `corner ${k}`).toEqual([j, i + 1]);
        expect(squareAt(STANDARD_BOARD, x - half, y + half), `corner ${k}`).toEqual([j + 1, i]);
        expect(squareAt(STANDARD_BOARD, x + half, y + half), `corner ${k}`).toEqual([j + 1, i + 1]);
      }
    }
    // The square diagonally outward from corner 0 is square (0, 0), which is dark
    expect(squareAt(STANDARD_BOARD, corners[0] - half, corners[1] - half)).toEqual([0, 0]);
    expect(isDarkSquare(0, 0)).toBe(true);
  });

  it("P1-BRD-07 BOARD is frozen at runtime (OQ-07)", () => {
    expect(Object.isFrozen(BOARD)).toBe(true);
  });
});

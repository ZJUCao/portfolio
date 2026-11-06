// Geometry of the space-cut transitions (docs/design_space_cut.md §5.1, §7, §8).

import { describe, expect, it } from "vitest";
import { CLICK, KNIFE, WAND } from "@/cut/constants";
import {
  autoCutLine,
  blobCoverScale,
  blobPoints,
  checkStroke,
  fitLine,
  inPolygon,
  lensCoverScale,
  lensHalfWidth,
  lensPoints,
  makeBlob,
  polygonCenter,
  type Pt,
  toClipPath,
} from "@/cut/geometry";
import { seeded } from "./helpers/fakeClock";

const VIEW = { width: 1000, height: 800 };
const corners = (v = VIEW): Pt[] => [
  [0, 0],
  [v.width, 0],
  [v.width, v.height],
  [0, v.height],
];

/** Points along a line through (cx, cy) at angle a, from -half to +half, with an optional bend. */
function stroke(cx: number, cy: number, a: number, half: number, bend = 0, n = 40): Pt[] {
  const u = [Math.cos(a), Math.sin(a)];
  const nn = [-u[1], u[0]];
  return Array.from({ length: n + 1 }, (_, i) => {
    const t = -half + (2 * half * i) / n;
    const off = bend * (1 - Math.abs(t / half));
    return [cx + u[0] * t + nn[0] * off, cy + u[1] * t + nn[1] * off] as Pt;
  });
}

describe("fitLine", () => {
  it("finds the direction, midpoint and half length of a straight stroke", () => {
    const a = Math.PI / 6;
    const line = fitLine(stroke(400, 300, a, 150));
    expect(Math.abs(line.dir[0] * Math.cos(a) + line.dir[1] * Math.sin(a))).toBeCloseTo(1, 6);
    expect(line.dir[0] * line.normal[0] + line.dir[1] * line.normal[1]).toBeCloseTo(0, 9);
    expect(line.mid[0]).toBeCloseTo(400, 6);
    expect(line.mid[1]).toBeCloseTo(300, 6);
    expect(line.halfLength).toBeCloseTo(150, 6);
    expect(line.deviation).toBeCloseTo(0, 6);
  });

  it("measures the largest distance from the line", () => {
    const line = fitLine(stroke(500, 400, 0, 200, 30));
    // A tent 30 px high: the fitted line sits about halfway up, so the largest distance is about 15 px
    expect(line.deviation).toBeGreaterThan(14);
    expect(line.deviation).toBeLessThan(16);
  });
});

describe("checkStroke", () => {
  // Shortest stroke on a 1000 × 800 surface: max(110, 0.2 × 800) = 160 px
  it("rejects strokes shorter than the minimum length", () => {
    expect(checkStroke(fitLine(stroke(500, 400, 0.3, 75)), VIEW, "mouse")).toBe("too-short");
    expect(checkStroke(fitLine(stroke(500, 400, 0.3, 85)), VIEW, "mouse")).toBe("ok");
  });

  it("uses 110 px on small surfaces", () => {
    const small = { width: 400, height: 300 };
    expect(checkStroke(fitLine(stroke(200, 150, 0, 50)), small, "touch")).toBe("too-short");
    expect(checkStroke(fitLine(stroke(200, 150, 0, 60)), small, "touch")).toBe("ok");
  });

  it("allows a 12% deviation, and 16% for hands", () => {
    // A tent 112 px high on a 400 px stroke deviates about 56 px, 14% of the length
    const bent = fitLine(stroke(500, 400, 0, 200, 0.28 * 400));
    expect(bent.deviation / (2 * bent.halfLength)).toBeGreaterThan(KNIFE.maxDeviation);
    expect(bent.deviation / (2 * bent.halfLength)).toBeLessThan(KNIFE.maxDeviationHand);
    expect(checkStroke(bent, VIEW, "mouse")).toBe("not-straight");
    expect(checkStroke(bent, VIEW, "hand")).toBe("ok");
  });
});

describe("lens window", () => {
  const line = fitLine(stroke(500, 400, 0.4, 200));

  it("clamps the stopped half-width between 26 px and 24% of the short side", () => {
    expect(lensHalfWidth(line, VIEW)).toBeCloseTo(200 * KNIFE.halfWidthRatio, 6);
    expect(lensHalfWidth(fitLine(stroke(500, 400, 0, 40)), VIEW)).toBe(KNIFE.halfWidthMinPx);
    expect(lensHalfWidth(fitLine(stroke(500, 400, 0, 900)), VIEW)).toBeCloseTo(800 * KNIFE.halfWidthMaxShort, 6);
  });

  it("is pointed at both ends and widest in the middle", () => {
    const pts = lensPoints(line, 1.5, 60, 0.8, 20);
    expect(pts).toHaveLength(42);
    const tip1 = [line.mid[0] - line.dir[0] * 300, line.mid[1] - line.dir[1] * 300];
    const tip2 = [line.mid[0] + line.dir[0] * 300, line.mid[1] + line.dir[1] * 300];
    expect(pts[0][0]).toBeCloseTo(tip1[0], 6);
    expect(pts[0][1]).toBeCloseTo(tip1[1], 6);
    expect(pts[20][0]).toBeCloseTo(tip2[0], 6);
    expect(pts[20][1]).toBeCloseTo(tip2[1], 6);
    const widths = pts.map((p) => Math.abs((p[0] - line.mid[0]) * line.normal[0] + (p[1] - line.mid[1]) * line.normal[1]));
    expect(Math.max(...widths)).toBeCloseTo(90, 6);
  });

  it("covers every corner at the cover scale once it is an ellipse", () => {
    const hw = lensHalfWidth(line, VIEW);
    const k = lensCoverScale(line, hw, VIEW);
    expect(k).toBeGreaterThan(1);
    const ellipse = lensPoints(line, k, hw, KNIFE.sharpnessThrough, 200);
    for (const c of corners()) expect(inPolygon(c, ellipse)).toBe(true);
  });
});

describe("the wand's hole", () => {
  it("has the four harmonics of §7 with random phases and turning speeds", () => {
    const blob = makeBlob([300, 200], seeded(7));
    expect(blob.harmonics.map((h) => h.k)).toEqual(WAND.harmonics.map(([k]) => k));
    for (const h of blob.harmonics) {
      expect(Math.abs(h.speed)).toBeGreaterThanOrEqual(WAND.speedMin);
      expect(Math.abs(h.speed)).toBeLessThanOrEqual(WAND.speedMin + WAND.speedSpan);
      expect(h.phase).toBeGreaterThanOrEqual(0);
      expect(h.phase).toBeLessThan(2 * Math.PI);
    }
  });

  it("is a circle without wobble and stays within the harmonics' reach with it", () => {
    const blob = makeBlob([300, 200], seeded(3));
    const reach = WAND.harmonics.reduce((sum, [, amp]) => sum + amp, 0);
    const round = blobPoints(blob, 50, 0, 1.2, 32);
    expect(round).toHaveLength(32);
    for (const p of round) expect(Math.hypot(p[0] - 300, p[1] - 200)).toBeCloseTo(50, 6);
    for (const p of blobPoints(blob, 50, 1, 1.2)) {
      const d = Math.hypot(p[0] - 300, p[1] - 200);
      expect(d).toBeGreaterThanOrEqual(50 * (1 - reach) - 1e-9);
      expect(d).toBeLessThanOrEqual(50 * (1 + reach) + 1e-9);
    }
  });

  it("covers every corner at the cover scale", () => {
    const blob = makeBlob([120, 650], seeded(5));
    const k = blobCoverScale(blob, 40, VIEW);
    const round = blobPoints(blob, 40 * k, 0, 0, 128);
    for (const c of corners()) expect(inPolygon(c, round)).toBe(true);
  });
});

describe("autoCutLine", () => {
  it("passes through the point and leans 55° to 70° either way", () => {
    const random = seeded(11);
    for (let i = 0; i < 50; i++) {
      const line = autoCutLine([400, 300], VIEW, random);
      expect(line.mid).toEqual([400, 300]);
      const deg = (Math.abs(Math.atan2(line.dir[1], line.dir[0])) * 180) / Math.PI;
      expect(deg).toBeGreaterThanOrEqual(CLICK.angleMinDeg - 1e-9);
      expect(deg).toBeLessThanOrEqual(CLICK.angleMinDeg + CLICK.angleSpanDeg + 1e-9);
      expect(line.deviation).toBe(0);
    }
  });

  it("clamps the half length between 90 and 280 px", () => {
    expect(autoCutLine([0, 0], { width: 500, height: 300 }, seeded()).halfLength).toBe(CLICK.halfLengthMinPx);
    expect(autoCutLine([0, 0], { width: 3000, height: 2000 }, seeded()).halfLength).toBe(CLICK.halfLengthMaxPx);
    expect(autoCutLine([0, 0], VIEW, seeded()).halfLength).toBeCloseTo(800 * CLICK.halfLengthShort, 9);
  });
});

describe("polygon helpers", () => {
  const notch: Pt[] = [
    [0, 0],
    [100, 0],
    [100, 100],
    [50, 40],
    [0, 100],
  ];

  it("tells inside from outside, also in a concave polygon", () => {
    expect(inPolygon([20, 20], notch)).toBe(true);
    expect(inPolygon([50, 80], notch)).toBe(false);
    expect(inPolygon([150, 50], notch)).toBe(false);
    expect(inPolygon([10, 10], [])).toBe(false);
  });

  it("writes a clip-path with one decimal", () => {
    expect(
      toClipPath([
        [1, 2.25],
        [30.04, 4],
      ]),
    ).toBe("polygon(1.0px 2.3px, 30.0px 4.0px)");
  });

  it("finds the centre of the bounding box", () => {
    expect(polygonCenter(notch)).toEqual([50, 50]);
    expect(polygonCenter([])).toBeNull();
  });
});

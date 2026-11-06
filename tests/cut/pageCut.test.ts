// The page-change cut's keyframes (docs/design_space_cut.md §5.3, §6.1, §8, D9).

import { describe, expect, it } from "vitest";
import { CLICK } from "@/cut/constants";
import { autoCutLine, inPolygon, type Pt } from "@/cut/geometry";
import { PAGE_CUT_MS, pageCutKeyframes, pageCutWindow } from "@/cut/pageCut";
import { seeded } from "./helpers/fakeClock";

const VIEW = { width: 1280, height: 720 };
const CORNERS: Pt[] = [
  [0, 0],
  [VIEW.width, 0],
  [VIEW.width, VIEW.height],
  [0, VIEW.height],
];
const parse = (clipPath: string): Pt[] =>
  clipPath
    .slice("polygon(".length, -1)
    .split(", ")
    .map((pair) => pair.split(" ").map((v) => parseFloat(v)) as unknown as Pt);

// The language button sits near the top right corner of the header
const line = autoCutLine([1180, 40], VIEW, seeded(3));

describe("pageCutKeyframes", () => {
  const frames = pageCutKeyframes(line, VIEW);

  it("runs from 0 to 1 with every frame on the same number of points", () => {
    const offsets = frames.map((f) => f.offset as number);
    expect(offsets[0]).toBe(0);
    expect(offsets.at(-1)).toBe(1);
    for (let i = 1; i < offsets.length; i++) expect(offsets[i]).toBeGreaterThan(offsets[i - 1]);
    const counts = new Set(frames.map((f) => parse(f.clipPath as string).length));
    expect([...counts]).toEqual([82]);
  });

  it("starts as a zero-width line through the origin", () => {
    for (const [x, y] of parse(frames[0].clipPath as string)) {
      const off = (x - line.mid[0]) * line.normal[0] + (y - line.mid[1]) * line.normal[1];
      expect(Math.abs(off)).toBeLessThan(0.1);
    }
  });

  it("is fully open after 200 ms and covers the screen at the end", () => {
    const open = frames.find((f) => Math.abs((f.offset as number) - CLICK.openMs / PAGE_CUT_MS) < 1e-9);
    expect(open).toBeDefined();
    const widths = parse(open?.clipPath as string).map(([x, y]) => Math.abs((x - line.mid[0]) * line.normal[0] + (y - line.mid[1]) * line.normal[1]));
    expect(Math.max(...widths)).toBeCloseTo(line.halfLength * CLICK.halfWidthRatio, 0);
    const last = parse(frames.at(-1)?.clipPath as string);
    for (const corner of CORNERS) expect(inPolygon(corner, last)).toBe(true);
  });
});

describe("pageCutWindow", () => {
  it("keeps the D9 timing: 120 + 40 ms before the transition, 200 + 480 ms inside it", () => {
    expect(PAGE_CUT_MS).toBe(CLICK.openMs + CLICK.expandMs);
    expect(CLICK.lineMs + CLICK.pauseMs + PAGE_CUT_MS).toBe(840);
  });

  it("fades the rim out as the window grows", () => {
    expect(pageCutWindow(line, VIEW, CLICK.openMs).rim.core).toBeCloseTo(0.6, 9);
    expect(pageCutWindow(line, VIEW, PAGE_CUT_MS).rim).toMatchObject({ shadow: 0, glow: 0, core: 0 });
  });
});

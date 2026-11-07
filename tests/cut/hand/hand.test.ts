// Pure hand gesture functions (docs/design_space_cut.md §5.4, §7, §8; requirements §3.5).

import { describe, expect, it } from "vitest";
import { HAND } from "@/cut/constants";
import { createHandInput, type Landmark } from "@/cut/hand/handInput";
import { handToViewport } from "@/cut/hand/mapping";
import { oneEuro } from "@/cut/hand/oneEuro";
import { pinchRatio, pinchState } from "@/cut/hand/pinch";

const BOX = { width: 800, height: 500 };

/**
 * 21 landmarks of a hand with the wrist (0) at (wx, wy), the middle finger's base (9) a palm length
 * above it, and the thumb (4) and index (8) tips gap apart (fractions of the picture) around (cx, cy).
 */
function hand(cx: number, cy: number, gap: number, palm = 0.2): Landmark[] {
  const pts: Landmark[] = Array.from({ length: 21 }, () => ({ x: cx, y: cy + palm }));
  pts[0] = { x: cx, y: cy + palm };
  pts[9] = { x: cx, y: cy };
  pts[4] = { x: cx - gap / 2, y: cy };
  pts[8] = { x: cx + gap / 2, y: cy };
  return pts;
}

describe("oneEuro", () => {
  it("passes the first value through and stays put on a constant input", () => {
    const f = oneEuro(HAND.minCutoff, HAND.beta);
    expect(f.filter(10, 0)).toBe(10);
    for (let t = 16; t < 500; t += 16) expect(f.filter(10, t)).toBeCloseTo(10, 9);
  });

  it("follows a step smoothly without overshooting, and faster for bigger jumps", () => {
    const slow = oneEuro(HAND.minCutoff, HAND.beta);
    slow.filter(0, 0);
    const first = slow.filter(100, 16);
    expect(first).toBeGreaterThan(0);
    expect(first).toBeLessThan(100);
    let v = first;
    for (let t = 32; t < 2000; t += 16) {
      const next = slow.filter(100, t);
      expect(next).toBeGreaterThanOrEqual(v - 1e-9);
      expect(next).toBeLessThanOrEqual(100 + 1e-9);
      v = next;
    }
    expect(v).toBeCloseTo(100, 0);
  });

  it("starts over after reset", () => {
    const f = oneEuro(1, 0);
    f.filter(0, 0);
    f.filter(50, 16);
    f.reset();
    expect(f.filter(80, 32)).toBe(80);
  });
});

describe("pinch", () => {
  it("measures the fingertip gap against the palm, correcting for the picture's aspect", () => {
    expect(pinchRatio(hand(0.5, 0.5, 0.04), 1)).toBeCloseTo(0.2, 9);
    // On a 4:3 picture a horizontal gap of 0.04 of the width is 0.0533 of the height
    expect(pinchRatio(hand(0.5, 0.5, 0.04), 4 / 3)).toBeCloseTo((0.04 * 4) / 3 / 0.2, 9);
  });

  it("pinches below 0.30 and releases only above 0.45", () => {
    expect(pinchState(false, 0.31)).toBe(false);
    expect(pinchState(false, 0.29)).toBe(true);
    expect(pinchState(true, 0.4)).toBe(true);
    expect(pinchState(true, 0.46)).toBe(false);
  });
});

describe("handToViewport", () => {
  it("mirrors the picture and maps the middle region onto the box", () => {
    const { x0, x1, y0, y1 } = HAND.region;
    // The fingertips' midpoint at the region's top-left corner of the picture is the box's top-right
    const topLeft = hand(x0, y0, 0);
    expect(handToViewport(topLeft, HAND.region, BOX)).toEqual([BOX.width, 0]);
    const bottomRight = hand(x1, y1, 0);
    const [x, y] = handToViewport(bottomRight, HAND.region, BOX);
    expect(x).toBeCloseTo(0, 9);
    expect(y).toBeCloseTo(BOX.height, 9);
    const centre = handToViewport(hand(0.5, (y0 + y1) / 2, 0.05), HAND.region, BOX);
    expect(centre[0]).toBeCloseTo(BOX.width / 2, 9);
    expect(centre[1]).toBeCloseTo(BOX.height / 2, 9);
  });

  it("keeps the cursor inside the box when the hand leaves the region", () => {
    expect(handToViewport(hand(0.01, 0.99, 0), HAND.region, BOX)).toEqual([BOX.width, BOX.height]);
    expect(handToViewport(hand(0.99, 0.01, 0), HAND.region, BOX)).toEqual([0, 0]);
  });
});

describe("createHandInput", () => {
  const OPEN = 0.12; // ratio 0.6
  const SHUT = 0.04; // ratio 0.2

  it("turns an open hand into hover moves, a pinch into a press and opening into a release", () => {
    const input = createHandInput();
    const a = input.frame(hand(0.5, 0.47, OPEN), 0, 1, BOX);
    expect(a.state).toBe("open");
    expect(a.events.map((e) => e.type)).toEqual(["move"]);
    const b = input.frame(hand(0.5, 0.47, SHUT), 33, 1, BOX);
    expect(b.state).toBe("pinched");
    expect(b.events).toMatchObject([{ type: "down", source: "hand", id: HAND.pointerId, t: 33 }]);
    const c = input.frame(hand(0.4, 0.47, SHUT), 66, 1, BOX);
    expect(c.events.map((e) => e.type)).toEqual(["move"]);
    const d = input.frame(hand(0.4, 0.47, OPEN), 99, 1, BOX);
    expect(d.events.map((e) => e.type)).toEqual(["up"]);
  });

  it("releases a pinch only after the hand has been gone for more than 300 ms", () => {
    const input = createHandInput();
    input.frame(hand(0.5, 0.47, SHUT), 0, 1, BOX);
    expect(input.frame(null, 100, 1, BOX).events).toEqual([]);
    expect(input.frame(null, 380, 1, BOX).events).toEqual([]);
    const late = input.frame(null, 420, 1, BOX);
    expect(late.state).toBe("none");
    expect(late.events.map((e) => e.type)).toEqual(["up"]);
    expect(input.frame(null, 600, 1, BOX).events).toEqual([]);
  });

  it("a hand that comes back in time keeps its pinch", () => {
    const input = createHandInput();
    input.frame(hand(0.5, 0.47, SHUT), 0, 1, BOX);
    input.frame(null, 200, 1, BOX);
    expect(input.frame(hand(0.5, 0.47, SHUT), 250, 1, BOX).events.map((e) => e.type)).toEqual(["move"]);
  });

  it("smooths the cursor and reports it in the box's px", () => {
    const input = createHandInput();
    const first = input.frame(hand(0.5, 0.47, OPEN), 0, 1, BOX).cursor;
    expect(first?.[0]).toBeCloseTo(BOX.width / 2, 6);
    const jumped = input.frame(hand(0.3, 0.47, OPEN), 33, 1, BOX).cursor as readonly [number, number];
    const target = handToViewport(hand(0.3, 0.47, OPEN), HAND.region, BOX);
    expect(jumped[0]).toBeGreaterThan(BOX.width / 2);
    expect(jumped[0]).toBeLessThan(target[0]);
  });

  it("cancels a held pinch when the mode is switched off", () => {
    const input = createHandInput();
    expect(input.release(0)).toEqual([]);
    input.frame(hand(0.5, 0.47, SHUT), 0, 1, BOX);
    expect(input.release(50)).toEqual([{ type: "cancel", t: 50, source: "hand", id: HAND.pointerId }]);
    expect(input.release(60)).toEqual([]);
  });
});

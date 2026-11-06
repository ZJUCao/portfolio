// The input recognizer and the D1 rule (docs/design_space_cut.md §3 D1, §7, §8).

import { describe, expect, it } from "vitest";
import type { InputSource } from "@/cut/geometry";
import { createRecognizer, type GestureEvent, type Intent, type Tools } from "@/cut/gesture";

const ALL: Tools = { knife: true, wand: true, click: false };

/** A small script of one pointer: down at (x, y) at t = 0, then moves and an up. */
function press(tools: Tools, source: InputSource = "mouse", id = 1) {
  const r = createRecognizer(tools);
  const out: Intent[] = [];
  const send = (e: GestureEvent) => {
    out.push(...r.feed(e));
    return api;
  };
  const api = {
    down: (x: number, y: number, t = 0) => send({ type: "down", x, y, t, source, id }),
    move: (x: number, y: number, t: number) => send({ type: "move", x, y, t, source, id }),
    up: (x: number, y: number, t: number) => send({ type: "up", x, y, t, source, id }),
    cancel: (t: number) => send({ type: "cancel", t, source, id }),
    other: (e: GestureEvent) => send(e),
    kinds: () => out.map((i) => i.kind),
    out,
    r,
  };
  return api;
}

describe("D1: the wand lights at once, a quick move makes it a knife stroke", () => {
  it("a press starts the wand", () => {
    const g = press(ALL).down(100, 100);
    expect(g.kinds()).toEqual(["press", "wand-start"]);
    expect(g.out[1]).toMatchObject({ kind: "wand-start", p: [100, 100], source: "mouse" });
  });

  it("moving more than 10 px within 250 ms becomes a stroke carrying the points so far", () => {
    const g = press(ALL).down(100, 100).move(105, 100, 40).move(115, 100, 80);
    expect(g.kinds()).toEqual(["press", "wand-start", "stroke-start"]);
    const start = g.out[2] as Extract<Intent, { kind: "stroke-start" }>;
    expect(start.points).toEqual([
      [100, 100],
      [105, 100],
      [115, 100],
    ]);
    g.move(200, 100, 160).up(260, 100, 220);
    expect(g.kinds().slice(3)).toEqual(["stroke-move", "stroke-end"]);
    expect((g.out.at(-1) as Extract<Intent, { kind: "stroke-end" }>).points.at(-1)).toEqual([260, 100]);
  });

  it("staying within 10 px for 250 ms keeps the wand, and later moves do not make a stroke", () => {
    const g = press(ALL).down(100, 100).move(108, 100, 200).move(300, 100, 300).up(300, 100, 900);
    expect(g.kinds()).toEqual(["press", "wand-start", "wand-end"]);
  });

  it("hands get 40 px before a press becomes a stroke", () => {
    expect(press(ALL, "hand").down(100, 100).move(130, 100, 100).up(130, 100, 400).kinds()).toEqual(["press", "wand-start", "wand-end"]);
    expect(press(ALL, "hand").down(100, 100).move(145, 100, 100).kinds()).toEqual(["press", "wand-start", "stroke-start"]);
  });

  it("drops points closer than 1.5 px to the previous one", () => {
    const g = press(ALL).down(0, 0).move(20, 0, 10).move(21, 0, 20).move(23, 0, 30).up(23, 0, 40);
    const end = g.out.at(-1) as Extract<Intent, { kind: "stroke-end" }>;
    expect(end.points).toEqual([
      [0, 0],
      [20, 0],
      [23, 0],
    ]);
  });
});

describe("single tools", () => {
  it("knife only: any move past 10 px is a stroke, however late", () => {
    const g = press({ knife: true, wand: false, click: false }).down(0, 0).move(5, 0, 600).move(40, 0, 900).up(80, 0, 1000);
    expect(g.kinds()).toEqual(["press", "stroke-start", "stroke-end"]);
  });

  it("knife only: a press without a stroke ends quietly", () => {
    expect(press({ knife: true, wand: false, click: false }).down(0, 0).up(2, 0, 100).kinds()).toEqual(["press"]);
  });

  it("wand only: moving never makes a stroke", () => {
    const g = press({ knife: false, wand: true, click: false }).down(0, 0).move(80, 0, 50).up(80, 0, 400);
    expect(g.kinds()).toEqual(["press", "wand-start", "wand-end"]);
  });

  it("click only: a release within 12 px is a tap at the press point; further is nothing", () => {
    const tools = { knife: false, wand: false, click: true };
    const tap = press(tools).down(50, 60).up(58, 60, 120);
    expect(tap.kinds()).toEqual(["press", "tap"]);
    expect(tap.out[1]).toMatchObject({ p: [50, 60] });
    expect(press(tools).down(50, 60).up(70, 60, 120).kinds()).toEqual(["press"]);
    expect(press(tools, "hand").down(50, 60).up(85, 60, 120).kinds()).toEqual(["press", "tap"]);
  });
});

describe("pointers, cancel and keys", () => {
  it("ignores a second pointer while the first is pressed", () => {
    const g = press(ALL).down(0, 0);
    g.other({ type: "down", x: 300, y: 300, t: 10, source: "touch", id: 2 });
    g.other({ type: "up", x: 300, y: 300, t: 20, source: "touch", id: 2 });
    expect(g.kinds()).toEqual(["press", "wand-start"]);
  });

  it("moves without a press are hover", () => {
    const g = press(ALL).move(10, 20, 5);
    expect(g.out).toEqual([{ kind: "hover", p: [10, 20], source: "mouse" }]);
  });

  it("a cancel ends the press", () => {
    const g = press(ALL).down(0, 0).cancel(100);
    expect(g.kinds()).toEqual(["press", "wand-start", "cancel"]);
    g.move(50, 0, 150);
    expect(g.kinds().at(-1)).toBe("hover");
  });

  it("Enter and Space activate, Escape escapes, other keys do nothing", () => {
    const g = press(ALL);
    for (const key of ["Enter", " ", "Escape", "a", "Tab"]) g.other({ type: "key", key, t: 0 });
    expect(g.out).toEqual([
      { kind: "key", key: "activate" },
      { kind: "key", key: "activate" },
      { kind: "key", key: "escape" },
    ]);
  });

  it("reset forgets the active press", () => {
    const g = press(ALL).down(0, 0);
    g.r.reset();
    g.move(50, 0, 30).up(50, 0, 60);
    expect(g.kinds()).toEqual(["press", "wand-start", "hover"]);
  });
});

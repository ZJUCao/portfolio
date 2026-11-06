// The cut engine's core with a fake clock and renderer (docs/design_space_cut.md §5.2, §6, §7, D1, D8, D9).

import { describe, expect, it } from "vitest";
import { CLICK, PARALLAX, WAND } from "@/cut/constants";
import { createCutController, type CutOptions, type CutRenderer, type CutTarget, type Phase } from "@/cut/engine";
import type { InputSource, Pt } from "@/cut/geometry";
import { fakeClock, seeded } from "./helpers/fakeClock";

const VIEW = { width: 1000, height: 800 };

function rig(options: Partial<CutOptions> = {}) {
  const fake = fakeClock();
  const windows: (readonly Pt[] | null)[] = [];
  const phases: Phase[] = [];
  const events: string[] = [];
  const fades: number[] = [];
  const parallax: number[][] = [];
  const renderer: CutRenderer = {
    size: () => VIEW,
    stroke() {},
    fadeStroke() {},
    rim() {},
    tip() {},
    ripples() {},
    dust() {},
    destroy: () => void events.push("destroy"),
  };
  const target: CutTarget = {
    setWindow: (p) => void windows.push(p),
    setParallax: (dx, dy, scale) => void parallax.push([dx, dy, scale]),
    setFade: (o) => void fades.push(o),
  };
  const cut = createCutController(
    renderer,
    target,
    {
      stop: true,
      tools: { knife: true, wand: true, click: false },
      reducedMotion: false,
      onPhase: (p) => void phases.push(p),
      onReject: (r) => void events.push(`reject:${r}`),
      onThrough: () => void events.push("through"),
      onClose: () => void events.push("close"),
      ...options,
    },
    { clock: fake.clock, random: seeded(4) },
  );
  const send = (type: "down" | "move" | "up", [x, y]: Pt, source: InputSource = "mouse") => cut.input({ type, x, y, t: fake.now, source, id: 1 });
  const key = (k: string) => cut.input({ type: "key", key: k, t: fake.now });
  /** Draws a stroke from a to b in ms, in ten moves. */
  const draw = async (a: Pt, b: Pt, ms = 100) => {
    send("down", a);
    for (let i = 1; i <= 10; i++) {
      await fake.advance(ms / 10);
      send("move", [a[0] + ((b[0] - a[0]) * i) / 10, a[1] + ((b[1] - a[1]) * i) / 10]);
    }
    send("up", b);
  };
  const last = () => windows.at(-1);
  return { fake, cut, windows, phases, events, fades, parallax, send, key, draw, last };
}

const meanRadius = (poly: readonly Pt[], c: Pt) => poly.reduce((s, p) => s + Math.hypot(p[0] - c[0], p[1] - c[1]), 0) / poly.length;

describe("knife", () => {
  it("a long straight stroke snaps taut, opens a lens and stops at the window", async () => {
    const r = rig();
    await r.draw([200, 400], [800, 400]);
    await r.fake.advance(1000);
    expect(r.cut.phase).toBe("peek");
    expect(r.phases.filter((p) => p !== "growing")).toEqual(["drawing", "opening", "peek"]);
    expect(r.last()?.length).toBe(82);
    expect(r.cut.isInsideWindow([500, 400])).toBe(true);
    expect(r.cut.isInsideWindow([500, 100])).toBe(false);
  });

  it("a short stroke is rejected and nothing opens", async () => {
    const r = rig();
    await r.draw([400, 400], [500, 400]);
    await r.fake.advance(500);
    expect(r.events).toEqual(["reject:too-short"]);
    expect(r.cut.phase).toBe("idle");
    expect(r.last() ?? []).toEqual([]);
  });

  it("a crooked stroke is rejected", async () => {
    const r = rig();
    r.send("down", [200, 400]);
    for (const [i, p] of ([[350, 250], [500, 200], [650, 250], [800, 400]] as Pt[]).entries()) {
      await r.fake.advance(20 + i);
      r.send("move", p);
    }
    r.send("up", [800, 400]);
    await r.fake.advance(300);
    expect(r.events).toEqual(["reject:not-straight"]);
  });

  it("without a stop it goes straight through and reveals everything", async () => {
    const r = rig({ stop: false });
    await r.draw([200, 400], [800, 400]);
    await r.fake.advance(2000);
    expect(r.events).toEqual(["through"]);
    expect(r.last()).toBeNull();
    expect(r.cut.phase).toBe("idle");
    expect(r.phases).toContain("through");
  });

  it("Escape while drawing drops the stroke", async () => {
    const r = rig({ tools: { knife: true, wand: false, click: false } });
    r.send("down", [200, 400]);
    await r.fake.advance(20);
    r.send("move", [300, 400]);
    expect(r.cut.phase).toBe("drawing");
    r.key("Escape");
    r.send("up", [300, 400]);
    await r.fake.advance(300);
    expect(r.cut.phase).toBe("idle");
    expect(r.events).toEqual([]);
  });
});

describe("at the window", () => {
  const opened = async (options: Partial<CutOptions> = {}) => {
    const r = rig(options);
    await r.draw([200, 400], [800, 400]);
    await r.fake.advance(1000);
    return r;
  };

  it("a press inside steps through", async () => {
    const r = await opened();
    r.send("down", [500, 400]);
    r.send("up", [500, 400]);
    await r.fake.advance(1000);
    expect(r.events).toEqual(["through"]);
    expect(r.last()).toBeNull();
    expect(r.cut.phase).toBe("idle");
  });

  it("a press outside closes the window and hides the other world", async () => {
    const r = await opened();
    r.send("down", [500, 50]);
    r.send("up", [500, 50]);
    await r.fake.advance(1000);
    expect(r.events).toEqual(["close"]);
    expect(r.last()).toEqual([]);
    expect(r.cut.phase).toBe("idle");
  });

  it("the other world drifts against the pointer, at most 14 px", async () => {
    const r = await opened();
    r.send("move", [900, 400]);
    const [dx, dy, scale] = r.parallax.at(-1) as number[];
    expect(dx).toBe(-PARALLAX.maxPx);
    expect(dy).toBeCloseTo(0, 9);
    expect(scale).toBe(PARALLAX.scale);
    r.send("move", [600, 500]);
    expect(r.parallax.at(-1)?.[0]).toBeCloseTo(100 * PARALLAX.factor, 9);
  });

  it("touch does not drive the parallax", async () => {
    const r = await opened();
    const n = r.parallax.length;
    r.send("move", [900, 400], "touch");
    expect(r.parallax.length).toBe(n);
  });
});

describe("keyboard (D8)", () => {
  it("at a stopping entrance Enter opens a window at the centre, Enter again steps through", async () => {
    const r = rig();
    r.key("Enter");
    await r.fake.advance(500);
    expect(r.cut.phase).toBe("peek");
    expect(r.cut.isInsideWindow([500, 400])).toBe(true);
    r.key("Enter");
    await r.fake.advance(1000);
    expect(r.events).toEqual(["through"]);
  });

  it("Escape at the window closes it", async () => {
    const r = rig();
    r.key(" ");
    await r.fake.advance(500);
    r.key("Escape");
    await r.fake.advance(600);
    expect(r.events).toEqual(["close"]);
  });

  it("at an entrance that does not stop, Enter cuts straight through", async () => {
    const r = rig({ stop: false });
    r.key("Enter");
    await r.fake.advance(1000);
    expect(r.events).toEqual(["through"]);
  });
});

describe("click to cut (D9)", () => {
  it("takes 120 + 40 + 200 + 480 ms to go through", async () => {
    const r = rig({ stop: false, tools: { knife: false, wand: false, click: true } });
    r.send("down", [300, 300]);
    r.send("up", [302, 300]);
    const total = CLICK.lineMs + CLICK.pauseMs + CLICK.openMs + CLICK.expandMs;
    await r.fake.advance(total - 40);
    expect(r.events).toEqual([]);
    await r.fake.advance(100);
    expect(r.events).toEqual(["through"]);
    expect(r.last()).toBeNull();
  });

  it("stops at the window where the entrance stops", async () => {
    const r = rig();
    r.cut.clickAt([300, 300]);
    await r.fake.advance(600);
    expect(r.cut.phase).toBe("peek");
    expect(r.cut.isInsideWindow([300, 300])).toBe(true);
  });

  it("reset drops a cut in progress and hides the other world", async () => {
    const r = rig({ stop: false });
    r.cut.clickAt([300, 300]);
    await r.fake.advance(250);
    r.cut.reset();
    expect(r.cut.phase).toBe("idle");
    expect(r.last()).toEqual([]);
    await r.fake.advance(1000);
    expect(r.events).toEqual([]);
  });
});

describe("wand", () => {
  it("the hole grows while held, stops after release and waits at the window", async () => {
    const r = rig();
    r.send("down", [400, 400]);
    await r.fake.advance(1000);
    expect(r.cut.phase).toBe("growing");
    r.send("up", [400, 400]);
    await r.fake.advance(600);
    expect(r.cut.phase).toBe("peek");
    const u = (1 - WAND.delayS) / WAND.holdMaxS;
    const expected = WAND.radiusMaxShort * 800 * (1 - (1 - u) ** 2) * WAND.settleGrowth;
    expect(meanRadius(r.last() as Pt[], [400, 400])).toBeGreaterThan(expected * 0.9);
    expect(meanRadius(r.last() as Pt[], [400, 400])).toBeLessThan(expected * 1.1);
  });

  it("a tap still opens a small window", async () => {
    const r = rig();
    r.send("down", [400, 400]);
    await r.fake.advance(48);
    r.send("up", [400, 400]);
    await r.fake.advance(600);
    expect(r.cut.phase).toBe("peek");
    const radius = meanRadius(r.last() as Pt[], [400, 400]);
    expect(radius).toBeGreaterThan(WAND.radiusMinShort * 800 * 0.85);
    expect(radius).toBeLessThan(WAND.radiusMinShort * 800 * 1.15);
  });

  it("a cancelled press counts as a release", async () => {
    const r = rig();
    r.send("down", [400, 400]);
    await r.fake.advance(500);
    r.cut.input({ type: "cancel", t: r.fake.now, source: "touch", id: 1 });
    await r.fake.advance(600);
    expect(r.cut.phase).toBe("peek");
  });

  it("D1: a quick move turns the young hole into a knife stroke and the hole collapses", async () => {
    const r = rig();
    r.send("down", [400, 400]);
    await r.fake.advance(200);
    expect((r.last() as Pt[]).length).toBeGreaterThan(0);
    r.send("move", [450, 400]);
    expect(r.cut.phase).toBe("drawing");
    await r.fake.advance(WAND.abortMs + 50);
    expect(r.last()).toEqual([]);
    expect(r.cut.phase).toBe("drawing");
  });
});

describe("reduce motion (F5)", () => {
  it("crossfades instead of cutting", async () => {
    const r = rig({ stop: false, reducedMotion: true });
    r.cut.clickAt([300, 300]);
    await r.fake.advance(260);
    expect(r.events).toEqual(["through"]);
    expect(r.windows).toContain(null);
    expect(r.fades[0]).toBe(0);
    expect(r.fades.at(-1)).toBe(1);
  });
});

describe("lifecycle", () => {
  it("reports each phase once when it changes", async () => {
    const r = rig();
    r.cut.clickAt([300, 300]);
    await r.fake.advance(600);
    expect(r.phases).toEqual(["opening", "peek"]);
  });

  it("destroy stops everything and ignores later input", async () => {
    const r = rig();
    r.cut.clickAt([300, 300]);
    await r.fake.advance(100);
    r.cut.destroy();
    expect(r.events).toEqual(["destroy"]);
    r.key("Enter");
    await r.fake.advance(1000);
    expect(r.events).toEqual(["destroy"]);
    expect(r.fake.pending).toBe(0);
  });
});

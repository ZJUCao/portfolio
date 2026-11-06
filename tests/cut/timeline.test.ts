// Cancellable tweens with a fake clock (docs/design_space_cut.md §4, §8).

import { describe, expect, it } from "vitest";
import { createTimeline, ease } from "@/cut/timeline";
import { fakeClock } from "./helpers/fakeClock";

describe("easing", () => {
  it("starts at 0 and ends at 1", () => {
    for (const [name, fn] of Object.entries(ease)) {
      expect(fn(0), name).toBeCloseTo(0, 9);
      expect(fn(1), name).toBeCloseTo(1, 9);
    }
  });

  it("outBack overshoots before settling", () => {
    expect(Math.max(...Array.from({ length: 99 }, (_, i) => ease.outBack((i + 1) / 100)))).toBeGreaterThan(1);
  });
});

describe("createTimeline", () => {
  it("tweens from 0 to 1 over the duration and resolves true", async () => {
    const fake = fakeClock();
    const timeline = createTimeline(fake.clock);
    const seen: number[] = [];
    let result: boolean | undefined;
    void timeline.tween(100, (t) => seen.push(t)).then((ok) => (result = ok));
    await fake.advance(64);
    expect(result).toBeUndefined();
    expect(seen.at(-1)).toBeGreaterThan(0.5);
    expect(seen.at(-1)).toBeLessThan(1);
    await fake.advance(64);
    expect(result).toBe(true);
    expect(seen.at(-1)).toBe(1);
    expect(seen).toEqual([...seen].sort((a, b) => a - b));
  });

  it("passes the eased and the raw progress", async () => {
    const fake = fakeClock();
    const timeline = createTimeline(fake.clock);
    const pairs: [number, number][] = [];
    void timeline.tween(100, (e, r) => pairs.push([e, r]), ease.inCubic);
    await fake.advance(48);
    for (const [e, r] of pairs) expect(e).toBeCloseTo(r ** 3, 9);
  });

  it("cancelAll resolves running tweens and waits false and stops calling them", async () => {
    const fake = fakeClock();
    const timeline = createTimeline(fake.clock);
    let calls = 0;
    const results: boolean[] = [];
    void timeline.tween(500, () => calls++).then((ok) => results.push(ok));
    void timeline.wait(500).then((ok) => results.push(ok));
    await fake.advance(48);
    const before = calls;
    timeline.cancelAll();
    await fake.advance(600);
    expect(results).toEqual([false, false]);
    expect(calls).toBe(before);
  });

  it("a tween started after cancelAll runs normally", async () => {
    const fake = fakeClock();
    const timeline = createTimeline(fake.clock);
    timeline.cancelAll();
    let result: boolean | undefined;
    void timeline.tween(50, () => {}).then((ok) => (result = ok));
    await fake.advance(80);
    expect(result).toBe(true);
  });

  it("waits for the duration", async () => {
    const fake = fakeClock();
    const timeline = createTimeline(fake.clock);
    let done = false;
    void timeline.wait(40).then(() => (done = true));
    await fake.advance(32);
    expect(done).toBe(false);
    await fake.advance(16);
    expect(done).toBe(true);
  });

  it("loops every frame with dt in seconds until the callback returns false", async () => {
    const fake = fakeClock();
    const timeline = createTimeline(fake.clock);
    const dts: number[] = [];
    timeline.loop((_, dt) => {
      dts.push(dt);
      return dts.length < 3;
    });
    await fake.advance(160);
    expect(dts).toHaveLength(3);
    for (const dt of dts.slice(1)) expect(dt).toBeCloseTo(0.016, 9);
  });

  it("stops a loop from outside and from cancelAll", async () => {
    const fake = fakeClock();
    const timeline = createTimeline(fake.clock);
    let a = 0;
    let b = 0;
    const stop = timeline.loop(() => void a++);
    timeline.loop(() => void b++);
    await fake.advance(48);
    stop();
    const a0 = a;
    await fake.advance(48);
    expect(a).toBe(a0);
    timeline.cancelAll();
    const b0 = b;
    await fake.advance(48);
    expect(b).toBe(b0);
    expect(fake.pending).toBe(0);
  });
});

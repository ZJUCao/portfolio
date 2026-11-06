// The wand's gold dust: the pure particle system (docs/design_space_cut.md §4, §7).

import { describe, expect, it } from "vitest";
import { DUST } from "@/cut/constants";
import { createParticles, emitFromBlob } from "@/cut/dust";
import { blobScaleAt, makeBlob } from "@/cut/geometry";
import { seeded } from "./helpers/fakeClock";

const collect = (p: ReturnType<typeof createParticles>) => {
  const out: { x: number; y: number; radius: number; alpha: number }[] = [];
  p.forEach((x, y, radius, alpha) => out.push({ x, y, radius, alpha }));
  return out;
};

describe("createParticles", () => {
  it("holds at most 1,500 particles", () => {
    const p = createParticles();
    let accepted = 0;
    for (let i = 0; i < DUST.max + 10; i++) if (p.emit(0, 0, 0, 0, 1, 2)) accepted++;
    expect(accepted).toBe(DUST.max);
    expect(p.count).toBe(DUST.max);
    p.clear();
    expect(p.count).toBe(0);
  });

  it("slows down, drifts up and dies at the end of its life", () => {
    const p = createParticles(10);
    p.emit(100, 100, 60, 0, 0.5, 2);
    p.step(0.1);
    const [a] = collect(p);
    expect(a.x).toBeGreaterThan(100);
    expect(a.x).toBeLessThan(106);
    expect(a.y).toBeLessThan(100);
    p.step(0.45);
    expect(p.count).toBe(0);
  });

  it("fades in over the first 15% of its life, then out", () => {
    const p = createParticles(1);
    p.emit(0, 0, 0, 0, 1, 4, 1, 0);
    const alphas: number[] = [];
    for (let i = 0; i < 9; i++) {
      p.step(0.1);
      alphas.push(collect(p)[0].alpha);
    }
    expect(alphas[0]).toBeCloseTo(0.1 / DUST.fadeIn, 6);
    expect(Math.max(...alphas)).toBeLessThanOrEqual(1);
    const peak = alphas.indexOf(Math.max(...alphas));
    expect(alphas.slice(peak)).toEqual([...alphas.slice(peak)].sort((x, y) => y - x));
    const last = collect(p)[0];
    expect(last.radius).toBeCloseTo(4 * (0.5 + 0.5 * last.alpha), 9);
  });
});

describe("emitFromBlob", () => {
  it("starts particles on the hole's edge, moving outwards", () => {
    const random = seeded(9);
    const blob = makeBlob([200, 200], random);
    const p = createParticles();
    emitFromBlob(p, blob, 50, 1, 0.3, 20, 80, 1, random);
    expect(p.count).toBe(20);
    p.step(0);
    for (const d of collect(p)) {
      const angle = Math.atan2(d.y - 200, d.x - 200);
      expect(Math.hypot(d.x - 200, d.y - 200)).toBeCloseTo(50 * blobScaleAt(blob, angle, 1, 0.3), 6);
    }
  });

  it("rounds a fractional count at random", () => {
    const blob = makeBlob([0, 0], seeded(1));
    let total = 0;
    const random = seeded(2);
    for (let i = 0; i < 400; i++) {
      const p = createParticles();
      emitFromBlob(p, blob, 10, 1, 0, 0.25, 10, 1, random);
      total += p.count;
    }
    expect(total / 400).toBeGreaterThan(0.15);
    expect(total / 400).toBeLessThan(0.35);
  });
});

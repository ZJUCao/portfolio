// Helper self-tests (docs/test_plan_camera_ar.md §2.9). These must pass before any contract test
// is trusted: they check the random numbers, the renderer's pixel convention and accuracy, the
// ground truth, the nominal-condition verdict, the scene catalogue and, from P3, the camera fakes.

import { describe, expect, it } from "vitest";
import type { WorkerResponse } from "@/ar/pipeline";
import { STANDARD_BOARD, cornerGrid } from "./helpers/boardModel";
import { FakeWorker, ManualScheduler } from "./helpers/cameraFakes";
import { checkCatalog, stressScenes } from "./helpers/catalog";
import { apply3 } from "./helpers/linalg";
import { crossAtCorner0, outwardSquareContrast } from "./helpers/metrics";
import { createRng, mulberry32, seedFor } from "./helpers/random";
import { type RenderOptions, blurImage, describeScene, gaussianKernel, render } from "./helpers/render";
import { type CameraMapping, makeScene, nominalScene, placeBoard } from "./helpers/scenes";

describe("helper self-tests (§2.9)", () => {
  it("H-01 random numbers repeat per seed, differ across seeds and have standard moments", () => {
    const a = mulberry32(42);
    const b = mulberry32(42);
    const c = mulberry32(43);
    const first = Array.from({ length: 1000 }, () => a());
    expect(Array.from({ length: 1000 }, () => b())).toEqual(first);
    expect(Array.from({ length: 1000 }, () => c())).not.toEqual(first);
    expect(first.every((x) => x >= 0 && x < 1)).toBe(true);
    expect(seedFor("P1-DET-12#0")).not.toBe(seedFor("P1-DET-12#1"));

    const rng = createRng(7);
    const n = 100_000;
    let sum = 0;
    let sumSq = 0;
    for (let i = 0; i < n; i++) {
      const g = rng.gaussian();
      sum += g;
      sumSq += g * g;
    }
    const mean = sum / n;
    const std = Math.sqrt(sumSq / n - mean * mean);
    expect(Math.abs(mean)).toBeLessThan(0.01);
    expect(Math.abs(std - 1)).toBeLessThan(0.01);
  });

  it("H-02 pixel (u, v) covers [u − 0.5, u + 0.5] × [v − 0.5, v + 0.5]", () => {
    // 10 px squares whose edges lie on pixel boundaries: no pixel may be mixed
    const scale = 10 / 0.24;
    const out = render({
      width: 120,
      height: 90,
      mapping: { kind: "homography", H: [scale, 0, 9.5 + 1.2 * scale, 0, scale, 9.5 + 0.84 * scale, 0, 0, 1] },
      dark: 40,
      light: 200,
      background: 128,
      marginSquares: 0.5,
    });
    const at = (u: number, v: number) => out.image.data[v * 120 + u];
    expect(new Set(out.image.data)).toEqual(new Set([40, 128, 200]));
    expect(at(10, 10)).toBe(40); // first pixel of square (0, 0), which spans u ∈ [9.5, 19.5]
    expect(at(19, 10)).toBe(40);
    expect(at(20, 10)).toBe(200); // square (0, 1) is light
    expect(at(9, 10)).toBe(200); // margin, u ∈ [4.5, 9.5]
    expect(at(5, 5)).toBe(200);
    expect(at(4, 10)).toBe(128); // background
    expect(at(10, 20)).toBe(200); // square (1, 0) is light
  });

  it("H-03 16-sample supersampling places edges within 1/32 px", () => {
    const scale = 20 / 0.24;
    const tolerance = 1 / 32 + 0.004; // plus one 8-bit rounding of the mixed pixel
    for (let k = 0; k <= 36; k++) {
      const shift = k / 37;
      const u0 = 200 + shift;
      const v0 = 150 + shift;
      const out = render({
        width: 400,
        height: 300,
        mapping: { kind: "homography", H: [scale, 0, u0, 0, scale, v0, 0, 0, 1] },
        dark: 40,
        light: 200,
      });
      const at = (u: number, v: number) => (out.image.data[v * 400 + u] - 40) / 160;
      // Vertical edge between dark square (0, 0) and light square (0, 1), crossed by a row through squares of row 0
      const ue = u0 - 0.96 * scale;
      const row = Math.round(v0 - 0.72 * scale);
      let light = 0;
      const last = Math.floor(ue) + 5;
      for (let u = Math.floor(ue) - 5; u <= last; u++) light += at(u, row);
      expect(Math.abs(last + 0.5 - light - ue), `vertical edge, shift ${shift}`).toBeLessThanOrEqual(tolerance);
      // Horizontal edge between dark square (0, 0) and light square (1, 0)
      const ve = v0 - 0.6 * scale;
      const column = Math.round(u0 - 1.08 * scale);
      light = 0;
      const bottom = Math.floor(ve) + 5;
      for (let v = Math.floor(ve) - 5; v <= bottom; v++) light += at(column, v);
      expect(Math.abs(bottom + 0.5 - light - ve), `horizontal edge, shift ${shift}`).toBeLessThanOrEqual(tolerance);
    }
  });

  it("H-04 ground truth equals the pinhole projection of the board corners", () => {
    const rng = createRng(seedFor("H-04"));
    const grid = cornerGrid(STANDARD_BOARD);
    for (let n = 0; n < 20; n++) {
      const mapping = placeBoard({
        width: 640,
        height: 360,
        tiltDeg: rng.range(0, 60),
        tiltAxisDeg: rng.range(0, 360),
        inPlaneDeg: rng.range(0, 360),
        minEdgePx: rng.range(12, 20),
        centre: [rng.range(200, 440), rng.range(120, 240)],
      });
      const { physical } = describeScene({ width: 640, height: 360, mapping });
      const { K, R, t } = mapping as CameraMapping;
      for (let k = 0; k < grid.length; k += 2) {
        const [x, y, z] = apply3(R, [grid[k], grid[k + 1], 0]);
        const u = (K.fx * (x + t[0])) / (z + t[2]) + K.cx;
        const v = (K.fy * (y + t[1])) / (z + t[2]) + K.cy;
        expect(Math.abs((physical as Float64Array)[k] - u)).toBeLessThan(1e-9);
        expect(Math.abs((physical as Float64Array)[k + 1] - v)).toBeLessThan(1e-9);
      }
    }
  });

  it("H-05 canonical truth satisfies O2 and O3 and keeps the board's own order for 9×6 requests", () => {
    for (let n = 0; n < 50; n++) {
      const scene = nominalScene(`H-05 #${n}`, createRng(seedFor(`H-05#${n}`)));
      const out = render(scene.options);
      const truth = out.truth(9, 6);
      expect(Array.from(truth), `scene ${n}`).toEqual(Array.from(out.physical as Float64Array));
      expect(crossAtCorner0(truth, 9), `scene ${n}: O2`).toBeGreaterThan(0);
      expect(outwardSquareContrast(out.image, truth, 9, 6), `scene ${n}: O3`).toBeGreaterThan(40);
    }
    for (let n = 0; n < 6; n++) {
      const scene = nominalScene(`H-05 6×9 #${n}`, createRng(seedFor(`H-05 6x9#${n}`)));
      const out = render(scene.options);
      const truth = out.truth(6, 9);
      const physical = out.physical as Float64Array;
      for (let j = 0; j < 9; j++) {
        for (let i = 0; i < 6; i++) {
          // (i′, j′) of a 6×9 request is the board's own corner (j′, 5 − i′)
          const own = (5 - i) * 9 + j;
          expect(truth[2 * (j * 6 + i)]).toBe(physical[2 * own]);
          expect(truth[2 * (j * 6 + i) + 1]).toBe(physical[2 * own + 1]);
        }
      }
      expect(crossAtCorner0(truth, 6)).toBeGreaterThan(0);
      expect(outwardSquareContrast(out.image, truth, 6, 9)).toBeGreaterThan(40);
    }
  });

  it("H-06 the nominal verifier accepts sampled scenes and names each broken condition", () => {
    for (let n = 0; n < 50; n++) {
      const scene = nominalScene(`H-06 #${n}`, createRng(seedFor(`H-06#${n}`)));
      expect(describeScene(scene.options).meta.violations, `scene ${n}`).toEqual([]);
    }
    const place = { width: 640, height: 360, tiltDeg: 30, tiltAxisDeg: 90, inPlaneDeg: 20, minEdgePx: 14 } as const;
    const look = { dark: 40, light: 200, marginSquares: 0.5, background: 128, blurSigma: 0.5, noiseSigma: 2 } as const;
    const broken: [string, RenderOptions][] = [
      ["minEdge", makeScene("H-06 edge", { ...place, minEdgePx: 11 }, look).options],
      ["tilt", makeScene("H-06 tilt", { ...place, tiltDeg: 61 }, look).options],
      ["margin", makeScene("H-06 margin", place, { ...look, marginSquares: 0.2 }).options],
      ["contrast", makeScene("H-06 contrast", place, { ...look, dark: 40, light: 119 }).options],
      ["blur", makeScene("H-06 blur", place, { ...look, blurSigma: 1.1 }).options],
      ["noise", makeScene("H-06 noise", place, { ...look, noiseSigma: 4.5 }).options],
      ["gain", makeScene("H-06 gain", place, { ...look, dark: 30, light: 160, gain: { amplitude: 0.3, angleDeg: 0 } }).options],
      ["inside", makeScene("H-06 inside", { ...place, centre: [600, 179.5] }, look).options],
    ];
    expect(describeScene(makeScene("H-06 base", place, look).options).meta.violations).toEqual([]);
    for (const [reason, options] of broken) {
      expect(describeScene(options).meta.violations, reason).toEqual([reason]);
    }
    for (const entry of stressScenes()) {
      expect(describeScene(entry.options).meta.nominal, entry.label).toBe(false);
    }
  });

  it("H-07 the blur kernel is normalised, keeps constants and has the requested σ", () => {
    for (const sigma of [0.5, 1, 2]) {
      expect(Math.abs(gaussianKernel(sigma).reduce((s, w) => s + w, 0) - 1)).toBeLessThan(1e-12);
    }
    const constant = new Float32Array(30 * 20).fill(77);
    expect(blurImage(constant, 30, 20, 1.5).every((v) => Math.abs(v - 77) < 1e-4)).toBe(true);
    for (const sigma of [1, 2]) {
      const size = 41;
      const impulse = new Float32Array(size * size);
      impulse[20 * size + 20] = 1;
      const blurred = blurImage(impulse, size, size, sigma);
      let mass = 0;
      let second = 0;
      for (let v = 0; v < size; v++) {
        for (let u = 0; u < size; u++) {
          mass += blurred[v * size + u];
          second += blurred[v * size + u] * (u - 20) ** 2;
        }
      }
      expect(Math.abs(Math.sqrt(second / mass) / sigma - 1), `σ ${sigma}`).toBeLessThan(0.01);
    }
  });

  it("H-08 noise has the requested σ and repeats per seed", () => {
    const options: RenderOptions = { width: 640, height: 360, board: null, background: 128, noiseSigma: 3, seed: 5 };
    const a = render(options).image.data;
    let sum = 0;
    let sumSq = 0;
    for (const v of a) {
      sum += v;
      sumSq += v * v;
    }
    const mean = sum / a.length;
    const std = Math.sqrt(sumSq / a.length - mean * mean);
    expect(Math.abs(mean - 128)).toBeLessThan(0.05);
    expect(Math.abs(std / 3 - 1)).toBeLessThan(0.03);
    expect(render(options).image.data).toEqual(a);
    expect(render({ ...options, seed: 6 }).image.data).not.toEqual(a);
  });

  it("H-09 camera fakes detach posted buffers, reply in new buffers and run only pending frame callbacks", () => {
    const worker = new FakeWorker();
    let reply: WorkerResponse | null = null;
    worker.onmessage = (event) => (reply = event.data);
    const buffer = new ArrayBuffer(16);
    worker.postMessage({ type: "frame", id: 1, width: 2, height: 2, buffer, time: 0 }, [buffer]);
    expect(buffer.byteLength, "detached after postMessage").toBe(0);
    const received = worker.frames[0];
    expect(received.buffer.byteLength).toBe(16);
    worker.respond();
    const result = reply as WorkerResponse | null;
    expect(result?.type).toBe("result");
    const returned = (result as Extract<WorkerResponse, { type: "result" }>).buffer;
    expect(returned).not.toBe(received.buffer);
    expect(returned.byteLength).toBe(16);
    expect(received.buffer.byteLength, "the worker's copy is transferred back").toBe(0);
    expect(worker.deliveredBuffers).toEqual([returned]);

    const scheduler = new ManualScheduler();
    const log: string[] = [];
    scheduler.request(() => {
      log.push("a");
      scheduler.request(() => log.push("c"));
    });
    const cancel = scheduler.request(() => log.push("b"));
    cancel();
    scheduler.tick();
    expect(log, "a callback requested during a tick waits; a cancelled one never runs").toEqual(["a"]);
    expect(scheduler.pending).toBe(1);
    scheduler.tick();
    expect(log).toEqual(["a", "c"]);
    expect(scheduler.pending).toBe(0);
  });

  it("H-11 every catalogue scene is what its test needs", () => {
    expect(checkCatalog()).toEqual([]);
  });
});

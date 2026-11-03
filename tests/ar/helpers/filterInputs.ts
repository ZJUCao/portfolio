// Seeded corner signals for the corner filter tests (docs/test_plan_camera_ar.md §4.5): a fixed set
// of 54 corners, jitter, steps and random sequences, all at 30 fps. Kept apart from the test file so
// offline checks can replay exactly the same inputs.

import { FRAME_MS } from "./frames";
import { createRng, seedFor } from "./random";

/** 54 corners on a 25 px grid around (320, 180), as float32-exact coordinates x0, y0, x1, y1, … */
export function restCorners(): Float32Array {
  const out = new Float32Array(108);
  for (let j = 0; j < 6; j++) {
    for (let i = 0; i < 9; i++) {
      out[2 * (j * 9 + i)] = 320 + 25 * (i - 4);
      out[2 * (j * 9 + i) + 1] = 180 + 25 * (j - 2.5);
    }
  }
  return out;
}

export interface Signal {
  /** One array per frame. */
  readonly frames: Float32Array[];
  /** Frame times in milliseconds. */
  readonly times: number[];
}

const timesFor = (count: number, start = 0): number[] => Array.from({ length: count }, (_, k) => start + k * FRAME_MS);

/** P2-CF-08: the rest corners with independent σ-px Gaussian jitter on every coordinate of every frame. */
export function jitterSignal(label: string, count = 300, sigma = 0.3): Signal {
  const rng = createRng(seedFor(label));
  const rest = restCorners();
  const frames = Array.from({ length: count }, () => Float32Array.from(rest, (value) => value + sigma * rng.gaussian()));
  return { frames, times: timesFor(count) };
}

/**
 * P2-CF-09 and P2-CF-10: `before` frames at rest, then `after` frames with every corner moved by
 * (dx, dy), noise-free. Output k of the step is the k-th output at the new position.
 */
export function stepSignal(dx: number, dy: number, before = 30, after = 30): Signal & { readonly target: Float32Array } {
  const rest = restCorners();
  const target = rest.map((value, m) => value + (m % 2 === 0 ? dx : dy));
  const frames = [...Array.from({ length: before }, () => rest.slice()), ...Array.from({ length: after }, () => target.slice())];
  return { frames, times: timesFor(before + after), target };
}

/**
 * P2-CF-07: `count` frames of `size` coordinates that random-walk with occasional jumps, at frame
 * intervals drawn from 10–60 ms.
 */
export function randomSignal(label: string, count = 500, size = 6): Signal {
  const rng = createRng(seedFor(label));
  let values = Array.from({ length: size }, () => rng.range(0, 640));
  let time = 0;
  const frames: Float32Array[] = [];
  const times: number[] = [];
  for (let k = 0; k < count; k++) {
    values = values.map((value) => (rng.next() < 0.05 ? rng.range(0, 640) : value + rng.gaussian() * 3));
    frames.push(Float32Array.from(values));
    times.push(time);
    time += rng.range(10, 60);
  }
  return { frames, times };
}

/** P2-CF-11: the rest corners drifting by up to 5 px per frame, with σ 0.3 px jitter. */
export function movingSignal(label: string, count = 120): Signal {
  const rng = createRng(seedFor(label));
  const rest = restCorners();
  const frames = Array.from({ length: count }, (_, k) => {
    const dx = 40 * Math.sin(k / 8);
    const dy = 25 * Math.cos(k / 11);
    return Float32Array.from(rest, (value, m) => value + (m % 2 === 0 ? dx : dy) + 0.3 * rng.gaussian());
  });
  return { frames, times: timesFor(count) };
}

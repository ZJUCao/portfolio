// Seeded random numbers for the camera AR tests. Every random input in the tests comes from here,
// so a run gives the same data on every machine (docs/test_plan_camera_ar.md §2.1).

export interface Rng {
  /** Uniform in [0, 1). */
  next(): number;
  /** Uniform in [min, max). */
  range(min: number, max: number): number;
  /** Integer in [0, n). */
  int(n: number): number;
  /** Standard normal deviate. */
  gaussian(): number;
  pick<T>(items: readonly T[]): T;
}

/** mulberry32: a small 32-bit generator that only uses integer operations, so it is portable. */
export function mulberry32(seed: number): () => number {
  let state = seed | 0;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), state | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function createRng(seed: number): Rng {
  const next = mulberry32(seed);
  let spare: number | null = null;
  return {
    next,
    range: (min, max) => min + (max - min) * next(),
    int: (n) => Math.floor(next() * n),
    gaussian() {
      if (spare !== null) {
        const value = spare;
        spare = null;
        return value;
      }
      // Box–Muller; 1 - next() lies in (0, 1], so the logarithm is finite
      const radius = Math.sqrt(-2 * Math.log(1 - next()));
      const angle = 2 * Math.PI * next();
      spare = radius * Math.sin(angle);
      return radius * Math.cos(angle);
    },
    pick<T>(items: readonly T[]): T {
      return items[Math.floor(next() * items.length)];
    },
  };
}

/** FNV-1a hash of a label such as "P1-DET-12#7", so every case owns its random stream. */
export function seedFor(label: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < label.length; i++) {
    hash ^= label.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

// One Euro filter (Casiez et al. 2012): holds a slow hand steady and keeps up with a fast one.
// Contract: docs/design_space_cut.md §5.4. No DOM, no React.

const smoothing = (cutoff: number, dt: number) => {
  const r = 2 * Math.PI * cutoff * dt;
  return r / (r + 1);
};

/** A filter for one coordinate; t is in ms. */
export function oneEuro(minCutoff: number, beta: number, dCutoff = 1): { filter(v: number, tMs: number): number; reset(): void } {
  let x: number | null = null;
  let dx = 0;
  let last = 0;
  return {
    filter(v, tMs) {
      if (x === null) {
        x = v;
        dx = 0;
        last = tMs;
        return v;
      }
      const dt = Math.max(0.001, (tMs - last) / 1000);
      last = tMs;
      dx += smoothing(dCutoff, dt) * ((v - x) / dt - dx);
      x += smoothing(minCutoff + beta * Math.abs(dx), dt) * (v - x);
      return x;
    },
    reset() {
      x = null;
    },
  };
}

// Cancellable tweens and easing curves for the space-cut transitions. The clock and the frame
// scheduler are passed in, so tests drive time by hand. No DOM, no React. Contract: docs/design_space_cut.md §4.

export type Easing = (t: number) => number;

/** Time in ms and a way to run a callback on the next frame. */
export type Clock = {
  now(): number;
  frame(callback: (now: number) => void): number;
  cancel(id: number): void;
};

export const ease = {
  linear: (t: number) => t,
  outCubic: (t: number) => 1 - Math.pow(1 - t, 3),
  inCubic: (t: number) => t * t * t,
  inOutSine: (t: number) => -(Math.cos(Math.PI * t) - 1) / 2,
  /** Overshoots a little before settling, for the knife's window parting. */
  outBack: (t: number) => 1 + 2.2 * Math.pow(t - 1, 3) + 1.2 * Math.pow(t - 1, 2),
} satisfies Record<string, Easing>;

export const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

export type Timeline = {
  /** Calls fn(eased, raw) every frame for ms; resolves true when done, false when cancelled. */
  tween(ms: number, fn: (eased: number, raw: number) => void, easing?: Easing): Promise<boolean>;
  /** Waits ms; resolves false when cancelled. */
  wait(ms: number): Promise<boolean>;
  /** Calls fn(now, dtSeconds) every frame until it returns false or the loop is stopped. */
  loop(fn: (now: number, dt: number) => boolean | void): () => void;
  /** Cancels every running tween, wait and loop. */
  cancelAll(): void;
};

export function createTimeline(clock: Clock): Timeline {
  // Each cancelAll starts a new generation; work from an older generation stops at its next frame.
  let generation = 0;
  const frames = new Set<number>();
  const cancellers = new Set<() => void>();

  const request = (fn: (now: number) => void) => {
    const id = clock.frame((now) => {
      frames.delete(id);
      fn(now);
    });
    frames.add(id);
    return id;
  };

  const tween: Timeline["tween"] = (ms, fn, easing = ease.linear) => {
    const mine = generation;
    const t0 = clock.now();
    const duration = Math.max(1, ms);
    return new Promise<boolean>((resolve) => {
      let id = 0;
      const cancel = () => {
        clock.cancel(id);
        frames.delete(id);
        resolve(false);
      };
      cancellers.add(cancel);
      const step = (now: number) => {
        if (mine !== generation) return;
        const raw = clamp((now - t0) / duration, 0, 1);
        fn(easing(raw), raw);
        if (raw < 1) id = request(step);
        else {
          cancellers.delete(cancel);
          resolve(true);
        }
      };
      id = request(step);
    });
  };

  const loop: Timeline["loop"] = (fn) => {
    const mine = generation;
    let last = clock.now();
    let id = 0;
    let running = true;
    const stop = () => {
      if (!running) return;
      running = false;
      clock.cancel(id);
      frames.delete(id);
      cancellers.delete(stop);
    };
    cancellers.add(stop);
    const step = (now: number) => {
      if (!running || mine !== generation) return;
      const dt = Math.max(0, now - last) / 1000;
      last = now;
      if (fn(now, dt) === false) stop();
      else if (running) id = request(step);
    };
    id = request(step);
    return stop;
  };

  return {
    tween,
    wait: (ms) => tween(ms, () => {}),
    loop,
    cancelAll() {
      generation++;
      for (const cancel of [...cancellers]) cancel();
      cancellers.clear();
      for (const id of frames) clock.cancel(id);
      frames.clear();
    },
  };
}

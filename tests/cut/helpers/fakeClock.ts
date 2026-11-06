// A hand-driven clock for timeline and engine tests: frame callbacks wait until advance() runs them.

import type { Clock } from "@/cut/timeline";

export type FakeClock = {
  clock: Clock;
  /** Advances time by ms in frames of frameMs, running due callbacks and settling promises after each frame. */
  advance(ms: number, frameMs?: number): Promise<void>;
  readonly now: number;
  readonly pending: number;
};

const settle = () => new Promise<void>((resolve) => setImmediate(resolve));

export function fakeClock(start = 1000): FakeClock {
  let now = start;
  let nextId = 1;
  const queue = new Map<number, (t: number) => void>();
  const clock: Clock = {
    now: () => now,
    frame(callback) {
      const id = nextId++;
      queue.set(id, callback);
      return id;
    },
    cancel(id) {
      queue.delete(id);
    },
  };
  return {
    clock,
    async advance(ms, frameMs = 16) {
      await settle();
      const end = now + ms;
      while (now < end) {
        now = Math.min(end, now + frameMs);
        const due = [...queue.values()];
        queue.clear();
        for (const callback of due) callback(now);
        await settle();
      }
    },
    get now() {
      return now;
    },
    get pending() {
      return queue.size;
    },
  };
}

/** A repeatable pseudo-random sequence in [0, 1). */
export function seeded(seed = 1): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

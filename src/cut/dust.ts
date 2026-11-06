// Gold dust of the wand: at most 1,500 particles that drift out of the hole's edge as it opens and
// are drawn back into the centre as it closes. The particle system is pure; createDustCanvas draws
// it on a canvas at no more than 2× pixel ratio. No React. Contract: docs/design_space_cut.md §4, §7.

import { DUST } from "./constants";
import { type Blob, blobScaleAt } from "./geometry";

export type Particles = {
  /** Adds a particle; returns false when the system is full. */
  emit(x: number, y: number, vx: number, vy: number, life: number, size: number, drag?: number, buoyancy?: number): boolean;
  /** Advances every particle by dt seconds and drops the dead ones. */
  step(dt: number): void;
  /** Visits every live particle with its drawn radius and alpha. */
  forEach(fn: (x: number, y: number, radius: number, alpha: number) => void): void;
  readonly count: number;
  clear(): void;
};

type Particle = { x: number; y: number; vx: number; vy: number; life: number; size: number; drag: number; buoyancy: number; age: number };

/** Alpha over a particle's life: fades in over the first DUST.fadeIn, then out. */
const alphaAt = (u: number) => (u < DUST.fadeIn ? u / DUST.fadeIn : 1 - (u - DUST.fadeIn) / (1 - DUST.fadeIn));

export function createParticles(max: number = DUST.max): Particles {
  const list: Particle[] = [];
  return {
    emit(x, y, vx, vy, life, size, drag = DUST.drag, buoyancy = DUST.buoyancy) {
      if (list.length >= max) return false;
      list.push({ x, y, vx, vy, life, size, drag, buoyancy, age: 0 });
      return true;
    },
    step(dt) {
      let n = 0;
      for (const p of list) {
        p.age += dt;
        if (p.age >= p.life) continue;
        const k = Math.pow(p.drag, dt * 60);
        p.vx *= k;
        p.vy = p.vy * k - p.buoyancy * dt;
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        list[n++] = p;
      }
      list.length = n;
    },
    forEach(fn) {
      for (const p of list) {
        const a = alphaAt(p.age / p.life);
        fn(p.x, p.y, p.size * (0.5 + 0.5 * a), a);
      }
    },
    get count() {
      return list.length;
    },
    clear() {
      list.length = 0;
    },
  };
}

/**
 * Throws dust off the hole's edge: count particles (a fractional count rounds at random), moving
 * outwards at about speed px/s with a little swirl, living about life seconds.
 */
export function emitFromBlob(
  particles: Particles,
  blob: Blob,
  radius: number,
  wobble: number,
  timeSeconds: number,
  count: number,
  speed: number,
  life: number,
  random: () => number,
): void {
  const n = Math.floor(count + random());
  const [cx, cy] = blob.center;
  for (let i = 0; i < n; i++) {
    const a = random() * Math.PI * 2;
    const c = Math.cos(a);
    const s = Math.sin(a);
    const r = radius * blobScaleAt(blob, a, wobble, timeSeconds);
    const v = speed * (0.4 + random() * 0.8);
    const swirl = (random() - 0.5) * speed * 0.7;
    particles.emit(cx + c * r, cy + s * r, c * v - s * swirl, s * v + c * swirl, life * (0.6 + random() * 0.8), 1.4 + random() * 3);
  }
}

/** Draws a particle system on a canvas that fills its parent. */
export function createDustCanvas(canvas: HTMLCanvasElement): {
  resize(width: number, height: number): void;
  draw(particles: Particles): void;
  clear(): void;
} {
  const ctx = canvas.getContext("2d");
  // A soft gold dot, drawn once and stamped for every particle
  const sprite = document.createElement("canvas");
  sprite.width = sprite.height = 32;
  const sctx = sprite.getContext("2d");
  if (sctx) {
    const g = sctx.createRadialGradient(16, 16, 0, 16, 16, 16);
    g.addColorStop(0, "rgba(255,246,224,1)");
    g.addColorStop(0.3, "rgba(251,191,106,0.55)");
    g.addColorStop(1, "rgba(251,191,106,0)");
    sctx.fillStyle = g;
    sctx.fillRect(0, 0, 32, 32);
  }
  let width = 0;
  let height = 0;
  let dirty = false;
  const clear = () => {
    ctx?.clearRect(0, 0, width, height);
    dirty = false;
  };
  return {
    resize(w, h) {
      const ratio = Math.min(devicePixelRatio || 1, DUST.maxPixelRatio);
      width = w;
      height = h;
      canvas.width = Math.max(1, Math.round(w * ratio));
      canvas.height = Math.max(1, Math.round(h * ratio));
      ctx?.setTransform(ratio, 0, 0, ratio, 0, 0);
      dirty = true;
    },
    draw(particles) {
      if (!ctx) return;
      if (!particles.count) {
        if (dirty) clear();
        return;
      }
      ctx.clearRect(0, 0, width, height);
      dirty = true;
      ctx.globalCompositeOperation = "lighter";
      particles.forEach((x, y, r, a) => {
        ctx.globalAlpha = a;
        ctx.drawImage(sprite, x - r, y - r, r * 2, r * 2);
      });
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = "source-over";
    },
    clear,
  };
}

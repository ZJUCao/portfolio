// The cut engine: moves between idle, drawing, growing (the wand), opening, the window (peek),
// stepping through and closing; tells the target the window's shape and draws the rim, ripples and
// dust through a renderer. createCutController is the DOM-free core, driven in tests by a fake
// clock and renderer; createCut wires it to an effect element. No React.
// Contract: docs/design_space_cut.md §5.2.

import { CLICK, KNIFE, PARALLAX, REDUCED, THROUGH, WAND } from "./constants";
import { createParticles, emitFromBlob, type Particles } from "./dust";
import { createFxLayer } from "./fxLayer";
import {
  autoCutLine,
  type Blob,
  blobCoverScale,
  blobPoints,
  checkStroke,
  fitLine,
  type InputSource,
  inPolygon,
  type Line,
  lensCoverScale,
  lensHalfWidth,
  lensPoints,
  makeBlob,
  type Pt,
  type Size,
} from "./geometry";
import { createRecognizer, type GestureEvent, type Intent, type Tools } from "./gesture";
import { type Clock, clamp, createTimeline, ease, lerp } from "./timeline";

export type Phase = "idle" | "drawing" | "growing" | "opening" | "peek" | "through" | "closing";

export type CutTarget = {
  /** The window's outline in the surface's px; [] hides the other world, null shows all of it. */
  setWindow(polygon: readonly Pt[] | null): void;
  /** The other world drifts by (dx, dy) and scales about origin while the window is open. */
  setParallax?(dx: number, dy: number, scale: number, origin: Pt): void;
  /** Reduce motion: the other world's opacity during the crossfade that replaces the cut. */
  setFade?(opacity: number): void;
};

export type CutOptions = {
  /** Whether to stop at the window (camera AR, the easter egg) or go straight through. */
  stop: boolean;
  tools: Tools;
  reducedMotion: boolean;
  onPhase?(phase: Phase): void;
  /** A stroke too short or not straight enough, for the hint line. */
  onReject?(reason: "too-short" | "not-straight"): void;
  onThrough(): void;
  onClose(): void;
};

/** Opacities of the rim's three layers: the inner shadow, the glow and the bright core. */
export type RimStyle = { shadow: number; glow: number; core: number; gold: boolean };
export type Ripple = { p: Pt; r: number; alpha: number };

/** What the engine draws on the effect layer. */
export interface CutRenderer {
  size(): Size;
  stroke(points: readonly Pt[] | null, opacity?: number, glowBoost?: number): void;
  /** Fades the stroke out over ms, then clears it. */
  fadeStroke(ms: number): void;
  rim(polygon: readonly Pt[] | null, style?: RimStyle): void;
  /** The wand's tip: a dot and a glow, or null to hide it. */
  tip(p: Pt | null, dotRadius?: number, glowRadius?: number, alpha?: number): void;
  ripples(list: readonly Ripple[]): void;
  dust(particles: Particles): void;
  destroy(): void;
}

export type Cut = {
  input(event: GestureEvent): void;
  /** Click to cut at a point (D9). */
  clickAt(p: Pt): void;
  /** Keyboard: a medium window at the centre, stopping there (D8). */
  openCentered(): void;
  stepThrough(): void;
  close(): void;
  /** Drops whatever is in progress and hides the other world (on resize, say). */
  reset(): void;
  isInsideWindow(p: Pt): boolean;
  readonly phase: Phase;
  destroy(): void;
};

export type CutDeps = { clock: Clock; random: () => number };

type LensWindow = { kind: "lens"; line: Line; halfWidth: number; sharpness: number };
type BlobWindow = { kind: "blob"; blob: Blob; radius: number; wobble: number };
type CutWindow = LensWindow | BlobWindow;
type Grow = { t0: number; r: number; released: boolean; relAt: number; rRel: number; rEnd: number; nextRip: number; short: number };
type RippleState = { p: Pt; r0: number; r1: number; dur: number; age: number };

const centerOf = (w: CutWindow): Pt => (w.kind === "lens" ? w.line.mid : w.blob.center);
const rimOpen = (t: number): RimStyle => {
  const u = clamp(t, 0, 1);
  return { shadow: u, glow: lerp(1, 0.35, u), core: lerp(1, 0.6, u), gold: false };
};
const rimFade = (k: number, gold: boolean): RimStyle => ({ shadow: k, glow: 0.35 * k, core: 0.6 * k, gold });
const rimClose = (t: number): RimStyle => ({ shadow: 1 - t, glow: lerp(0.35, 1, t), core: lerp(0.6, 1, t), gold: false });
const RIM_GOLD = { glow: 0.45, core: 0.7 };
const MAX_RIPPLES = 3;

export function createCutController(renderer: CutRenderer, target: CutTarget, options: CutOptions, deps: CutDeps): Cut {
  const { clock, random } = deps;
  const timeline = createTimeline(clock);
  const recognizer = createRecognizer(options.tools);
  const particles = createParticles();

  let phase: Phase = "idle";
  let win: CutWindow | null = null;
  /** The window's current outline; [] while the other world is hidden. */
  let polygon: Pt[] = [];
  let grow: Grow | null = null;
  /** D1: the young hole collapsing after its press became a knife stroke. */
  let collapse: { blob: Blob; r: number; t0: number } | null = null;
  let ripples: RippleState[] = [];
  let parallax = { x: 0, y: 0, origin: [0, 0] as Pt };
  let ambient: (() => void) | null = null;
  let destroyed = false;

  const setPhase = (next: Phase) => {
    if (next === phase) return;
    phase = next;
    options.onPhase?.(next);
  };
  const viewport = () => renderer.size();
  const shortSide = () => Math.min(viewport().width, viewport().height);
  const show = (pts: Pt[], rim?: RimStyle) => {
    polygon = pts;
    target.setWindow(pts);
    if (rim) renderer.rim(pts, rim);
  };
  const hide = () => {
    polygon = [];
    target.setWindow([]);
    renderer.rim(null);
  };
  const par = (x: number, y: number, scale: number, origin: Pt = parallax.origin) => {
    parallax = { x, y, origin };
    target.setParallax?.(x, y, scale, origin);
  };

  // One frame loop for everything that moves on its own: the growing hole, the collapse, dust and ripples
  const wake = () => {
    if (ambient || destroyed) return;
    ambient = timeline.loop((now, rawDt) => {
      const dt = Math.min(rawDt, 0.05);
      if (grow) growTick(now, dt);
      if (collapse) collapseTick(now);
      particles.step(dt);
      renderer.dust(particles);
      stepRipples(dt);
      if (grow || collapse || particles.count || ripples.length) return true;
      ambient = null;
      return false;
    });
  };

  const spawnRipple = (p: Pt, r0: number, r1: number, dur: number) => {
    ripples.push({ p, r0, r1, dur, age: 0 });
    if (ripples.length > MAX_RIPPLES) ripples.shift();
  };
  const stepRipples = (dt: number) => {
    for (const q of ripples) q.age += dt;
    ripples = ripples.filter((q) => q.age < q.dur);
    renderer.ripples(ripples.map((q) => ({ p: q.p, r: lerp(q.r0, q.r1, ease.outCubic(q.age / q.dur)), alpha: 0.5 * (1 - q.age / q.dur) })));
  };

  // ---- wand: the hole grows while held and settles after release ----
  function wandStart(p: Pt) {
    if (options.reducedMotion) {
      setPhase("opening");
      void crossfade();
      return;
    }
    const short = shortSide();
    win = { kind: "blob", blob: makeBlob(p, random), radius: 0, wobble: WAND.wobbleStart };
    grow = { t0: clock.now(), r: 0, released: false, relAt: 0, rRel: 0, rEnd: 0, nextRip: 0, short };
    setPhase("growing");
    par(0, 0, PARALLAX.scale, p);
    wake();
  }

  function wandRelease(now = clock.now()) {
    if (!grow || grow.released) return;
    grow.released = true;
    grow.relAt = now;
    grow.rRel = grow.r;
    grow.rEnd = Math.max(grow.r * WAND.settleGrowth, grow.short * WAND.radiusMinShort);
  }

  function growTick(now: number, dt: number) {
    const g = grow as Grow;
    const w = win as BlobWindow;
    const el = (now - g.t0) / 1000;
    const time = now / 1000;
    const shadow = (r: number) => clamp(r / (g.short * WAND.rimFullShort), 0, 1);
    let r: number;
    let rim: RimStyle;
    let tipAlpha: number;
    let growing: boolean;
    let done = false;
    if (!g.released) {
      const u = clamp((el - WAND.delayS) / WAND.holdMaxS, 0, 1);
      r = g.short * WAND.radiusMaxShort * (1 - (1 - u) * (1 - u));
      rim = { shadow: shadow(r), glow: 0.9, core: 0.95, gold: true };
      tipAlpha = 0.85;
      growing = u < 1;
      if (el > WAND.holdMaxS + WAND.stuckS) wandRelease(now); // the release never arrived
    } else {
      const u = clamp((now - g.relAt) / 1000 / WAND.settleS, 0, 1);
      r = lerp(g.rRel, g.rEnd, ease.outCubic(u));
      rim = { shadow: shadow(r), glow: lerp(0.9, RIM_GOLD.glow, u), core: lerp(0.95, RIM_GOLD.core, u), gold: true };
      tipAlpha = 0.85 * (1 - u);
      growing = false;
      done = u >= 1;
    }
    // The tip flashes as it touches, then pulses gently while held
    const flash = clamp(el / WAND.delayS, 0, 1);
    renderer.tip(w.blob.center, (2.5 + 4 * flash) * (0.7 + 0.3 * Math.sin(now / 90)), 24 + 18 * flash + 6 * Math.sin(now / 140), tipAlpha);
    // A ripple as it touches, and another every half second while the hole grows
    if (growing && el >= g.nextRip) {
      const r0 = Math.max(r, 6);
      spawnRipple(w.blob.center, r0, r0 + g.short * WAND.rippleReachShort, WAND.rippleDurS);
      g.nextRip = el + WAND.rippleEveryS;
    }
    const wobble = lerp(WAND.wobbleStart, 1, clamp(el / WAND.wobbleRampS, 0, 1));
    if (r > 0.5) {
      show(blobPoints(w.blob, r, wobble, time), rim);
      emitFromBlob(particles, w.blob, r, wobble, time, Math.max(0, r - g.r) * 0.9 + dt * 10, 80, 1.2, random);
    }
    g.r = r;
    w.radius = Math.max(r, 0.5);
    w.wobble = wobble;
    if (done) {
      grow = null;
      renderer.tip(null);
      afterOpen();
    }
  }

  // D1: the press became a stroke, so the young hole closes quickly while the knife draws
  function abortWand() {
    if (grow && win?.kind === "blob" && polygon.length) collapse = { blob: win.blob, r: grow.r, t0: clock.now() };
    grow = null;
    win = null;
    renderer.tip(null);
    par(0, 0, 1);
  }

  function collapseTick(now: number) {
    const c = collapse as NonNullable<typeof collapse>;
    const u = clamp((now - c.t0) / WAND.abortMs, 0, 1);
    if (u >= 1) {
      collapse = null;
      hide();
      return;
    }
    show(blobPoints(c.blob, c.r * (1 - u), 1, now / 1000), rimFade(1 - u, true));
  }

  // ---- knife ----
  function strokeEnd(points: readonly Pt[], source: InputSource) {
    if (points.length < 3) return dropStroke();
    const line = fitLine(points);
    const verdict = checkStroke(line, viewport(), source);
    if (verdict !== "ok") {
      dropStroke();
      options.onReject?.(verdict);
      return;
    }
    void openLens(line, points);
  }

  function dropStroke() {
    renderer.fadeStroke(350);
    recognizer.reset();
    setPhase("idle");
  }

  async function openLens(line: Line, raw: readonly Pt[]) {
    setPhase("opening");
    if (options.reducedMotion) {
      renderer.fadeStroke(350);
      return crossfade();
    }
    const along = (p: Pt): Pt => {
      const t = (p[0] - line.mid[0]) * line.dir[0] + (p[1] - line.mid[1]) * line.dir[1];
      return [line.mid[0] + line.dir[0] * t, line.mid[1] + line.dir[1] * t];
    };
    const taut = raw.map(along);
    // 1. the hand-drawn line snaps taut
    const morph = (t: number) => raw.map((p, i): Pt => [lerp(p[0], taut[i][0], t), lerp(p[1], taut[i][1], t)]);
    if (!(await timeline.tween(KNIFE.tautMs, (t) => renderer.stroke(morph(t), 1, 1 + 0.6 * t), ease.outCubic))) return;
    // 2. a pause while the glow dims
    if (!(await timeline.tween(KNIFE.pauseMs, (t) => renderer.stroke(taut, 1, 1.6 - 0.6 * t)))) return;
    // 3. the two sides part
    const w: LensWindow = { kind: "lens", line, halfWidth: lensHalfWidth(line, viewport()), sharpness: KNIFE.sharpness };
    win = w;
    const opened = await timeline.tween(
      KNIFE.openMs,
      (t) => {
        show(lensPoints(line, 1, w.halfWidth * t, w.sharpness), rimOpen(t));
        renderer.stroke(taut, clamp(1 - t * 1.4, 0, 1));
        par(0, 0, lerp(1, PARALLAX.scale, clamp(t, 0, 1)), line.mid);
      },
      ease.outBack,
    );
    if (!opened) return;
    renderer.stroke(null);
    afterOpen();
  }

  // ---- click to cut (D9) ----
  async function autoCut(p: Pt, stop: boolean) {
    if (phase !== "idle" || destroyed) return;
    setPhase("opening");
    if (options.reducedMotion) return crossfade();
    const line = autoCutLine(p, viewport(), random);
    const { dir, halfLength: hl } = line;
    const segment = (t: number): Pt[] => [
      [p[0] - dir[0] * hl * t, p[1] - dir[1] * hl * t],
      [p[0] + dir[0] * hl * t, p[1] + dir[1] * hl * t],
    ];
    if (!(await timeline.tween(CLICK.lineMs, (t) => renderer.stroke(segment(t), 1), ease.outCubic))) return;
    if (!(await timeline.wait(CLICK.pauseMs))) return;
    const w: LensWindow = { kind: "lens", line, halfWidth: hl * CLICK.halfWidthRatio, sharpness: KNIFE.sharpness };
    win = w;
    const opened = await timeline.tween(
      CLICK.openMs,
      (t) => {
        show(lensPoints(line, 1, w.halfWidth * t, w.sharpness), rimOpen(t));
        renderer.stroke(segment(1), 1 - t);
        par(0, 0, lerp(1, PARALLAX.scale, t), p);
      },
      ease.outCubic,
    );
    if (!opened) return;
    renderer.stroke(null);
    if (stop) setPhase("peek");
    else await stepThrough(CLICK.expandMs);
  }

  function afterOpen() {
    if (options.stop) setPhase("peek");
    else void stepThrough();
  }

  // ---- through, crossfade, close ----
  async function stepThrough(ms: number = THROUGH.ms) {
    const w = win;
    if (!w || destroyed) return;
    setPhase("through");
    if (options.reducedMotion) return crossfade();
    const from = { ...parallax };
    const back = (t: number) => par(from.x * (1 - t), from.y * (1 - t), lerp(PARALLAX.scale, 1, t));
    let ok: boolean;
    if (w.kind === "lens") {
      const k = lensCoverScale(w.line, w.halfWidth, viewport());
      const s0 = w.sharpness;
      ok = await timeline.tween(
        ms,
        (t) => {
          show(lensPoints(w.line, Math.pow(k, t), w.halfWidth, lerp(s0, KNIFE.sharpnessThrough, t)), rimFade(1 - t, false));
          back(t);
        },
        ease.inOutSine,
      );
    } else {
      // The hole speeds up as it grows, its edge rounds off, and a last handful of dust flies off
      const k = blobCoverScale(w.blob, w.radius, viewport());
      ok = await timeline.tween(
        ms,
        (t) => {
          const time = clock.now() / 1000;
          const r = w.radius * Math.pow(k, t);
          const wobble = w.wobble * (1 - t);
          show(blobPoints(w.blob, r, wobble, time), rimFade(1 - t, true));
          if (t < THROUGH.dustUntil) {
            emitFromBlob(particles, w.blob, r, wobble, time, 5, 140, 0.9, random);
            wake();
          }
          back(t);
        },
        ease.inOutSine,
      );
    }
    if (ok) finishThrough();
  }

  async function crossfade() {
    setPhase("through");
    renderer.stroke(null);
    renderer.tip(null);
    renderer.rim(null);
    target.setFade?.(0);
    polygon = [];
    target.setWindow(null);
    if (await timeline.tween(REDUCED.fadeMs, (t) => target.setFade?.(t))) finishThrough();
  }

  function finishThrough() {
    win = null;
    polygon = [];
    target.setWindow(null);
    renderer.rim(null);
    renderer.stroke(null);
    renderer.tip(null);
    par(0, 0, 1);
    recognizer.reset();
    setPhase("idle");
    options.onThrough();
  }

  async function close() {
    const w = win;
    if (!w || destroyed || (phase !== "peek" && phase !== "growing")) return;
    grow = null;
    setPhase("closing");
    const from = { ...parallax };
    const back = (t: number) => par(from.x * (1 - t), from.y * (1 - t), lerp(PARALLAX.scale, 1, t));
    if (w.kind === "lens") {
      // The sides come together and leave a scar that slowly fades
      const closed = await timeline.tween(
        KNIFE.closeMs,
        (t) => {
          show(lensPoints(w.line, 1, w.halfWidth * (1 - t), w.sharpness), rimClose(t));
          back(t);
        },
        ease.inCubic,
      );
      if (!closed) return;
      const { mid, dir, halfLength: hl } = w.line;
      renderer.stroke(
        [
          [mid[0] - dir[0] * hl, mid[1] - dir[1] * hl],
          [mid[0] + dir[0] * hl, mid[1] + dir[1] * hl],
        ],
        KNIFE.scarOpacity,
      );
      renderer.fadeStroke(KNIFE.scarFadeMs);
    } else {
      // The hole shrinks, the dust is drawn back into the centre, and the tip flashes once
      const r0 = w.radius;
      const [cx, cy] = w.blob.center;
      const closed = await timeline.tween(
        WAND.closeMs,
        (t) => {
          const r = Math.max(0.5, r0 * (1 - t));
          show(blobPoints(w.blob, r, 1, clock.now() / 1000), { shadow: 1 - t, glow: lerp(RIM_GOLD.glow, 1, t), core: lerp(RIM_GOLD.core, 1, t), gold: true });
          const n = Math.floor(9 * (1 - t) + random());
          for (let i = 0; i < n; i++) {
            const a = random() * Math.PI * 2;
            const life = 0.3 + random() * 0.2;
            particles.emit(cx + Math.cos(a) * r, cy + Math.sin(a) * r, (-Math.cos(a) * r) / life, (-Math.sin(a) * r) / life, life, 1.2 + random() * 2, 1, 0);
          }
          wake();
          renderer.tip(w.blob.center, 1.5 + 4 * t, 12 + 30 * t, t);
          back(t);
        },
        ease.inCubic,
      );
      if (!closed) return;
      hide();
      const flashed = await timeline.tween(WAND.flashMs, (t) => renderer.tip(w.blob.center, 5.5 * (1 - t), 42 + 40 * t, 1 - t), ease.outCubic);
      renderer.tip(null);
      if (!flashed) return;
    }
    win = null;
    hide();
    par(0, 0, 1);
    recognizer.reset();
    setPhase("idle");
    options.onClose();
  }

  function reset() {
    timeline.cancelAll();
    ambient = null;
    grow = null;
    collapse = null;
    ripples = [];
    particles.clear();
    renderer.dust(particles);
    renderer.ripples([]);
    renderer.stroke(null);
    renderer.tip(null);
    recognizer.reset();
    if (phase !== "idle" || polygon.length) {
      hide();
      par(0, 0, 1);
    }
    win = null;
    setPhase("idle");
  }

  const centre = (): Pt => [viewport().width / 2, viewport().height / 2];

  function handle(intent: Intent) {
    switch (intent.kind) {
      case "press":
        if (phase === "peek") void (inPolygon(intent.p, polygon) ? stepThrough() : close());
        break;
      case "wand-start":
        if (phase === "idle") wandStart(intent.p);
        break;
      case "wand-end":
        if (phase === "growing") wandRelease();
        break;
      case "stroke-start":
        if (phase === "growing" && grow && !grow.released) abortWand();
        else if (phase !== "idle") break;
        setPhase("drawing");
        renderer.stroke(intent.points, 1);
        wake();
        break;
      case "stroke-move":
        if (phase === "drawing") renderer.stroke(intent.points, 1);
        break;
      case "stroke-end":
        if (phase === "drawing") strokeEnd(intent.points, intent.source);
        break;
      case "tap":
        if (phase === "idle") void autoCut(intent.p, options.stop);
        break;
      case "hover":
        if (phase === "peek" && win && intent.source !== "touch") {
          const c = centerOf(win);
          const drift = (d: number) => clamp(d * PARALLAX.factor, -PARALLAX.maxPx, PARALLAX.maxPx);
          par(drift(intent.p[0] - c[0]), drift(intent.p[1] - c[1]), PARALLAX.scale, c);
        }
        break;
      case "cancel":
        if (phase === "drawing") dropStroke();
        else if (phase === "growing") wandRelease();
        break;
      case "key":
        if (intent.key === "activate") {
          if (phase === "idle") void autoCut(centre(), options.stop);
          else if (phase === "peek") void stepThrough();
        } else if (phase === "peek" || phase === "growing") void close();
        else if (phase === "drawing") dropStroke();
        break;
    }
  }

  return {
    input(event) {
      if (destroyed) return;
      for (const intent of recognizer.feed(event)) handle(intent);
    },
    clickAt: (p) => void autoCut(p, options.stop),
    openCentered: () => void autoCut(centre(), true),
    stepThrough: () => {
      if (phase === "peek") void stepThrough();
    },
    close: () => void close(),
    reset: () => {
      if (!destroyed) reset();
    },
    isInsideWindow: (p) => phase === "peek" && inPolygon(p, polygon),
    get phase() {
      return phase;
    },
    destroy() {
      if (destroyed) return;
      reset();
      destroyed = true;
      renderer.destroy();
    },
  };
}

/** The engine on an effect element: an SVG for the rim, ripples and stroke, and a canvas for the dust. */
export function createCut(fx: HTMLElement, target: CutTarget, options: CutOptions): Cut {
  const clock: Clock = {
    now: () => performance.now(),
    frame: (callback) => requestAnimationFrame(callback),
    cancel: (id) => cancelAnimationFrame(id),
  };
  return createCutController(createFxLayer(fx), target, options, { clock, random: Math.random });
}

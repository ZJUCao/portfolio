// Page-change cuts (docs/design_space_cut.md §5.3, §6.1, §12 P0-1 and P0-2). React starts no view
// transition when the [lang] root layout remounts, so the language switch wraps its own navigation:
// the line is drawn on the live page first while the new page loads, then document.startViewTransition
// takes the old page as a still snapshot and Web Animations cut the new one open through the lens.
// The rim is drawn on an effect layer named cut-fx, which stays live during the transition.

import { CLICK, KNIFE } from "./constants";
import type { CutRenderer, RimStyle } from "./engine";
import { createFxLayer } from "./fxLayer";
import { autoCutLine, type Line, lensCoverScale, lensPoints, type Pt, type Size, toClipPath } from "./geometry";
import { type Clock, createTimeline, ease, lerp } from "./timeline";

/** View transition type of the cut; globals.css keeps the old page still for it. */
export const CUT_TYPE = "cut";
/** View transition type of the reduce-motion crossfade (200 ms in globals.css). */
export const FADE_TYPE = "cut-fade";
/** Inside the transition: the lens opens, then expands until it covers the screen (D9). */
export const PAGE_CUT_MS = CLICK.openMs + CLICK.expandMs;
/** Waiting longer than this for the new page lets the transition go on regardless (browsers give up at 4 s). */
const ARRIVAL_TIMEOUT_MS = 3000;
const EFFECT_NAME = "cut-fx";

/** The window and its rim ms after the transition is ready. */
export function pageCutWindow(line: Line, viewport: Size, ms: number): { polygon: Pt[]; rim: RimStyle } {
  const halfWidth = line.halfLength * CLICK.halfWidthRatio;
  if (ms < CLICK.openMs) {
    const t = ease.outCubic(Math.max(0, ms) / CLICK.openMs);
    return {
      polygon: lensPoints(line, 1, halfWidth * t, KNIFE.sharpness),
      rim: { shadow: t, glow: lerp(1, 0.35, t), core: lerp(1, 0.6, t), gold: false },
    };
  }
  const u = ease.inOutSine(Math.min(1, (ms - CLICK.openMs) / CLICK.expandMs));
  const k = lensCoverScale(line, halfWidth, viewport);
  return {
    polygon: lensPoints(line, Math.pow(k, u), halfWidth, lerp(KNIFE.sharpness, KNIFE.sharpnessThrough, u)),
    rim: { shadow: 1 - u, glow: 0.35 * (1 - u), core: 0.6 * (1 - u), gold: false },
  };
}

/**
 * Keyframes for the clip-path of ::view-transition-new(root): the curve of pageCutWindow sampled at
 * steady steps, so linear interpolation between them follows its easing. Every frame has the same points.
 */
export function pageCutKeyframes(line: Line, viewport: Size): Keyframe[] {
  const times: number[] = [];
  for (let i = 0; i <= 6; i++) times.push((CLICK.openMs * i) / 6);
  for (let i = 1; i <= 16; i++) times.push(CLICK.openMs + (CLICK.expandMs * i) / 16);
  return times.map((ms) => ({ offset: ms / PAGE_CUT_MS, clipPath: toClipPath(pageCutWindow(line, viewport, ms).polygon) }));
}

export type CutNavigateOptions = {
  /** Centre of the link or button, in viewport px. */
  origin: Pt;
  /** Starts the navigation, e.g. router.push(href). */
  navigate(): void;
  /** Whether the new page is in, e.g. <html lang> is already the target language. */
  arrived(): boolean;
  reducedMotion: boolean;
};

let running = false;
let layer: { element: HTMLElement; renderer: CutRenderer } | null = null;

/** The effect layer: a fixed element on body, created once and put back if React removed it. */
function ensureLayer() {
  if (layer?.element.isConnected) return layer;
  layer?.renderer.destroy();
  const element = document.createElement("div");
  element.setAttribute("aria-hidden", "true");
  element.style.cssText = "position:fixed;inset:0;z-index:2147483646;pointer-events:none";
  document.body.append(element);
  layer = { element, renderer: createFxLayer(element) };
  return layer;
}

/** The view transition's update callback: navigate, then resolve once the new page is in the DOM. */
function arrival(options: CutNavigateOptions, effect: HTMLElement | null) {
  return () =>
    new Promise<void>((resolve) => {
      let done = false;
      const finish = () => {
        if (done) return;
        done = true;
        observer.disconnect();
        clearTimeout(timer);
        // The root layout remounted; if React took the effect layer out of body, put it back so the
        // new state has it too and it stays live (§12)
        if (effect && !effect.isConnected) document.body.append(effect);
        resolve();
      };
      // Rendering is paused inside this callback, so it must not wait for requestAnimationFrame (§12.1)
      const observer = new MutationObserver(() => {
        if (options.arrived()) finish();
      });
      observer.observe(document.documentElement, { attributes: true, attributeFilter: ["lang"] });
      const timer = setTimeout(finish, ARRIVAL_TIMEOUT_MS);
      options.navigate();
      if (options.arrived()) finish();
    });
}

/**
 * Navigates with a cut from the origin: the line (120 ms) and a pause (40 ms) on the live page, then a
 * view transition in which the new page opens through a lens (200 ms) that grows over the screen (480 ms).
 * With reduce motion on it is a 200 ms crossfade; without view transitions it only navigates.
 */
export async function cutNavigate(options: CutNavigateOptions): Promise<void> {
  if (running || typeof document.startViewTransition !== "function") {
    options.navigate();
    return;
  }
  running = true;
  if (options.reducedMotion) {
    try {
      await document.startViewTransition({ update: arrival(options, null), types: [FADE_TYPE] }).finished;
    } catch {
      // a skipped transition still ran its update, so the page has changed
    } finally {
      running = false;
    }
    return;
  }

  const clock: Clock = {
    now: () => performance.now(),
    frame: (callback) => requestAnimationFrame(callback),
    cancel: (id) => cancelAnimationFrame(id),
  };
  const timeline = createTimeline(clock);
  const viewport = { width: window.innerWidth, height: window.innerHeight };
  const line = autoCutLine(options.origin, viewport, Math.random);
  const { element, renderer } = ensureLayer();
  const [x, y] = options.origin;
  const segment = (t: number): Pt[] => [
    [x - line.dir[0] * line.halfLength * t, y - line.dir[1] * line.halfLength * t],
    [x + line.dir[0] * line.halfLength * t, y + line.dir[1] * line.halfLength * t],
  ];
  try {
    // 1. the line, on the live page, while the new page's data loads
    await timeline.tween(CLICK.lineMs, (t) => renderer.stroke(segment(t), 1), ease.outCubic);
    await timeline.wait(CLICK.pauseMs);
    // 2. the old page becomes a still snapshot; the effect layer stays live under its own name
    element.style.viewTransitionName = EFFECT_NAME;
    const transition = document.startViewTransition({ update: arrival(options, element), types: [CUT_TYPE] });
    try {
      await transition.ready;
    } catch {
      return; // skipped (another transition, a timeout): the navigation has still happened
    }
    // 3. the new page opens through the lens, and the rim follows the same curve
    document.documentElement.animate(pageCutKeyframes(line, viewport), {
      duration: PAGE_CUT_MS,
      fill: "both",
      pseudoElement: "::view-transition-new(root)",
    });
    await timeline.tween(PAGE_CUT_MS, (_, raw) => {
      const ms = raw * PAGE_CUT_MS;
      const { polygon, rim } = pageCutWindow(line, viewport, ms);
      renderer.rim(polygon, rim);
      renderer.stroke(ms < CLICK.openMs ? segment(1) : null, 1 - ms / CLICK.openMs);
    });
    await transition.finished.catch(() => {});
  } finally {
    timeline.cancelAll();
    renderer.stroke(null);
    renderer.rim(null);
    element.style.viewTransitionName = "";
    running = false;
  }
}

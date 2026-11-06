// Input recognizer of the space-cut transitions: normalized pointer, hand and keyboard events in,
// intents out (a wand press, a knife stroke, a tap, a key). It applies the D1 rule: a press lights
// the wand at once, and moving further than 10 px (40 px for hands) within 250 ms turns it into a
// knife stroke. No DOM, no React. Contract: docs/design_space_cut.md §4, §5.2.

import { GESTURE, KNIFE } from "./constants";
import type { InputSource, Pt } from "./geometry";

/** A normalized input event. x and y are CSS px in the cut surface's box; t is in ms. */
export type GestureEvent =
  | { type: "down" | "move" | "up"; x: number; y: number; t: number; source: InputSource; id: number }
  | { type: "cancel"; t: number; source: InputSource; id: number }
  | { type: "key"; key: string; t: number };

export type Tools = { knife: boolean; wand: boolean; click: boolean };

export type Intent =
  /** Every primary press, before anything else is decided (used while a window is open). */
  | { kind: "press"; p: Pt; source: InputSource }
  | { kind: "wand-start"; p: Pt; t: number; source: InputSource }
  | { kind: "wand-end"; t: number }
  /** A press became a stroke; if the wand had started, the engine collapses its hole (D1). */
  | { kind: "stroke-start"; points: readonly Pt[]; t: number; source: InputSource }
  | { kind: "stroke-move"; points: readonly Pt[]; t: number }
  | { kind: "stroke-end"; points: readonly Pt[]; t: number; source: InputSource }
  /** A press and release without moving, where the click tool is on and the wand is off. */
  | { kind: "tap"; p: Pt; t: number; source: InputSource }
  /** Pointer movement with no press, or a press that is neither stroke nor wand. */
  | { kind: "hover"; p: Pt; source: InputSource }
  /** The active press was cancelled by the system (pointercancel, the hand lost). */
  | { kind: "cancel"; t: number }
  /** Enter or Space is "activate", Escape is "escape". */
  | { kind: "key"; key: "activate" | "escape" };

export type Recognizer = {
  feed(event: GestureEvent): Intent[];
  reset(): void;
};

type Press = {
  id: number;
  source: InputSource;
  down: Pt;
  t0: number;
  points: Pt[];
  /** "wand" once the wand has started; "stroke" once the press became a stroke. */
  mode: "plain" | "wand" | "stroke";
};

const isHand = (source: InputSource) => source === "hand";
const dist = (a: Pt, b: Pt) => Math.hypot(a[0] - b[0], a[1] - b[1]);

export function createRecognizer(tools: Tools): Recognizer {
  let press: Press | null = null;

  const sample = (p: Pt) => {
    if (!press) return;
    const last = press.points[press.points.length - 1];
    if (!last || dist(p, last) > KNIFE.minSamplePx) press.points.push(p);
  };

  function feed(e: GestureEvent): Intent[] {
    if (e.type === "key") {
      if (e.key === "Enter" || e.key === " ") return [{ kind: "key", key: "activate" }];
      if (e.key === "Escape") return [{ kind: "key", key: "escape" }];
      return [];
    }
    if (e.type === "cancel") {
      if (!press || e.id !== press.id) return [];
      press = null;
      return [{ kind: "cancel", t: e.t }];
    }
    const p: Pt = [e.x, e.y];
    if (e.type === "down") {
      if (press) return []; // one press at a time: a second finger or pointer is ignored
      press = { id: e.id, source: e.source, down: p, t0: e.t, points: [p], mode: tools.wand ? "wand" : "plain" };
      const out: Intent[] = [{ kind: "press", p, source: e.source }];
      if (tools.wand) out.push({ kind: "wand-start", p, t: e.t, source: e.source });
      return out;
    }
    if (!press) return e.type === "move" ? [{ kind: "hover", p, source: e.source }] : [];
    if (e.id !== press.id) return [];

    if (e.type === "move") {
      if (press.mode === "stroke") {
        sample(p);
        return [{ kind: "stroke-move", points: press.points.slice(), t: e.t }];
      }
      sample(p);
      // D1: with the wand on, only a quick move becomes a stroke; with the knife alone, any move does
      const far = dist(p, press.down) > (isHand(press.source) ? GESTURE.strokeMovePxHand : GESTURE.strokeMovePx);
      const quick = !tools.wand || e.t - press.t0 <= GESTURE.strokeWindowMs;
      if (tools.knife && far && quick) {
        press.mode = "stroke";
        return [{ kind: "stroke-start", points: press.points.slice(), t: e.t, source: press.source }];
      }
      return [];
    }

    // up
    const ended = press;
    press = null;
    if (ended.mode === "stroke") {
      const last = ended.points[ended.points.length - 1];
      if (dist(p, last) > KNIFE.minSamplePx) ended.points.push(p);
      return [{ kind: "stroke-end", points: ended.points, t: e.t, source: ended.source }];
    }
    if (ended.mode === "wand") return [{ kind: "wand-end", t: e.t }];
    const reach = isHand(ended.source) ? GESTURE.tapMovePxHand : GESTURE.tapMovePx;
    if (tools.click && dist(p, ended.down) <= reach) return [{ kind: "tap", p: ended.down, t: e.t, source: ended.source }];
    return [];
  }

  return {
    feed,
    reset() {
      press = null;
    },
  };
}

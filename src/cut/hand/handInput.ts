// One hand, frame by frame, becomes the same input events as a mouse (requirements §3.5): an open
// hand moves the cursor, a pinch is a press, opening the fingers is a release, and a hand missing for
// more than 300 ms releases too. The cursor is smoothed with a One Euro filter. No DOM, no React.

import { HAND } from "../constants";
import type { Pt, Size } from "../geometry";
import type { GestureEvent } from "../gesture";
import { handToViewport, type Landmark, type Region } from "./mapping";
import { oneEuro } from "./oneEuro";
import { pinchRatio, pinchState } from "./pinch";

export type { Landmark } from "./mapping";
export type HandState = "none" | "open" | "pinched";
export type HandResult = { cursor: Pt | null; state: HandState; events: GestureEvent[] };

export function createHandInput(options: { region?: Region; lostMs?: number } = {}) {
  const region = options.region ?? HAND.region;
  const lostMs = options.lostMs ?? HAND.lostMs;
  const fx = oneEuro(HAND.minCutoff, HAND.beta, HAND.dCutoff);
  const fy = oneEuro(HAND.minCutoff, HAND.beta, HAND.dCutoff);
  let pinched = false;
  let lostAt: number | null = null;
  let cursor: Pt | null = null;

  const event = (type: "down" | "move" | "up", p: Pt, t: number): GestureEvent => ({ type, x: p[0], y: p[1], t, source: "hand", id: HAND.pointerId });

  return {
    /** One camera frame: the landmarks of one hand, or null when none is seen; t in ms; the picture's aspect; the target box. */
    frame(landmarks: readonly Landmark[] | null, t: number, aspect: number, box: Size): HandResult {
      if (!landmarks) {
        lostAt ??= t;
        const events: GestureEvent[] = [];
        if (pinched && t - lostAt > lostMs && cursor) {
          pinched = false;
          events.push(event("up", cursor, t));
        }
        return { cursor, state: "none", events };
      }
      lostAt = null;
      const raw = handToViewport(landmarks, region, box);
      const p: Pt = [fx.filter(raw[0], t), fy.filter(raw[1], t)];
      cursor = p;
      const was = pinched;
      pinched = pinchState(was, pinchRatio(landmarks, aspect));
      const type = pinched && !was ? "down" : !pinched && was ? "up" : "move";
      return { cursor: p, state: pinched ? "pinched" : "open", events: [event(type, p, t)] };
    },
    /** Switching the mode off: a held pinch is cancelled. */
    release(t: number): GestureEvent[] {
      if (!pinched) return [];
      pinched = false;
      return [{ type: "cancel", t, source: "hand", id: HAND.pointerId }];
    },
    reset() {
      pinched = false;
      lostAt = null;
      cursor = null;
      fx.reset();
      fy.reset();
    },
  };
}

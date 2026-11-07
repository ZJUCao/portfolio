// The pinch check: thumb tip (4) to index tip (8) over the palm length, wrist (0) to the middle
// finger's base (9), so it does not depend on how far the hand is from the camera. Pinched below
// 0.30, released above 0.45; the gap between them keeps it from flickering. No DOM, no React.
// Contract: docs/design_space_cut.md §5.4, §7.

import { HAND } from "../constants";
import type { Landmark } from "./mapping";

/** Landmarks are normalized to the picture, so x distances are scaled by its width-to-height aspect. */
export function pinchRatio(landmarks: readonly Landmark[], aspect: number): number {
  const d = (a: number, b: number) => Math.hypot((landmarks[a].x - landmarks[b].x) * aspect, landmarks[a].y - landmarks[b].y);
  return d(4, 8) / Math.max(d(0, 9), 1e-3);
}

/** The new pinch state, with hysteresis. */
export function pinchState(prev: boolean, ratio: number): boolean {
  if (!prev && ratio < HAND.pinchOn) return true;
  if (prev && ratio > HAND.pinchOff) return false;
  return prev;
}

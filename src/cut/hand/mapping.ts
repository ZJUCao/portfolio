// From the camera picture to the viewport (D5): the cursor is the midpoint of the thumb and index
// tips; the picture is mirrored like a mirror; the middle region of the picture maps onto the whole
// box, so the hand never has to reach the frame's edge. No DOM, no React. Contract: §5.4, §7.

import type { Pt, Size } from "../geometry";

/** A hand landmark, normalized to the picture (0–1). */
export type Landmark = { readonly x: number; readonly y: number };
/** The region of the picture, as fractions, that maps onto the box. */
export type Region = { readonly x0: number; readonly x1: number; readonly y0: number; readonly y1: number };

const unit = (v: number) => Math.min(1, Math.max(0, v));

export function handToViewport(landmarks: readonly Landmark[], region: Region, box: Size): Pt {
  const mirrored = 1 - (landmarks[4].x + landmarks[8].x) / 2;
  const y = (landmarks[4].y + landmarks[8].y) / 2;
  // Mirroring flips the region too: its left edge in the mirrored picture is 1 - x1
  const u = unit((mirrored - (1 - region.x1)) / (region.x1 - region.x0));
  const v = unit((y - region.y0) / (region.y1 - region.y0));
  return [u * box.width, v * box.height];
}

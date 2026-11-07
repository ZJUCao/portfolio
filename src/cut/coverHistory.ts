// Back and Forward for the card-to-detail morph (docs/design_space_cut.md §13, P5). Next gives traversals
// no transition type, and its own restore does not commit as a transition by itself. So a popstate listener
// that runs before Next's (registered before hydration, src/instrumentation-client.ts) starts a transition
// of its own with COVER_TYPE and a throwaway update (CoverHistory); React commits it together with Next's
// restore, and the covers pair. This module keeps what that needs, plus the flag Reveal reads.

import { isDetailPath, morphsOnTraverse } from "./coverMorph";

/** How long the arrival flag waits for the new page's Reveals before it lapses. */
const ARRIVAL_MS = 2000;

let shownPath: string | null = null;
let touch: (() => void) | null = null;
let arriving = false;
let lapse: ReturnType<typeof setTimeout> | undefined;

/** The page on screen, kept by CoverHistory as each navigation commits. */
export function showing(path: string): void {
  shownPath = path;
}

/** CoverHistory's throwaway state update, or null once it unmounts. */
export function setTouch(update: (() => void) | null): void {
  touch = update;
}

/**
 * Called on popstate, before Next handles it, with the path the browser moved to. Returns the update to
 * run inside a COVER_TYPE transition when the traversal enters or leaves a detail page (morphsOnTraverse),
 * or null to leave it a plain switch.
 */
export function traversal(to: string): (() => void) | null {
  if (shownPath === null || touch === null || !morphsOnTraverse(shownPath, to)) return null;
  if (!isDetailPath(to)) markCoverArrival();
  return touch;
}

/**
 * The next page is reached with a cover shrinking into its card. That card sits in a Reveal, which starts
 * transparent, while the browser draws the flying cover at full brightness whatever its ancestors'
 * opacity, so the page's Reveals start shown instead of fading in.
 */
export function markCoverArrival(): void {
  arriving = true;
  clearTimeout(lapse);
  lapse = setTimeout(() => (arriving = false), ARRIVAL_MS);
}

/** Asked by each Reveal on its first render. */
export const arrivingWithCover = (): boolean => arriving;

/** Called once the new page's Reveals have rendered, so later ones fade in as usual. */
export function arrived(): void {
  arriving = false;
  clearTimeout(lapse);
}

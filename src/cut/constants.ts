// Every tuning value of the space-cut transitions in one place. Contract: docs/design_space_cut.md §7.
// Values come from the prototype except the click-to-cut durations (D9). Fractions named "…Short"
// are fractions of the cut surface's short side.

/** Knife: drag a straight line, it snaps taut and opens a lens-shaped window. */
export const KNIFE = Object.freeze({
  /** Shortest stroke, in px, whatever the surface size. */
  minLengthPx: 110,
  /** Shortest stroke as a fraction of the short side. */
  minLengthShort: 0.2,
  /** Largest distance from the fitted line, as a fraction of the stroke's length. */
  maxDeviation: 0.12,
  /** The same for hand gestures, which shake more in the air. */
  maxDeviationHand: 0.16,
  /** Points closer than this to the previous one are dropped while drawing. */
  minSamplePx: 1.5,
  /** Half-width of the open window as a fraction of the half length… */
  halfWidthRatio: 0.34,
  /** …but at least this many px… */
  halfWidthMinPx: 26,
  /** …and at most this fraction of the short side. */
  halfWidthMaxShort: 0.24,
  /** Lens exponent: 1 is a pair of parabolas, 0.5 an ellipse. */
  sharpness: 0.8,
  /** The lens turns into an ellipse while stepping through, so it covers the corners. */
  sharpnessThrough: 0.5,
  /** Extra margin on the scale that covers the surface. */
  coverMargin: 1.06,
  /** The hand-drawn line snaps onto the fitted line. */
  tautMs: 150,
  /** Pause while the glow along the line dims. */
  pauseMs: 150,
  /** The two sides part. */
  openMs: 560,
  /** Closing: the sides come together… */
  closeMs: 380,
  /** …and leave a scar at this opacity… */
  scarOpacity: 0.55,
  /** …that fades over this long. */
  scarFadeMs: 900,
});

/** Wand: hold to dissolve space; the hole grows while held and stops on release (D3 of the requirements). */
export const WAND = Object.freeze({
  /** The tip lights up first; the hole starts growing after this delay. */
  delayS: 0.12,
  /** Holding this long reaches the largest hole. */
  holdMaxS: 1.6,
  /** Largest radius, as a fraction of the short side. */
  radiusMaxShort: 0.36,
  /** Smallest radius after release, so a tap still opens a small window. */
  radiusMinShort: 0.1,
  /** After release the hole grows a little more over this long, then stops. */
  settleS: 0.35,
  /** …by this factor of the radius it had at release. */
  settleGrowth: 1.06,
  /** The inner shadow reaches full strength at this radius (fraction of the short side). */
  rimFullShort: 0.06,
  /** A ripple every this many seconds while the hole grows. */
  rippleEveryS: 0.5,
  rippleDurS: 0.9,
  /** How far a ripple travels beyond the hole, as a fraction of the short side. */
  rippleReachShort: 0.2,
  /** If the release never arrives, let go anyway after holdMaxS plus this. */
  stuckS: 4,
  /** The edge's wobble starts at this strength and reaches 1 after wobbleRampS. */
  wobbleStart: 0.4,
  wobbleRampS: 0.45,
  /** Closing: the hole shrinks and the dust is drawn back in… */
  closeMs: 560,
  /** …then the tip flashes once and fades. */
  flashMs: 340,
  /** When a press turns into a knife stroke (D1), the young hole collapses over this long. */
  abortMs: 120,
  /** Harmonics of the moving edge: [k, amplitude]. */
  harmonics: [
    [3, 0.07],
    [5, 0.045],
    [8, 0.028],
    [13, 0.014],
  ] as const,
  /** A harmonic turns at 0.6 to 1.4 rad/s, in a random direction. */
  speedMin: 0.6,
  speedSpan: 0.8,
  /** Extra margin on the scale that covers the surface. */
  coverMargin: 1.03,
});

/** Click to cut: a line through the click point opens into a window (D9: 120 + 40 + 200 + 480 = 840 ms). */
export const CLICK = Object.freeze({
  lineMs: 120,
  pauseMs: 40,
  openMs: 200,
  expandMs: 480,
  /** Half length of the line: a fraction of the short side, clamped to px. */
  halfLengthShort: 0.24,
  halfLengthMinPx: 90,
  halfLengthMaxPx: 280,
  /** Half-width of the window as a fraction of the half length. */
  halfWidthRatio: 0.3,
  /** The line leans 55° to 70° from horizontal, either way. */
  angleMinDeg: 55,
  angleSpanDeg: 15,
});

/** Stepping through: the window grows until it covers the surface. */
export const THROUGH = Object.freeze({
  ms: 780,
  /** Dust is thrown off the wand's hole during the first part of the expansion. */
  dustUntil: 0.3,
});

/** Behind the window the other world drifts against the pointer, as if it were further away. */
export const PARALLAX = Object.freeze({
  factor: -0.035,
  maxPx: 14,
  scale: 1.04,
});

/** D1: one press vocabulary for knife and wand; how far a press may move and still count as a tap. */
export const GESTURE = Object.freeze({
  /** Moving further than this within strokeWindowMs turns a wand press into a knife stroke. */
  strokeMovePx: 10,
  strokeMovePxHand: 40,
  strokeWindowMs: 250,
  /** A release within this distance of the press is a tap (click to cut). */
  tapMovePx: 12,
  tapMovePxHand: 40,
});

/** Gold dust. */
export const DUST = Object.freeze({
  max: 1500,
  maxPixelRatio: 2,
  /** Velocity kept per 1/60 s. */
  drag: 0.96,
  /** Upward drift, px/s². */
  buoyancy: 18,
  /** Fraction of a particle's life spent fading in. */
  fadeIn: 0.15,
});

/** Reduce motion: a crossfade instead of a cut (F5). */
export const REDUCED = Object.freeze({ fadeMs: 200 });

/** Colours of the effect layer; the CSS variables come from globals.css. */
export const COLORS = Object.freeze({
  knife: "var(--accent, #5fe3ff)",
  knifeCore: "#dff8ff",
  strokeCore: "#effcff",
  /** Q10: the wand's gold is the "engines" category colour. */
  wand: "var(--cat-engines, #fbbf6a)",
  wandCore: "#fff3d6",
});

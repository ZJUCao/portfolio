// Frames for the pipeline and worker tests (docs/test_plan_camera_ar.md §4.7 and §4.8): RGBA frames
// with R = G = B drawn by the grey renderer, 1000/30 ms apart, board sequences whose pose changes a
// little from frame to frame, blank frames, the focal tracker rule of design §5.4 written out
// independently of src/ar/pipeline.ts, and a view of pipeline outputs without `ms` for comparisons.

import type { FrameInput, FrameOutput } from "@/ar/pipeline";
import { BASE_LOOK } from "./catalog";
import { type Render, render } from "./render";
import { type CameraMapping, type Look, type PlaceOptions, makeScene } from "./scenes";

/** Frames are 1000/30 ms apart (30 fps). */
export const FRAME_MS = 1000 / 30;

/** RGBA bytes with R = G = B = the grey value and A = 255. */
export function toRgba(gray: ArrayLike<number>): Uint8ClampedArray {
  const out = new Uint8ClampedArray(4 * gray.length);
  for (let k = 0; k < gray.length; k++) {
    out[4 * k] = gray[k];
    out[4 * k + 1] = gray[k];
    out[4 * k + 2] = gray[k];
    out[4 * k + 3] = 255;
  }
  return out;
}

export interface Frame {
  readonly label: string;
  readonly width: number;
  readonly height: number;
  /** Pristine RGBA bytes; {@link input} hands out copies. */
  readonly rgba: Uint8ClampedArray;
}

export interface BoardFrame extends Frame {
  /** The drawn scene: geometry, ground-truth corners and the grey image. */
  readonly scene: Render;
  /** The true camera and board pose. */
  readonly mapping: CameraMapping;
}

/** A FrameInput over a fresh copy of the frame's bytes, so tests can transfer or alter it freely. */
export function input(frame: Frame, time: number): FrameInput {
  return { width: frame.width, height: frame.height, rgba: frame.rgba.slice(), time };
}

/** A uniform grey frame without a board. */
export function blankFrame(width: number, height: number, level = 128): Frame {
  return { label: `blank ${width}×${height}`, width, height, rgba: toRgba(new Uint8Array(width * height).fill(level)) };
}

/**
 * Draws `count` frames of the standard board: frame k is placed by place(k) and drawn with `look`
 * (by default the P1 base look: dark 40, light 200, margin 0.5 square, background 128, blur σ 0.6,
 * noise σ 2) with its own noise seed, seedFor(`${label}#${k}`). Every frame must be nominal (§5.2),
 * so that the detector is bound to find the board.
 */
export function boardSequence(label: string, count: number, place: (k: number) => PlaceOptions, look: Look = BASE_LOOK): BoardFrame[] {
  return Array.from({ length: count }, (_, k) => {
    const name = `${label}#${k}`;
    const scene = makeScene(name, place(k), look);
    const drawn = render(scene.options);
    if (!drawn.meta.nominal) throw new Error(`boardSequence: ${name} is not nominal (${drawn.meta.violations.join(", ")})`);
    return {
      label: name,
      width: scene.options.width,
      height: scene.options.height,
      rgba: toRgba(drawn.image.data),
      scene: drawn,
      mapping: scene.options.mapping as CameraMapping,
    };
  });
}

/** The default focal tracker options of §5.4, which the pipeline's tracker uses (OQ-75). */
export const TRACKER_DEFAULTS = Object.freeze({ minFovDeg: 40, maxFovDeg: 100, window: 15, minSamples: 5 });

/**
 * The focal length that §5.4 prescribes after the given estimates: (width / 2) / tan(hfov / 2) until
 * `minSamples` valid estimates have arrived, then the median of the last `window` valid ones (the
 * mean of the two middle values for an even count, OQ-30), clamped to the focal lengths of maxFovDeg
 * and minFovDeg at this width. Null, NaN, ±Infinity, 0 and negative estimates are skipped (OQ-31).
 */
export function trackerRule(estimates: readonly (number | null)[], width: number, hfovDeg = 60, options = TRACKER_DEFAULTS): number {
  const focalAt = (fovDeg: number): number => width / 2 / Math.tan((fovDeg * Math.PI) / 360);
  const valid = estimates.filter((value): value is number => value !== null && Number.isFinite(value) && value > 0);
  if (valid.length < options.minSamples) return focalAt(hfovDeg);
  const last = valid.slice(-options.window).sort((a, b) => a - b);
  const m = last.length;
  const median = m % 2 === 1 ? last[(m - 1) / 2] : (last[m / 2 - 1] + last[m / 2]) / 2;
  return Math.min(focalAt(options.minFovDeg), Math.max(focalAt(options.maxFovDeg), median));
}

/** A pipeline output without `ms`, with its arrays copied, for exact comparisons between runs. */
export function comparable(output: FrameOutput): {
  found: boolean;
  corners: number[] | null;
  pose: { R: number[]; t: number[]; rms: number } | null;
  intrinsics: { fx: number; fy: number; cx: number; cy: number };
} {
  const { found, corners, pose, intrinsics } = output;
  return {
    found,
    corners: corners === null ? null : Array.from(corners),
    pose: pose === null ? null : { R: Array.from(pose.R), t: Array.from(pose.t), rms: pose.rms },
    intrinsics: { fx: intrinsics.fx, fy: intrinsics.fy, cx: intrinsics.cx, cy: intrinsics.cy },
  };
}

// ---------------------------------------------------------------------------------------------
// The frame sequences of the pipeline and worker tests, drawn once per test file

function memo<T>(build: () => T): () => T {
  let value: T | undefined;
  return () => (value ??= build());
}

/**
 * 320×180 with a true hfov of 52°, so that a learned focal length (328 px) differs clearly from the
 * pipeline's 60° default (277 px): the board about 30° from the ray to its centre, which stays within
 * a few pixels of the principal point, its shortest square edge 12.3 px (nominal needs 12) and its
 * squares spanning over half the width. It drifts by well under a quarter of a square per frame, so
 * the previous corners are a valid hint (OQ-15).
 */
export const movingBoard = memo(() =>
  boardSequence("P2-PIP moving 320×180", 24, (k) => ({
    width: 320,
    height: 180,
    hfovDeg: 52,
    tiltDeg: 30 + 1.5 * Math.sin(k / 3),
    tiltAxisDeg: 40 + 6 * Math.sin(k / 4),
    inPlaneDeg: 8 + 2 * Math.sin(k / 5),
    centre: [159.5 + 3 * Math.sin(k / 3.5), 89.5 + 2 * Math.cos(k / 4.5)],
    minEdgePx: 12.3,
  })),
);

/** 180×320 (portrait) with a true hfov of 56°: the board turned 90° in its plane, about 27° from the ray, shortest edge 12.3 px. */
export const portraitBoard = memo(() =>
  boardSequence("P2-PIP portrait 180×320", 8, (k) => ({
    width: 180,
    height: 320,
    hfovDeg: 56,
    tiltDeg: 27 + 1.5 * Math.sin(k / 3),
    tiltAxisDeg: 5 * Math.sin(k / 2),
    inPlaneDeg: 90 + 2 * Math.sin(k / 2),
    centre: [89.5 + 2 * Math.sin(k / 3), 159.5 + 3 * Math.cos(k / 4)],
    minEdgePx: 12.3,
  })),
);

/**
 * P2-PIP-11 (true hfov 50°) and the scripted clamp run of P2-PIP-10 (OQ-71): 12 frames at 640×360,
 * inside the OQ-24 envelope so that every frame's focal estimate is due a value for hfov 40–100°
 * (OQ-62): the board's squares span 45 % of the width and its normal is 40–50° from the optical
 * axis, with the centre near the principal point.
 */
export function focalBoard(hfovDeg: number): BoardFrame[] {
  return boardSequence(`P2-PIP-11 hfov ${hfovDeg}°`, 12, (k) => ({
    width: 640,
    height: 360,
    hfovDeg,
    normalRef: "axis",
    tiltDeg: 40 + (10 * k) / 11,
    tiltAxisDeg: 20 + 6 * k,
    inPlaneDeg: 5 + 3 * k,
    centre: [319.5 + 5 * Math.sin(k / 2), 179.5 + 4 * Math.cos(k / 3)],
    widthFraction: 0.45,
  }));
}

/** P2-PIP-18: 8 independent views at 640×360, hfov 60°, tilt 30–50° from the ray, the squares spanning 52 % of the width. */
export const poseBoards = memo(() =>
  boardSequence("P2-PIP-18", 8, (k) => ({
    width: 640,
    height: 360,
    hfovDeg: 60,
    tiltDeg: 30 + (20 * k) / 7,
    tiltAxisDeg: [45, 90, 135, 270][k % 4],
    inPlaneDeg: (k % 2 === 0 ? 0 : 180) + (k - 3.5),
    centre: [319.5 + 10 * Math.sin(k), 179.5 + 6 * Math.cos(k)],
    widthFraction: 0.52,
  })),
);

/**
 * P2-PIP-17: a 320×180 board drawn in grey with dark 80 and light 180, coded so that its BT.601
 * luma shows the board while the red channel alone shows it inverted: R = 255 − g and
 * G = B = (g − 0.299 R) / 0.701, rounded, so 0.299 R + 0.587 G + 0.114 B stays within 0.5 of g.
 */
export const invertedRedBoard = memo((): BoardFrame => {
  const [frame] = boardSequence(
    "P2-PIP-17",
    1,
    () => ({ width: 320, height: 180, hfovDeg: 60, tiltDeg: 20, tiltAxisDeg: 30, inPlaneDeg: 5, minEdgePx: 13 }),
    { ...BASE_LOOK, dark: 80, light: 180 },
  );
  const gray = frame.scene.image.data;
  const rgba = new Uint8ClampedArray(4 * gray.length);
  for (let k = 0; k < gray.length; k++) {
    const red = 255 - gray[k];
    const other = Math.round((gray[k] - 0.299 * red) / 0.701);
    rgba.set([red, other, other, 255], 4 * k);
  }
  return { ...frame, rgba };
});

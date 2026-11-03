// Scene and pose generators for the detector tests (docs/test_plan_camera_ar.md §2.4): placing a
// board in front of a pinhole camera, sampling the nominal envelope of §5.2, and moving a board by
// a bounded amount between frames.

import { type BoardSpec, STANDARD_BOARD, halfExtent } from "./boardModel";
import { type Vec3, add3, cross3, normalize3, scale3, sub3 } from "./linalg";
import { type Rng, seedFor } from "./random";
import {
  type Background,
  type BoardLayer,
  type Glare,
  type Intrinsics,
  type Mapping,
  type RenderOptions,
  type SceneMeta,
  type Shape,
  boardToImage,
  describeScene,
  minProjectedEdge,
} from "./render";

export function intrinsicsFor(width: number, height: number, hfovDeg = 60): Intrinsics {
  const f = width / 2 / Math.tan((hfovDeg * Math.PI) / 360);
  return { fx: f, fy: f, cx: (width - 1) / 2, cy: (height - 1) / 2 };
}

export interface PlaceOptions {
  readonly width: number;
  readonly height: number;
  readonly hfovDeg?: number;
  readonly board?: BoardSpec;
  /** Rotation of the board in its own plane; 0 puts board X along image x. */
  readonly inPlaneDeg?: number;
  readonly tiltDeg?: number;
  /** Direction, around the reference axis, towards which the board normal tilts. */
  readonly tiltAxisDeg?: number;
  /** Tilt measured from the ray to the board centre (§5.2) or from the optical axis. Default "ray". */
  readonly normalRef?: "ray" | "axis";
  /** Image position of the board centre. Default: the principal point. */
  readonly centre?: readonly [number, number];
  /** Pick the depth so that the shortest projected square edge has this length. */
  readonly minEdgePx?: number;
  /** Pick the depth so that the board's outer squares span this fraction of the image width. */
  readonly widthFraction?: number;
  /** Depth (camera z) of the board centre. */
  readonly depth?: number;
}

export type CameraMapping = Extract<Mapping, { kind: "camera" }>;

const rad = (deg: number): number => (deg * Math.PI) / 180;

/** Places a board in front of a camera with the requested pose and size. */
export function placeBoard(o: PlaceOptions): CameraMapping {
  const board = o.board ?? STANDARD_BOARD;
  const K = intrinsicsFor(o.width, o.height, o.hfovDeg ?? 60);
  const [uc, vc] = o.centre ?? [K.cx, K.cy];
  const ray = normalize3([(uc - K.cx) / K.fx, (vc - K.cy) / K.fy, 1]);
  const ref: Vec3 = o.normalRef === "axis" ? [0, 0, 1] : ray;
  const a = normalize3(sub3([1, 0, 0], scale3(ref, ref[0])));
  const b = cross3(ref, a);
  const tau = rad(o.tiltDeg ?? 0);
  const psi = rad(o.tiltAxisDeg ?? 0);
  const towards = add3(scale3(a, Math.cos(psi)), scale3(b, Math.sin(psi)));
  const n = normalize3(add3(scale3(ref, Math.cos(tau)), scale3(towards, Math.sin(tau))));
  const ax = normalize3(sub3([1, 0, 0], scale3(n, n[0])));
  const bx = cross3(n, ax);
  const theta = rad(o.inPlaneDeg ?? 0);
  const xAxis = add3(scale3(ax, Math.cos(theta)), scale3(bx, Math.sin(theta)));
  const yAxis = cross3(n, xAxis);
  // Columns: board X, board Y, board Z (= X × Y, pointing away from the camera)
  const R = [xAxis[0], yAxis[0], n[0], xAxis[1], yAxis[1], n[1], xAxis[2], yAxis[2], n[2]];
  const at = (z: number): CameraMapping => ({ kind: "camera", K, R, t: scale3(ray, z / ray[2]) });

  if (o.depth !== undefined) return at(o.depth);
  // Keep every point of the board (and a margin) in front of the camera
  const [hx, hy] = halfExtent(board);
  const reach = Math.max(...[-1, 1].flatMap((sx) => [-1, 1].map((sy) => -(R[6] * sx * (hx + 0.3) + R[7] * sy * (hy + 0.3)))));
  const lo = Math.max(0.05, reach + 0.05);
  const measure =
    o.widthFraction !== undefined
      ? (z: number) => {
          const H = boardToImage(at(z));
          const us = [-hx, hx].flatMap((x) => [-hy, hy].map((y) => (H[0] * x + H[1] * y + H[2]) / (H[6] * x + H[7] * y + H[8])));
          return (Math.max(...us) - Math.min(...us)) / o.width;
        }
      : (z: number) => minProjectedEdge(board, boardToImage(at(z)));
  const target = o.widthFraction ?? o.minEdgePx ?? 20;
  let near = lo;
  let far = 5000;
  if (!(measure(near) >= target)) throw new Error(`placeBoard: the board cannot be made that large (${target})`);
  for (let k = 0; k < 100; k++) {
    const mid = Math.sqrt(near * far);
    if (measure(mid) > target) near = mid;
    else far = mid;
  }
  return at(near); // the side of the bracket that still meets the target
}

/** Everything but the geometry of a scene. */
export interface Look {
  readonly dark?: number;
  readonly light?: number;
  readonly marginLevel?: number;
  readonly marginSquares?: number;
  readonly background?: Background;
  readonly gain?: { readonly amplitude: number; readonly angleDeg: number };
  readonly glare?: Glare;
  readonly occluders?: readonly Shape[];
  readonly flippedSquares?: readonly (readonly [number, number])[];
  readonly extraBoards?: readonly BoardLayer[];
  readonly motionBlurPx?: number;
  readonly blurSigma?: number;
  readonly noiseSigma?: number;
  readonly posterizeLevels?: number;
  readonly seed?: number;
}

export interface Scene {
  readonly label: string;
  readonly place: PlaceOptions;
  readonly look: Look;
  readonly options: RenderOptions;
}

export function makeScene(label: string, place: PlaceOptions, look: Look): Scene {
  const options: RenderOptions = {
    ...look,
    width: place.width,
    height: place.height,
    board: place.board ?? STANDARD_BOARD,
    mapping: placeBoard(place),
    seed: look.seed ?? seedFor(label),
  };
  return { label, place, look, options };
}

/** A fixed value or a [min, max) range to sample from. */
export type Range = number | readonly [number, number];
const sample = (rng: Rng, range: Range): number => (typeof range === "number" ? range : rng.range(range[0], range[1]));

export interface SampleRanges {
  readonly width?: number;
  readonly height?: number;
  readonly hfovDeg?: Range;
  readonly tiltDeg?: Range;
  readonly tiltAxisDeg?: Range;
  readonly inPlaneDeg?: Range;
  readonly minEdgePx?: Range;
  readonly marginSquares?: Range;
  readonly dark?: Range;
  /** Light level; by default sampled so that the contrast after the gain is 80–160. */
  readonly light?: Range;
  /** Gain amplitude; null for none. By default ±0.25 in 60 % of scenes. */
  readonly gainAmplitude?: Range | null;
  readonly blurSigma?: Range;
  readonly noiseSigma?: Range;
  /** Background; by default a uniform level or clutter. */
  readonly background?: Background | "clutter";
  /** Fraction of the image, around its centre, in which the board centre is placed. */
  readonly centreSpread?: number;
  readonly look?: Look;
}

/** Samples scenes from the ranges until `accept` takes one (bounded, deterministic per rng). */
export function sampleScene(label: string, rng: Rng, ranges: SampleRanges, accept: (meta: SceneMeta) => boolean): Scene {
  const width = ranges.width ?? 640;
  const height = ranges.height ?? 360;
  for (let attempt = 0; attempt < 500; attempt++) {
    const amplitude =
      ranges.gainAmplitude === null ? 0 : ranges.gainAmplitude !== undefined ? sample(rng, ranges.gainAmplitude) : rng.next() < 0.6 ? rng.range(-0.25, 0.25) : 0;
    const dark = sample(rng, ranges.dark ?? [10, 60]);
    let light: number;
    if (ranges.light !== undefined) light = sample(rng, ranges.light);
    else {
      const minLight = dark + 80 / (1 - Math.abs(amplitude)) + 0.5;
      const maxLight = Math.min(dark + 160, 255 / (1 + Math.abs(amplitude)) - 0.5);
      light = rng.range(minLight, Math.max(minLight, maxLight));
    }
    const spread = ranges.centreSpread ?? 0.6;
    const centre: [number, number] = [
      ((1 - spread) / 2 + spread * rng.next()) * (width - 1),
      ((1 - spread) / 2 + spread * rng.next()) * (height - 1),
    ];
    const background =
      ranges.background === "clutter"
        ? clutter(rng, rng.pick(["rects", "text", "graph"] as const), width, height)
        : (ranges.background ?? (rng.next() < 0.5 ? rng.range(0, 255) : clutter(rng, rng.pick(["rects", "text", "graph"] as const), width, height)));
    const place: PlaceOptions = {
      width,
      height,
      hfovDeg: sample(rng, ranges.hfovDeg ?? [50, 70]),
      tiltDeg: sample(rng, ranges.tiltDeg ?? [0, 60]),
      tiltAxisDeg: sample(rng, ranges.tiltAxisDeg ?? [0, 360]),
      inPlaneDeg: sample(rng, ranges.inPlaneDeg ?? [0, 360]),
      minEdgePx: sample(rng, ranges.minEdgePx ?? [12, 30]),
      centre,
    };
    const look: Look = {
      dark,
      light,
      marginSquares: sample(rng, ranges.marginSquares ?? [0.25, 1]),
      background,
      gain: amplitude === 0 ? undefined : { amplitude, angleDeg: rng.range(0, 360) },
      blurSigma: sample(rng, ranges.blurSigma ?? [0, 1]),
      noiseSigma: sample(rng, ranges.noiseSigma ?? [0, 4]),
      ...ranges.look,
    };
    let scene: Scene;
    try {
      scene = makeScene(label, place, look);
    } catch {
      continue; // the board could not be placed at that size
    }
    if (accept(describeScene(scene.options).meta)) return scene;
  }
  throw new Error(`sampleScene(${label}): no acceptable scene in 500 attempts`);
}

/** A scene inside the §5.2 envelope; fixed values in `ranges` override the defaults. */
export function nominalScene(label: string, rng: Rng, ranges: SampleRanges = {}): Scene {
  return sampleScene(label, rng, ranges, (meta) => meta.nominal);
}

export type ClutterKind = "rects" | "text" | "graph" | "dots";

/** Image-space clutter: random rectangles, rows of text-like strokes, graph paper or a dot grid. */
export function clutter(rng: Rng, kind: ClutterKind, width: number, height: number): Background {
  const shapes: Shape[] = [];
  switch (kind) {
    case "rects": {
      for (let k = 0; k < 30; k++) {
        shapes.push({
          kind: "rect",
          space: "image",
          x: rng.range(0, width),
          y: rng.range(0, height),
          w: rng.range(6, 70),
          h: rng.range(6, 70),
          angleDeg: rng.range(0, 90),
          fill: rng.range(0, 255),
        });
      }
      return { kind: "shapes", base: rng.range(80, 200), shapes };
    }
    case "text": {
      for (let y = 8; y < height - 4; y += 14) {
        let x = rng.range(2, 12);
        while (x < width - 4) {
          const letters = 2 + rng.int(7);
          for (let k = 0; k < letters && x < width - 4; k++) {
            shapes.push({ kind: "rect", space: "image", x, y, w: 2, h: rng.range(5, 10), fill: rng.range(10, 60) });
            x += rng.range(3.5, 5.5);
          }
          x += rng.range(7, 12);
        }
      }
      return { kind: "shapes", base: rng.range(195, 240), shapes };
    }
    case "graph": {
      for (let x = 8; x < width; x += 16) shapes.push({ kind: "rect", space: "image", x, y: height / 2, w: 1.2, h: height + 4, fill: 120 });
      for (let y = 8; y < height; y += 16) shapes.push({ kind: "rect", space: "image", x: width / 2, y, w: width + 4, h: 1.2, fill: 120 });
      return { kind: "shapes", base: 235, shapes };
    }
    case "dots": {
      for (let j = 0; j < 6; j++) {
        for (let i = 0; i < 9; i++) {
          shapes.push({ kind: "disc", space: "image", x: width / 2 + (i - 4) * 30, y: height / 2 + (j - 2.5) * 30, r: 5, fill: 30 });
        }
      }
      return { kind: "shapes", base: 220, shapes };
    }
  }
}

export type MotionKind = "translate" | "rotate" | "scale" | "tilt";

/** Physical corner positions of a scene's primary board. */
function cornersOf(options: RenderOptions): Float64Array {
  const geometry = describeScene(options);
  if (!geometry.physical) throw new Error("cornersOf: the scene has no board");
  return geometry.physical;
}

/** Largest corner displacement between two scenes, as a fraction of the shorter min edge of the two. */
export function shiftInSquares(a: RenderOptions, b: RenderOptions): number {
  const pa = cornersOf(a);
  const pb = cornersOf(b);
  let max = 0;
  for (let k = 0; k < pa.length; k += 2) max = Math.max(max, Math.hypot(pb[k] - pa[k], pb[k + 1] - pa[k + 1]));
  return max / Math.min(describeScene(a).meta.minEdgePx, describeScene(b).meta.minEdgePx);
}

/**
 * Moves a scene so that its largest corner displacement is `shiftSquares` × the shortest projected
 * square edge (the strictest reading of "moved ≤ 0.25 square", OQ-15). `direction` is an image angle
 * in degrees for translations and a sign for the other kinds.
 */
export function moveScene(scene: Scene, label: string, kind: MotionKind, direction: number, shiftSquares: number): Scene {
  const mapping = scene.options.mapping as CameraMapping;
  const depth = mapping.t[2];
  const centre = scene.place.centre ?? [mapping.K.cx, mapping.K.cy];
  const base: PlaceOptions = { ...scene.place, minEdgePx: undefined, widthFraction: undefined, depth, centre };
  const sign = direction >= 0 ? 1 : -1;
  const placed = (m: number): PlaceOptions => {
    switch (kind) {
      case "translate":
        return { ...base, centre: [centre[0] + m * Math.cos(rad(direction)), centre[1] + m * Math.sin(rad(direction))] };
      case "rotate":
        return { ...base, inPlaneDeg: (base.inPlaneDeg ?? 0) + sign * m };
      case "scale":
        return { ...base, depth: depth * (1 + sign * m) };
      case "tilt":
        return { ...base, tiltDeg: (base.tiltDeg ?? 0) + sign * m };
    }
  };
  const upper = { translate: 600, rotate: 120, scale: 0.9, tilt: 40 }[kind];
  const shiftAt = (m: number): number => shiftInSquares(scene.options, makeScene(label, placed(m), scene.look).options);
  let lo = 0;
  let hi = upper;
  for (let k = 0; k < 60; k++) {
    const mid = (lo + hi) / 2;
    if (shiftAt(mid) <= shiftSquares) lo = mid;
    else hi = mid;
  }
  return makeScene(label, placed(lo), scene.look);
}

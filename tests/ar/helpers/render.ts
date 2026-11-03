// Synthetic chessboard renderer for the detector tests (docs/test_plan_camera_ar.md §2.3).
//
// A board is drawn through a homography or a pinhole camera with 16 samples per pixel on a sheared
// 4 × 4 grid. Then illumination gain, glare, motion blur, Gaussian blur, noise, posterisation and
// 8-bit quantisation are applied, in that order. Pixel (u, v) covers [u − 0.5, u + 0.5] ×
// [v − 0.5, v + 0.5], the convention of docs/design_camera_ar.md §6. The exact corner positions
// come back with the image, so detector output can be compared against ground truth.

import {
  type BoardSpec,
  STANDARD_BOARD,
  cornerGrid,
  cornerXY,
  halfExtent,
  isDarkSquare,
  squareAt,
  squaresX,
  squaresY,
} from "./boardModel";
import { type Mat3, type Vec3, applyHomography, inverse3 } from "./linalg";
import { createRng } from "./random";

/** Pinhole intrinsics in pixels, pixel-centre convention. */
export interface Intrinsics {
  readonly fx: number;
  readonly fy: number;
  readonly cx: number;
  readonly cy: number;
}

/** Board plane → image: a homography, or a camera with board-to-camera rotation R and translation t. */
export type Mapping =
  | { readonly kind: "homography"; readonly H: Mat3 }
  | { readonly kind: "camera"; readonly K: Intrinsics; readonly R: Mat3; readonly t: Vec3 };

export type Fill = number | "texture";

/** A flat or textured shape, in image pixels or in board units of the primary board. */
export type Shape =
  | { readonly kind: "disc"; readonly space: "image" | "board"; readonly x: number; readonly y: number; readonly r: number; readonly fill: Fill }
  | {
      readonly kind: "rect";
      readonly space: "image" | "board";
      readonly x: number;
      readonly y: number;
      readonly w: number;
      readonly h: number;
      readonly angleDeg?: number;
      readonly fill: Fill;
    }
  | { readonly kind: "polygon"; readonly space: "image" | "board"; readonly points: readonly (readonly [number, number])[]; readonly fill: Fill };

export type Background =
  | number
  /** Image-space shapes on a uniform base, rasterised at pixel centres. */
  | { readonly kind: "shapes"; readonly base: number; readonly shapes: readonly Shape[] }
  | { readonly kind: "linear"; readonly from: number; readonly to: number; readonly angleDeg: number }
  | { readonly kind: "radial"; readonly inner: number; readonly outer: number }
  | { readonly kind: "noise"; readonly mean: number; readonly sigma: number };

/** Additive light blob in image space: value += strength · exp(−d² / 2 radius²), before blur. */
export interface Glare {
  readonly x: number;
  readonly y: number;
  readonly radius: number;
  readonly strength: number;
}

export interface BoardLayer {
  readonly board: BoardSpec;
  readonly mapping: Mapping;
}

export interface RenderOptions {
  readonly width: number;
  readonly height: number;
  /** The board whose corners are the ground truth; null draws no board. Default: 9×6, 0.24. */
  readonly board?: BoardSpec | null;
  readonly mapping?: Mapping;
  /** More boards, drawn under the primary one with the same levels. */
  readonly extraBoards?: readonly BoardLayer[];
  readonly dark?: number;
  readonly light?: number;
  /** Grey level of the margin; the light-square level unless set. */
  readonly marginLevel?: number;
  /** Margin width in squares. */
  readonly marginSquares?: number;
  readonly background?: Background;
  /** Multiplicative gain 1 + amplitude · (offset along angleDeg) / (board half extent). */
  readonly gain?: { readonly amplitude: number; readonly angleDeg: number };
  readonly glare?: Glare;
  readonly occluders?: readonly Shape[];
  /** Squares (r, c) of the primary board drawn with the opposite colour. */
  readonly flippedSquares?: readonly (readonly [number, number])[];
  /** Length in pixels of a horizontal box blur, applied before the Gaussian blur. */
  readonly motionBlurPx?: number;
  readonly blurSigma?: number;
  readonly noiseSigma?: number;
  readonly posterizeLevels?: number;
  readonly seed?: number;
}

export const DEFAULT_DARK = 40;
export const DEFAULT_LIGHT = 200;
export const DEFAULT_BACKGROUND = 128;
export const DEFAULT_MARGIN = 0.5;

export interface SceneMeta {
  /** Shortest projected square edge over all squares, in pixels. */
  readonly minEdgePx: number;
  /** Angle between the board normal and the ray to the board centre (§5.2); NaN for homographies. */
  readonly tiltDeg: number;
  /** Signed distance of every inner corner (own labelling) to the image border; negative outside. */
  readonly cornerBorderPx: Float64Array;
  readonly minCornerBorderPx: number;
  /** Board plus a 0.25-square margin lies inside the image. */
  readonly marginInside: boolean;
  /** Dark/light contrast at the dimmest point after the gain. */
  readonly contrastMin: number;
  readonly nominal: boolean;
  /** Names of the §5.2 nominal conditions the scene breaks. */
  readonly violations: readonly string[];
}

export interface SceneGeometry {
  readonly board: BoardSpec | null;
  /** Board plane → pixel homography of the primary board. */
  readonly H: number[] | null;
  /** Corner positions in pixels in the board's own labelling. */
  readonly physical: Float64Array | null;
  readonly meta: SceneMeta;
  /** Corners in the unique O1–O3 order for a cornersX × cornersY request (default: the board's size). */
  truth(cornersX?: number, cornersY?: number): Float64Array;
}

export interface TestImage {
  readonly width: number;
  readonly height: number;
  readonly data: Uint8ClampedArray;
}

export interface Render extends SceneGeometry {
  readonly image: TestImage;
}

// Sheared 4 × 4 grid: 16 samples whose x and y offsets are each 16 distinct values 1/16 apart.
const OFFSETS = (() => {
  const offsets = new Float64Array(32);
  let k = 0;
  for (let a = 0; a < 4; a++) {
    for (let b = 0; b < 4; b++) {
      offsets[k++] = (4 * a + b + 0.5) / 16 - 0.5;
      offsets[k++] = (4 * b + a + 0.5) / 16 - 0.5;
    }
  }
  return offsets;
})();
export const SAMPLES_PER_PIXEL = OFFSETS.length / 2;

export function boardToImage(mapping: Mapping): number[] {
  if (mapping.kind === "homography") return [...mapping.H];
  const { K, R, t } = mapping;
  // H = K [r1 r2 t] with r1, r2 the first two columns of R
  const m = [R[0], R[1], t[0], R[3], R[4], t[1], R[6], R[7], t[2]];
  return [
    K.fx * m[0] + K.cx * m[6],
    K.fx * m[1] + K.cx * m[7],
    K.fx * m[2] + K.cx * m[8],
    K.fy * m[3] + K.cy * m[6],
    K.fy * m[4] + K.cy * m[7],
    K.fy * m[5] + K.cy * m[8],
    m[6],
    m[7],
    m[8],
  ];
}

/** Shortest projected edge of any square of the board, in pixels. */
export function minProjectedEdge(board: BoardSpec, H: Mat3): number {
  const sx = squaresX(board);
  const sy = squaresY(board);
  const u = new Float64Array((sx + 1) * (sy + 1));
  const v = new Float64Array((sx + 1) * (sy + 1));
  for (let r = 0; r <= sy; r++) {
    for (let c = 0; c <= sx; c++) {
      const [pu, pv, w] = applyHomography(H, (c - sx / 2) * board.square, (r - sy / 2) * board.square);
      if (!(w > 0)) return NaN;
      u[r * (sx + 1) + c] = pu;
      v[r * (sx + 1) + c] = pv;
    }
  }
  let min = Infinity;
  for (let r = 0; r <= sy; r++) {
    for (let c = 0; c <= sx; c++) {
      const k = r * (sx + 1) + c;
      if (c < sx) min = Math.min(min, Math.hypot(u[k + 1] - u[k], v[k + 1] - v[k]));
      if (r < sy) min = Math.min(min, Math.hypot(u[k + sx + 1] - u[k], v[k + sx + 1] - v[k]));
    }
  }
  return min;
}

function cameraTiltDeg(mapping: Mapping): number {
  if (mapping.kind !== "camera") return NaN;
  const { R, t } = mapping;
  const n = [R[2], R[5], R[8]];
  const cos = Math.abs(n[0] * t[0] + n[1] * t[1] + n[2] * t[2]) / Math.hypot(t[0], t[1], t[2]);
  return (Math.acos(Math.min(1, cos)) * 180) / Math.PI;
}

/** The unique ordering of the board's corners that satisfies O1–O3 for a cornersX × cornersY request. */
export function canonicalTruth(board: BoardSpec, physical: Float64Array, cornersX: number, cornersY: number): Float64Array {
  const bx = board.cornersX;
  const by = board.cornersY;
  type LatticeMap = (i: number, j: number) => [number, number];
  let candidates: LatticeMap[];
  if (cornersX === bx && cornersY === by) {
    candidates = [(i, j) => [i, j], (i, j) => [bx - 1 - i, j], (i, j) => [i, by - 1 - j], (i, j) => [bx - 1 - i, by - 1 - j]];
  } else if (cornersX === by && cornersY === bx) {
    candidates = [(i, j) => [j, i], (i, j) => [bx - 1 - j, i], (i, j) => [j, by - 1 - i], (i, j) => [bx - 1 - j, by - 1 - i]];
  } else {
    throw new Error(`truth: a ${cornersX}×${cornersY} request does not match a ${bx}×${by} board`);
  }
  const at = (i: number, j: number): [number, number] => [physical[2 * (j * bx + i)], physical[2 * (j * bx + i) + 1]];
  const valid = candidates.filter((map) => {
    const [i0, j0] = map(0, 0);
    const [ia, ja] = map(1, 0);
    const [ib, jb] = map(0, 1);
    const p0 = at(i0, j0);
    const pa = at(ia, ja);
    const pb = at(ib, jb);
    const cross = (pa[0] - p0[0]) * (pb[1] - p0[1]) - (pa[1] - p0[1]) * (pb[0] - p0[0]);
    const [x0, y0] = cornerXY(board, i0, j0);
    const [xa, ya] = cornerXY(board, ia, ja);
    const [xb, yb] = cornerXY(board, ib, jb);
    const outward = squareAt(board, x0 - 0.5 * (xa - x0) - 0.5 * (xb - x0), y0 - 0.5 * (ya - y0) - 0.5 * (yb - y0));
    return cross > 0 && outward !== null && isDarkSquare(outward[0], outward[1]);
  });
  if (valid.length !== 1) throw new Error(`truth: ${valid.length} orderings satisfy O1–O3`);
  const map = valid[0];
  const out = new Float64Array(2 * cornersX * cornersY);
  for (let j = 0; j < cornersY; j++) {
    for (let i = 0; i < cornersX; i++) {
      const [pi, pj] = map(i, j);
      const [u, v] = at(pi, pj);
      out[2 * (j * cornersX + i)] = u;
      out[2 * (j * cornersX + i) + 1] = v;
    }
  }
  return out;
}

function sceneMeta(options: RenderOptions, board: BoardSpec, H: number[], physical: Float64Array): SceneMeta {
  const { width, height } = options;
  const mapping = options.mapping as Mapping;
  const minEdgePx = minProjectedEdge(board, H);
  const tiltDeg = cameraTiltDeg(mapping);
  const cornerBorderPx = new Float64Array(physical.length / 2);
  for (let k = 0; k < cornerBorderPx.length; k++) {
    const u = physical[2 * k];
    const v = physical[2 * k + 1];
    cornerBorderPx[k] = Math.min(u + 0.5, width - 0.5 - u, v + 0.5, height - 0.5 - v);
  }
  const minCornerBorderPx = Math.min(...cornerBorderPx);
  const [hx, hy] = halfExtent(board);
  const m = 0.25 * board.square;
  const marginInside = [
    [-hx - m, -hy - m],
    [hx + m, -hy - m],
    [hx + m, hy + m],
    [-hx - m, hy + m],
  ].every(([x, y]) => {
    const [u, v, w] = applyHomography(H, x, y);
    return w > 0 && u >= -0.5 && u <= width - 0.5 && v >= -0.5 && v <= height - 0.5;
  });
  const dark = options.dark ?? DEFAULT_DARK;
  const light = options.light ?? DEFAULT_LIGHT;
  const amplitude = Math.abs(options.gain?.amplitude ?? 0);
  const contrastMin = Math.abs(light - dark) * (1 - amplitude);

  const violations: string[] = [];
  if (!(minEdgePx >= 12)) violations.push("minEdge");
  if (!(tiltDeg <= 60)) violations.push("tilt");
  if ((options.marginSquares ?? DEFAULT_MARGIN) < 0.25) violations.push("margin");
  if ((options.marginLevel ?? light) !== light) violations.push("marginLevel");
  if (!marginInside) violations.push("inside");
  if (!(contrastMin >= 80)) violations.push("contrast");
  if ((options.blurSigma ?? 0) > 1) violations.push("blur");
  if ((options.noiseSigma ?? 0) > 4) violations.push("noise");
  if (amplitude > 0.25) violations.push("gain");
  if ((options.occluders ?? []).length > 0) violations.push("occluded");
  if ((options.flippedSquares ?? []).length > 0) violations.push("flipped");
  if ((options.extraBoards ?? []).length > 0) violations.push("extraBoard");
  if ((options.motionBlurPx ?? 0) > 0) violations.push("motion");
  if (options.posterizeLevels !== undefined) violations.push("posterize");
  if (options.glare !== undefined) violations.push("glare");
  return { minEdgePx, tiltDeg, cornerBorderPx, minCornerBorderPx, marginInside, contrastMin, nominal: violations.length === 0, violations };
}

/** Geometry, ground truth and the nominal-condition verdict of a scene, without drawing it. */
export function describeScene(options: RenderOptions): SceneGeometry {
  const board = options.board === undefined ? STANDARD_BOARD : options.board;
  if (board === null) {
    return {
      board: null,
      H: null,
      physical: null,
      meta: {
        minEdgePx: NaN,
        tiltDeg: NaN,
        cornerBorderPx: new Float64Array(0),
        minCornerBorderPx: NaN,
        marginInside: false,
        contrastMin: NaN,
        nominal: false,
        violations: ["noBoard"],
      },
      truth: () => {
        throw new Error("truth: the scene has no board");
      },
    };
  }
  if (!options.mapping) throw new Error("describeScene: a board needs a mapping");
  const H = boardToImage(options.mapping);
  const grid = cornerGrid(board);
  const physical = new Float64Array(grid.length);
  for (let k = 0; k < grid.length; k += 2) {
    const [u, v] = applyHomography(H, grid[k], grid[k + 1]);
    physical[k] = u;
    physical[k + 1] = v;
  }
  const meta = sceneMeta(options, board, H, physical);
  return {
    board,
    H,
    physical,
    meta,
    truth: (cornersX = board.cornersX, cornersY = board.cornersY) => canonicalTruth(board, physical, cornersX, cornersY),
  };
}

// ---------------------------------------------------------------------------------------------
// Drawing

type Box = readonly [number, number, number, number]; // inclusive pixel bounds u0, v0, u1, v1

interface Layer {
  readonly inverse: number[];
  readonly square: number;
  readonly squaresX: number;
  readonly squaresY: number;
  readonly halfX: number;
  readonly halfY: number;
  readonly marginX: number;
  readonly marginY: number;
  readonly flipped: ReadonlySet<number>;
  readonly box: Box;
}

interface PreparedShape {
  readonly space: "image" | "board";
  readonly fill: Fill;
  readonly contains: (x: number, y: number) => boolean;
  readonly box: Box;
}

const texture = (x: number, y: number): number => 128 + 90 * Math.sin(0.9 * x + 0.3 * y) * Math.cos(1.1 * y - 0.2 * x);
const fillValue = (fill: Fill, x: number, y: number): number => (fill === "texture" ? texture(x, y) : fill);

function fullBox(width: number, height: number): Box {
  return [0, 0, width - 1, height - 1];
}

function clampBox(u0: number, v0: number, u1: number, v1: number, width: number, height: number): Box {
  return [Math.max(0, u0), Math.max(0, v0), Math.min(width - 1, u1), Math.min(height - 1, v1)];
}

function projectedBox(H: Mat3, points: readonly (readonly [number, number])[], width: number, height: number): Box {
  let minU = Infinity;
  let minV = Infinity;
  let maxU = -Infinity;
  let maxV = -Infinity;
  for (const [x, y] of points) {
    const [u, v, w] = applyHomography(H, x, y);
    if (!(w > 0) || !Number.isFinite(u) || !Number.isFinite(v)) return fullBox(width, height);
    minU = Math.min(minU, u);
    minV = Math.min(minV, v);
    maxU = Math.max(maxU, u);
    maxV = Math.max(maxV, v);
  }
  return clampBox(Math.floor(minU) - 1, Math.floor(minV) - 1, Math.ceil(maxU) + 1, Math.ceil(maxV) + 1, width, height);
}

function shapeTest(shape: Shape): (x: number, y: number) => boolean {
  switch (shape.kind) {
    case "disc": {
      const r2 = shape.r * shape.r;
      return (x, y) => (x - shape.x) ** 2 + (y - shape.y) ** 2 <= r2;
    }
    case "rect": {
      const a = ((shape.angleDeg ?? 0) * Math.PI) / 180;
      const c = Math.cos(a);
      const s = Math.sin(a);
      return (x, y) => {
        const dx = x - shape.x;
        const dy = y - shape.y;
        return Math.abs(dx * c + dy * s) <= shape.w / 2 && Math.abs(-dx * s + dy * c) <= shape.h / 2;
      };
    }
    case "polygon": {
      const p = shape.points;
      return (x, y) => {
        let inside = false;
        for (let i = 0, j = p.length - 1; i < p.length; j = i++) {
          const [xi, yi] = p[i];
          const [xj, yj] = p[j];
          if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
        }
        return inside;
      };
    }
  }
}

function shapeBounds(shape: Shape): [[number, number], [number, number]] {
  switch (shape.kind) {
    case "disc":
      return [
        [shape.x - shape.r, shape.y - shape.r],
        [shape.x + shape.r, shape.y + shape.r],
      ];
    case "rect": {
      const r = Math.hypot(shape.w, shape.h) / 2;
      return [
        [shape.x - r, shape.y - r],
        [shape.x + r, shape.y + r],
      ];
    }
    case "polygon":
      return [
        [Math.min(...shape.points.map((p) => p[0])), Math.min(...shape.points.map((p) => p[1]))],
        [Math.max(...shape.points.map((p) => p[0])), Math.max(...shape.points.map((p) => p[1]))],
      ];
  }
}

function prepareShape(shape: Shape, boardH: Mat3 | null, width: number, height: number): PreparedShape {
  const [[x0, y0], [x1, y1]] = shapeBounds(shape);
  let box: Box;
  if (shape.space === "image") {
    box = clampBox(Math.floor(x0) - 1, Math.floor(y0) - 1, Math.ceil(x1) + 1, Math.ceil(y1) + 1, width, height);
  } else {
    if (!boardH) throw new Error("render: a board-space shape needs a board");
    box = projectedBox(boardH, [[x0, y0], [x1, y0], [x1, y1], [x0, y1]], width, height);
  }
  return { space: shape.space, fill: shape.fill, contains: shapeTest(shape), box };
}

function makeLayer(board: BoardSpec, H: Mat3, marginSquares: number, flipped: readonly (readonly [number, number])[], width: number, height: number): Layer {
  const [halfX, halfY] = halfExtent(board);
  const marginX = halfX + marginSquares * board.square;
  const marginY = halfY + marginSquares * board.square;
  return {
    inverse: inverse3(H),
    square: board.square,
    squaresX: squaresX(board),
    squaresY: squaresY(board),
    halfX,
    halfY,
    marginX,
    marginY,
    flipped: new Set(flipped.map(([r, c]) => r * squaresX(board) + c)),
    box: projectedBox(
      H,
      [
        [-marginX, -marginY],
        [marginX, -marginY],
        [marginX, marginY],
        [-marginX, marginY],
      ],
      width,
      height,
    ),
  };
}

function backgroundBuffer(background: Background, width: number, height: number, seed: number): Float32Array {
  const out = new Float32Array(width * height);
  if (typeof background === "number") {
    out.fill(background);
    return out;
  }
  switch (background.kind) {
    case "shapes": {
      out.fill(background.base);
      for (const shape of background.shapes) {
        const prepared = prepareShape({ ...shape, space: "image" }, null, width, height);
        const [u0, v0, u1, v1] = prepared.box;
        for (let v = v0; v <= v1; v++) {
          for (let u = u0; u <= u1; u++) if (prepared.contains(u, v)) out[v * width + u] = fillValue(shape.fill, u, v);
        }
      }
      return out;
    }
    case "linear": {
      const a = (background.angleDeg * Math.PI) / 180;
      const dx = Math.cos(a);
      const dy = Math.sin(a);
      const ends = [0, width - 1].flatMap((u) => [0, height - 1].map((v) => u * dx + v * dy));
      const lo = Math.min(...ends);
      const hi = Math.max(...ends);
      for (let v = 0; v < height; v++) {
        for (let u = 0; u < width; u++) {
          out[v * width + u] = background.from + ((background.to - background.from) * (u * dx + v * dy - lo)) / (hi - lo);
        }
      }
      return out;
    }
    case "radial": {
      const cx = (width - 1) / 2;
      const cy = (height - 1) / 2;
      const rmax = Math.hypot(cx, cy);
      for (let v = 0; v < height; v++) {
        for (let u = 0; u < width; u++) {
          out[v * width + u] = background.inner + ((background.outer - background.inner) * Math.hypot(u - cx, v - cy)) / rmax;
        }
      }
      return out;
    }
    case "noise": {
      const rng = createRng(seed ^ 0x5bd1e995);
      for (let i = 0; i < out.length; i++) out[i] = background.mean + background.sigma * rng.gaussian();
      return out;
    }
  }
}

function boardValue(layer: Layer, x: number, y: number, dark: number, light: number, marginLevel: number): number | null {
  const h = layer.inverse;
  const w = h[6] * x + h[7] * y + h[8];
  if (!(w > 0)) return null;
  const bx = (h[0] * x + h[1] * y + h[2]) / w;
  const by = (h[3] * x + h[4] * y + h[5]) / w;
  const ax = Math.abs(bx);
  const ay = Math.abs(by);
  if (ax > layer.marginX || ay > layer.marginY) return null;
  if (ax >= layer.halfX || ay >= layer.halfY) return marginLevel;
  const c = Math.min(layer.squaresX - 1, Math.floor(bx / layer.square + layer.squaresX / 2));
  const r = Math.min(layer.squaresY - 1, Math.floor(by / layer.square + layer.squaresY / 2));
  let darkSquare = isDarkSquare(r, c);
  if (layer.flipped.has(r * layer.squaresX + c)) darkSquare = !darkSquare;
  return darkSquare ? dark : light;
}

export function gaussianKernel(sigma: number): Float64Array {
  const radius = Math.max(1, Math.ceil(4 * sigma));
  const kernel = new Float64Array(2 * radius + 1);
  let sum = 0;
  for (let i = -radius; i <= radius; i++) {
    const w = Math.exp(-(i * i) / (2 * sigma * sigma));
    kernel[i + radius] = w;
    sum += w;
  }
  for (let i = 0; i < kernel.length; i++) kernel[i] /= sum;
  return kernel;
}

function convolveSeparable(values: Float32Array, width: number, height: number, kx: Float64Array, ky: Float64Array): Float32Array {
  const rx = (kx.length - 1) / 2;
  const ry = (ky.length - 1) / 2;
  const tmp = new Float32Array(values.length);
  for (let v = 0; v < height; v++) {
    for (let u = 0; u < width; u++) {
      let sum = 0;
      for (let k = -rx; k <= rx; k++) sum += kx[k + rx] * values[v * width + Math.min(width - 1, Math.max(0, u + k))];
      tmp[v * width + u] = sum;
    }
  }
  const out = new Float32Array(values.length);
  for (let v = 0; v < height; v++) {
    for (let u = 0; u < width; u++) {
      let sum = 0;
      for (let k = -ry; k <= ry; k++) sum += ky[k + ry] * tmp[Math.min(height - 1, Math.max(0, v + k)) * width + u];
      out[v * width + u] = sum;
    }
  }
  return out;
}

/** Separable Gaussian blur with radius ⌈4σ⌉ and clamp-to-edge borders. */
export function blurImage(values: Float32Array, width: number, height: number, sigma: number): Float32Array {
  const kernel = gaussianKernel(sigma);
  return convolveSeparable(values, width, height, kernel, kernel);
}

/** Draws a scene (docs/test_plan_camera_ar.md §2.3). */
export function render(options: RenderOptions): Render {
  const geometry = describeScene(options);
  const { width, height } = options;
  const seed = options.seed ?? 1;
  const dark = options.dark ?? DEFAULT_DARK;
  const light = options.light ?? DEFAULT_LIGHT;
  const marginLevel = options.marginLevel ?? light;
  const marginSquares = options.marginSquares ?? DEFAULT_MARGIN;

  const layers: Layer[] = (options.extraBoards ?? []).map((extra) =>
    makeLayer(extra.board, boardToImage(extra.mapping), marginSquares, [], width, height),
  );
  const primary = geometry.board && geometry.H ? makeLayer(geometry.board, geometry.H, marginSquares, options.flippedSquares ?? [], width, height) : null;
  if (primary) layers.push(primary);
  const shapes = (options.occluders ?? []).map((shape) => prepareShape(shape, geometry.H, width, height));

  const values = backgroundBuffer(options.background ?? DEFAULT_BACKGROUND, width, height, seed);
  const needsSamples = new Uint8Array(width * height);
  for (const [u0, v0, u1, v1] of [...layers.map((layer) => layer.box), ...shapes.map((shape) => shape.box)]) {
    for (let v = v0; v <= v1; v++) needsSamples.fill(1, v * width + u0, v * width + u1 + 1);
  }
  const boardInverse = primary?.inverse ?? null;
  for (let v = 0; v < height; v++) {
    for (let u = 0; u < width; u++) {
      const index = v * width + u;
      if (!needsSamples[index]) continue;
      const background = values[index];
      let sum = 0;
      for (let s = 0; s < OFFSETS.length; s += 2) {
        const x = u + OFFSETS[s];
        const y = v + OFFSETS[s + 1];
        let value = background;
        for (const layer of layers) {
          const onBoard = boardValue(layer, x, y, dark, light, marginLevel);
          if (onBoard !== null) value = onBoard;
        }
        if (shapes.length > 0) {
          let bx = NaN;
          let by = NaN;
          if (boardInverse) {
            const w = boardInverse[6] * x + boardInverse[7] * y + boardInverse[8];
            if (w > 0) {
              bx = (boardInverse[0] * x + boardInverse[1] * y + boardInverse[2]) / w;
              by = (boardInverse[3] * x + boardInverse[4] * y + boardInverse[5]) / w;
            }
          }
          for (const shape of shapes) {
            const inside = shape.space === "image" ? shape.contains(x, y) : Number.isFinite(bx) && shape.contains(bx, by);
            if (inside) value = fillValue(shape.fill, x, y);
          }
        }
        sum += value;
      }
      values[index] = sum / SAMPLES_PER_PIXEL;
    }
  }

  let pixels = values;
  if (options.gain && geometry.board && geometry.H) {
    const H = geometry.H;
    const [hx, hy] = halfExtent(geometry.board);
    const [cu, cv] = applyHomography(H, 0, 0);
    const a = (options.gain.angleDeg * Math.PI) / 180;
    const dx = Math.cos(a);
    const dy = Math.sin(a);
    let extent = 0;
    for (const [x, y] of [
      [-hx, -hy],
      [hx, -hy],
      [hx, hy],
      [-hx, hy],
    ]) {
      const [u, v] = applyHomography(H, x, y);
      extent = Math.max(extent, Math.abs((u - cu) * dx + (v - cv) * dy));
    }
    for (let v = 0; v < height; v++) {
      for (let u = 0; u < width; u++) {
        const g = 1 + (options.gain.amplitude * ((u - cu) * dx + (v - cv) * dy)) / extent;
        pixels[v * width + u] *= Math.max(0, g);
      }
    }
  }
  if (options.glare) {
    const { x, y, radius, strength } = options.glare;
    for (let v = 0; v < height; v++) {
      for (let u = 0; u < width; u++) pixels[v * width + u] += strength * Math.exp(-((u - x) ** 2 + (v - y) ** 2) / (2 * radius * radius));
    }
  }
  if (options.motionBlurPx && options.motionBlurPx > 1) {
    const half = Math.floor(options.motionBlurPx / 2);
    const box = new Float64Array(2 * half + 1).fill(1 / (2 * half + 1));
    pixels = convolveSeparable(pixels, width, height, box, new Float64Array([1]));
  }
  if (options.blurSigma && options.blurSigma > 0) pixels = blurImage(pixels, width, height, options.blurSigma);
  if (options.noiseSigma && options.noiseSigma > 0) {
    const rng = createRng(seed);
    for (let i = 0; i < pixels.length; i++) pixels[i] += options.noiseSigma * rng.gaussian();
  }
  if (options.posterizeLevels) {
    const step = 255 / (options.posterizeLevels - 1);
    for (let i = 0; i < pixels.length; i++) pixels[i] = Math.round(pixels[i] / step) * step;
  }
  const data = new Uint8ClampedArray(width * height);
  data.set(pixels); // rounds to the nearest integer and clamps to [0, 255]
  return { ...geometry, truth: geometry.truth, image: { width, height, data } };
}

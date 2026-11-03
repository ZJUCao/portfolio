// Chessboard inner-corner detection for camera AR. Published opencv.js builds don't export
// findChessboardCorners or cornerSubPix, so this is written from scratch.
// Contract: docs/design_camera_ar.md §5.2 and the resolved details in §14.
//
// Outline (design §7): blur the grey image, take the saddle points that look most like X-junctions
// as seeds, and grow a lattice from a seed one row or column at a time. Every corner is refined
// like cornerSubPix and kept only when the four squares around it alternate dark and light. A
// lattice is returned only when it has exactly the requested size, no corner continues it on any
// side, and its colouring fixes the order (O1–O3). A hint is refined in place first; when that fails
// the full search runs, so a hint can save time but never changes the answer's correctness.

/** An 8-bit greyscale image, row-major with no padding. */
export interface GrayImage {
  readonly width: number;
  readonly height: number;
  /** One byte per pixel; the length is width * height. */
  readonly data: Uint8Array | Uint8ClampedArray;
}

/** Options for {@link findChessboardCorners}. */
export interface DetectOptions {
  /**
   * Corners found in the previous frame, in the layout {@link findChessboardCorners} returns.
   * Only a hint for tracking: it never changes what counts as a correct result.
   */
  readonly previous?: Float32Array | null;
}

/**
 * Converts RGBA pixels to BT.601 luma, 0.299 R + 0.587 G + 0.114 B, ignoring alpha.
 * Each value is within 1 of the rounded exact value.
 *
 * @param rgba - 4 * width * height bytes, for example `ImageData.data`.
 * @param out - Optional buffer of width * height bytes to fill and return as `data`. It must not
 *   share memory with `rgba`.
 * @throws RangeError if width or height is not a positive integer, or a buffer has the wrong length.
 */
export function rgbaToGray(
  rgba: Uint8Array | Uint8ClampedArray,
  width: number,
  height: number,
  out?: Uint8Array,
): GrayImage {
  if (!isPositiveInteger(width) || !isPositiveInteger(height)) {
    throw new RangeError("rgbaToGray: width and height must be positive integers");
  }
  const n = width * height;
  if (rgba.length !== 4 * n) throw new RangeError("rgbaToGray: rgba must hold 4 * width * height bytes");
  if (out !== undefined && out.length !== n) throw new RangeError("rgbaToGray: out must hold width * height bytes");
  const data = out ?? new Uint8Array(n);
  // 16-bit fixed-point weights summing to 65536: before rounding, within 0.002 of the exact luma
  for (let k = 0, p = 0; k < n; k++, p += 4) {
    data[k] = (19595 * rgba[p] + 38470 * rgba[p + 1] + 7471 * rgba[p + 2] + 32768) >>> 16;
  }
  return { width, height, data };
}

/**
 * Finds every inner corner of a cornersX × cornersY chessboard with sub-pixel accuracy.
 *
 * Corner k = j * cornersX + i is returned at [2k, 2k + 1] in pixels, with pixel (u, v)'s centre at
 * (u, v). The order is unique: i runs along the side with cornersX corners (O1), the lattice is not
 * mirrored (O2), and the square diagonally outward from corner 0 is dark (O3).
 *
 * @param image - Greyscale frame.
 * @param cornersX - Inner corners along one side. Must differ from cornersY, and the two must have
 *   an odd sum so the board's colouring tells its 180°-rotated orientations apart.
 * @param cornersY - Inner corners along the other side.
 * @param options - Optional tracking hint.
 * @returns A new array of 2 * cornersX * cornersY coordinates, or null when no complete board of
 *   that size is found. Never a wrongly sized or wrongly ordered lattice.
 * @throws RangeError if the image or the board size is invalid, or `previous` has the wrong length.
 */
export function findChessboardCorners(
  image: GrayImage,
  cornersX: number,
  cornersY: number,
  options?: DetectOptions,
): Float32Array | null {
  const { width, height } = image;
  if (!isPositiveInteger(width) || !isPositiveInteger(height) || image.data.length !== width * height) {
    throw new RangeError("findChessboardCorners: the image needs positive integer sizes and width * height bytes");
  }
  const sizes = [cornersX, cornersY];
  if (!sizes.every((n) => Number.isInteger(n) && n >= 2) || cornersX === cornersY || (cornersX + cornersY) % 2 === 0) {
    throw new RangeError("findChessboardCorners: cornersX and cornersY must be different integers ≥ 2 with an odd sum");
  }
  const previous = options?.previous ?? null;
  if (previous !== null && previous.length !== 2 * cornersX * cornersY) {
    throw new RangeError("findChessboardCorners: previous must hold 2 * cornersX * cornersY values");
  }
  if (width < 8 || height < 8) return null; // too small for the blur and the corner tests
  let full: Maps | null = null;
  if (previous) {
    const region = hintRegion(previous, cornersX, cornersY, width, height);
    if (region) {
      const maps = computeMaps(image, region);
      const tracked = track(maps, previous, cornersX, cornersY);
      if (tracked) return tracked;
      if (maps.w === width && maps.h === height) full = maps;
    }
  }
  return detect(full ?? computeMaps(image, [0, 0, width, height]), cornersX, cornersY);
}

// ---------------------------------------------------------------------------------------------
// Image maps

/** A smoothed image region with its saddle response. Positions elsewhere are in image pixels. */
interface Maps {
  readonly x0: number;
  readonly y0: number;
  readonly w: number;
  readonly h: number;
  /** Grey values blurred with σ = 1 px, row-major. */
  readonly blur: Float32Array;
  /** Saddle response max(0, Ixy² − Ixx · Iyy) of `blur`; 0 on the region's border. */
  readonly resp: Float32Array;
}

/** A corner position in image pixels. */
interface Corner {
  readonly x: number;
  readonly y: number;
}

/** A corner position with the local lattice steps along i (e1) and j (e2). */
interface Frame extends Corner {
  readonly e1x: number;
  readonly e1y: number;
  readonly e2x: number;
  readonly e2y: number;
}

/** Corners indexed [j][i]. */
type Grid = Corner[][];

/** Row-major 3 × 3 homography from lattice coordinates (i, j) to image pixels. */
type Homography = Float64Array;

/** The affine map of a frame as a homography, with (i, j) = (0, 0) at the frame's corner. */
const frameHomography = (f: Frame): Homography => Float64Array.of(f.e1x, f.e2x, f.x, f.e1y, f.e2y, f.y, 0, 0, 1);

function project(H: Homography, i: number, j: number): Corner {
  const w = H[6] * i + H[7] * j + H[8];
  return { x: (H[0] * i + H[1] * j + H[2]) / w, y: (H[3] * i + H[4] * j + H[5]) / w };
}

type Region = readonly [x0: number, y0: number, x1: number, y1: number];

const BLUR_RADIUS = 3;
const KERNEL = Float64Array.from({ length: 2 * BLUR_RADIUS + 1 }, (_, k) => Math.exp(-((k - BLUR_RADIUS) ** 2) / 2));
const KERNEL_SUM = KERNEL.reduce((sum, value) => sum + value, 0);
KERNEL.forEach((value, k) => (KERNEL[k] = value / KERNEL_SUM));

const isPositiveInteger = (value: number): boolean => Number.isInteger(value) && value > 0;
const clamp = (value: number, lo: number, hi: number): number => (value < lo ? lo : value > hi ? hi : value);

function computeMaps(image: GrayImage, [x0, y0, x1, y1]: Region): Maps {
  const { width, height, data } = image;
  const w = x1 - x0;
  const h = y1 - y0;
  const r = BLUR_RADIUS;
  const top = Math.max(0, y0 - r);
  const rows = Math.min(height, y1 + r) - top;
  // Reads clamp to the image, not to the region, so a region holds the same values as a full frame
  const tmp = new Float32Array(w * rows);
  for (let y = 0; y < rows; y++) {
    const src = (top + y) * width;
    for (let x = 0; x < w; x++) {
      let sum = 0;
      for (let k = -r; k <= r; k++) sum += KERNEL[k + r] * data[src + clamp(x0 + x + k, 0, width - 1)];
      tmp[y * w + x] = sum;
    }
  }
  const blur = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let sum = 0;
      for (let k = -r; k <= r; k++) sum += KERNEL[k + r] * tmp[(clamp(y0 + y + k, 0, height - 1) - top) * w + x];
      blur[y * w + x] = sum;
    }
  }
  const resp = new Float32Array(w * h);
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      const ixx = blur[i - 1] - 2 * blur[i] + blur[i + 1];
      const iyy = blur[i - w] - 2 * blur[i] + blur[i + w];
      const ixy = 0.25 * (blur[i + w + 1] - blur[i + w - 1] - blur[i - w + 1] + blur[i - w - 1]);
      const value = ixy * ixy - ixx * iyy;
      resp[i] = value > 0 ? value : 0;
    }
  }
  return { x0, y0, w, h, blur, resp };
}

/** Bilinear sample of the blurred image at an image position; NaN outside the region. */
function sample(m: Maps, x: number, y: number): number {
  const fx = x - m.x0;
  const fy = y - m.y0;
  if (!(fx >= 0 && fy >= 0 && fx <= m.w - 1 && fy <= m.h - 1)) return NaN;
  const u = Math.min(m.w - 2, Math.floor(fx));
  const v = Math.min(m.h - 2, Math.floor(fy));
  const ax = fx - u;
  const i = v * m.w + u;
  const b = m.blur;
  const upper = b[i] + ax * (b[i + 1] - b[i]);
  return upper + (fy - v) * (b[i + m.w] + ax * (b[i + m.w + 1] - b[i + m.w]) - upper);
}

// ---------------------------------------------------------------------------------------------
// Corner tests and refinement

const MIN_STEP = 5; // px; the shortest lattice step considered (nominal squares are ≥ 12 px)
const MIN_CONTRAST = 12; // grey levels between the dark and the light diagonal of a junction
const CONTRAST_RATIO = 0.35; // weakest corner of a lattice relative to its reference (±25 % gain → 0.6)
const SAMPLE_MARGIN = 0.25; // each ring sample must clear the mid level by this fraction of the contrast
// Ring samples (a, b) in squares for one quadrant: radius 0.3 at 30°, 45° and 60°. The radius keeps
// them inside an occluder of radius 0.4 square or a bar of half-height 0.33 square (OQ-13) and at
// least 0.15 square from either edge.
const RING = [30, 45, 60].flatMap((deg) => [0.3 * Math.cos((deg * Math.PI) / 180), 0.3 * Math.sin((deg * Math.PI) / 180)]);
const QUADRANTS = [1, 1, -1, -1, 1, -1, -1, 1]; // (+,+) and (−,−) first: the first diagonal
const ringValues = new Float64Array(12);

/**
 * Signed contrast of an X-junction at image position (x, y), whose surroundings H maps from around
 * lattice point (i, j): the mean of the (+,−) and (−,+) quadrants minus that of (+,+) and (−,−), so
 * positive when the (+,+)/(−,−) diagonal is dark. NaN when a sample leaves the region, the contrast
 * is below MIN_CONTRAST, or any single sample falls on the wrong side of the mid level, which
 * rejects edges, T- and L-junctions, occluders and texture.
 */
function xTest(m: Maps, x: number, y: number, H: Homography, i: number, j: number): number {
  const centre = project(H, i, j);
  for (let q = 0, k = 0; q < 8; q += 2) {
    for (let r = 0; r < RING.length; r += 2, k++) {
      const a = i + QUADRANTS[q] * RING[r];
      const b = j + QUADRANTS[q + 1] * RING[r + 1];
      const w = H[6] * a + H[7] * b + H[8];
      const u = x + (H[0] * a + H[1] * b + H[2]) / w - centre.x;
      const v = y + (H[3] * a + H[4] * b + H[5]) / w - centre.y;
      const value = w > 0 ? sample(m, u, v) : NaN;
      if (Number.isNaN(value)) return NaN;
      ringValues[k] = value;
    }
  }
  let first = 0;
  let second = 0;
  for (let k = 0; k < 6; k++) {
    first += ringValues[k];
    second += ringValues[k + 6];
  }
  const s = (second - first) / 6;
  if (!(Math.abs(s) >= MIN_CONTRAST)) return NaN;
  const mid = (first + second) / 12;
  const margin = SAMPLE_MARGIN * Math.abs(s);
  for (let k = 0; k < 12; k++) {
    const above = (k < 6) === s < 0; // which side of the mid level sample k belongs on
    if ((above ? ringValues[k] - mid : mid - ringValues[k]) < margin) return NaN;
  }
  return s;
}

const MAX_WINDOW = 5;
const patch = new Float64Array((2 * MAX_WINDOW + 3) ** 2);
// Gaussian window weights exp(−(du² + dv²) / win²) for win = 0…5, as in cornerSubPix
const WEIGHTS = Array.from({ length: MAX_WINDOW + 1 }, (_, win) => {
  const side = 2 * win + 1;
  return Float64Array.from({ length: side * side }, (_, k) => {
    const [du, dv] = [(k % side) - win, Math.floor(k / side) - win];
    return Math.exp(-(du * du + dv * dv) / Math.max(1, win * win));
  });
});

/**
 * Sub-pixel corner in the manner of cornerSubPix: the point q minimising Σ w · (∇I(p) · (q − p))²
 * over a (2 · win + 1)² window around q, iterated. The window is resampled at q's sub-pixel offset
 * so it stays symmetric about q; a blurred X-junction is point-symmetric about its centre, even in
 * perspective, so the fixed point is unbiased. Null when the window leaves the region or the
 * gradients don't pin a point down (a lone edge or a flat patch).
 */
function refine(m: Maps, x: number, y: number, win: number): Corner | null {
  const n = 2 * win + 3;
  const weights = WEIGHTS[win];
  const { blur: b, w } = m;
  let qx = x;
  let qy = y;
  for (let iteration = 0; iteration < 10; iteration++) {
    const fx = qx - m.x0;
    const fy = qy - m.y0;
    const u0 = Math.floor(fx) - win - 1;
    const v0 = Math.floor(fy) - win - 1;
    if (!(u0 >= 0 && v0 >= 0 && u0 + n < m.w && v0 + n < m.h)) return null;
    const ax = fx - Math.floor(fx);
    const ay = fy - Math.floor(fy);
    for (let v = 0; v < n; v++) {
      for (let u = 0, i = (v0 + v) * w + u0; u < n; u++, i++) {
        const upper = b[i] + ax * (b[i + 1] - b[i]);
        patch[v * n + u] = upper + ay * (b[i + w] + ax * (b[i + w + 1] - b[i + w]) - upper);
      }
    }
    let a11 = 0;
    let a12 = 0;
    let a22 = 0;
    let b1 = 0;
    let b2 = 0;
    for (let dv = -win, k = 0; dv <= win; dv++) {
      for (let du = -win; du <= win; du++, k++) {
        const c = (dv + win + 1) * n + du + win + 1;
        const gx = 0.5 * (patch[c + 1] - patch[c - 1]);
        const gy = 0.5 * (patch[c + n] - patch[c - n]);
        const gxx = weights[k] * gx * gx;
        const gxy = weights[k] * gx * gy;
        const gyy = weights[k] * gy * gy;
        a11 += gxx;
        a12 += gxy;
        a22 += gyy;
        b1 += gxx * du + gxy * dv;
        b2 += gxy * du + gyy * dv;
      }
    }
    const det = a11 * a22 - a12 * a12;
    if (!(det > 1e-3 * (a11 + a22) ** 2)) return null;
    const dx = (a22 * b1 - a12 * b2) / det;
    const dy = (a11 * b2 - a12 * b1) / det;
    qx += dx;
    qy += dy;
    if (dx * dx + dy * dy < 1e-4) break; // moved less than 0.01 px
  }
  return { x: qx, y: qy };
}

/** The pixel with the strongest saddle response within `radius` of (x, y), or (x, y) if none responds. */
function snap(m: Maps, x: number, y: number, radius: number): Corner {
  const cx = x - m.x0;
  const cy = y - m.y0;
  const r = Math.ceil(radius);
  let best = 0;
  let bx = cx;
  let by = cy;
  for (let v = Math.max(1, Math.round(cy) - r); v <= Math.min(m.h - 2, Math.round(cy) + r); v++) {
    for (let u = Math.max(1, Math.round(cx) - r); u <= Math.min(m.w - 2, Math.round(cx) + r); u++) {
      const value = m.resp[v * m.w + u];
      if (value > best && (u - cx) ** 2 + (v - cy) ** 2 <= radius * radius) {
        best = value;
        bx = u;
        by = v;
      }
    }
  }
  return { x: bx + m.x0, y: by + m.y0 };
}

const distance = (a: Corner, b: Corner): number => Math.hypot(a.x - b.x, a.y - b.y);

/** The shorter of H's two lattice steps at (i, j), in pixels. */
function latticeStep(H: Homography, i: number, j: number): number {
  return Math.min(distance(project(H, i - 0.5, j), project(H, i + 0.5, j)), distance(project(H, i, j - 0.5), project(H, i, j + 0.5)));
}

/**
 * The corner near lattice point (i, j) of H: snapped to the strongest saddle response within
 * `reach` lattice steps, refined and checked. Null when there is none.
 */
function acceptCorner(
  m: Maps,
  H: Homography,
  i: number,
  j: number,
  reach: number,
  minContrast: number,
): (Corner & { readonly s: number }) | null {
  const spacing = latticeStep(H, i, j);
  if (!(spacing >= MIN_STEP)) return null;
  const predicted = project(H, i, j);
  const start = snap(m, predicted.x, predicted.y, reach * spacing);
  // §7 suggests min(5 px, 0.3 × spacing); 0.4 halves the noise error on 12 px squares, and a larger
  // window starts to reach the neighbouring edges there
  const win = Math.min(MAX_WINDOW, Math.round(0.4 * spacing));
  const q = refine(m, start.x, start.y, win);
  if (!q || distance(q, start) > win) return null;
  const s = xTest(m, q.x, q.y, H, i, j);
  return Math.abs(s) >= minContrast ? { x: q.x, y: q.y, s } : null;
}

// ---------------------------------------------------------------------------------------------
// Full search: seeds and lattice growth

const MIN_RESPONSE = 4; // saddle response a seed candidate needs (nominal corners give about 70 or more)
const MAX_CANDIDATES = 1500;
const MAX_SEEDS = 150;
const CONE_COS = Math.cos((25 * Math.PI) / 180); // how far a seed's neighbour may lie off an edge direction
const CHESS_RADIUS = 4; // px; inside the four squares of any nominal corner (squares ≥ 12 px)
const CHESS_RING = Array.from({ length: 16 }, (_, k) => (k * Math.PI) / 8).flatMap((angle) => [
  CHESS_RADIUS * Math.cos(angle),
  CHESS_RADIUS * Math.sin(angle),
]);
const chessValues = new Float64Array(16);

/** A seed candidate: a pixel with its saddle response and the Hessian of the blurred image there. */
interface Candidate extends Corner {
  readonly resp: number;
  readonly hxx: number;
  readonly hxy: number;
  readonly hyy: number;
}

/**
 * ChESS-style score of a 16-sample ring (Bennett and Lasenby): opposite samples of an X-junction
 * match and samples a quarter turn apart differ, so the sum response minus the difference response
 * is positive for X-junctions and about zero or negative for edges, L- and T-junctions, line
 * crossings and stroke ends, which can have a stronger saddle response than the board.
 */
function chessScore(m: Maps, x: number, y: number): number {
  for (let k = 0; k < 16; k++) chessValues[k] = sample(m, x + CHESS_RING[2 * k], y + CHESS_RING[2 * k + 1]);
  let score = 0;
  for (let k = 0; k < 4; k++) score += Math.abs(chessValues[k] + chessValues[k + 8] - chessValues[k + 4] - chessValues[k + 12]);
  for (let k = 0; k < 8; k++) score -= Math.abs(chessValues[k] - chessValues[k + 8]);
  return score; // NaN near the region's border
}

/** Local maxima of the saddle response that look like X-junctions, most X-like first. */
function findCandidates(m: Maps): Candidate[] {
  const { w, h, resp, blur } = m;
  const found: { i: number; score: number }[] = [];
  for (let y = 2; y < h - 2; y++) {
    for (let x = 2; x < w - 2; x++) {
      const i = y * w + x;
      const r = resp[i];
      // 3 × 3 non-maximum suppression; of equal neighbours the first in scan order wins
      if (r < MIN_RESPONSE || r <= resp[i - w - 1] || r <= resp[i - w] || r <= resp[i - w + 1] || r <= resp[i - 1]) continue;
      if (r < resp[i + 1] || r < resp[i + w - 1] || r < resp[i + w] || r < resp[i + w + 1]) continue;
      const score = chessScore(m, m.x0 + x, m.y0 + y);
      if (score > 0) found.push({ i, score });
    }
  }
  found.sort((a, b) => b.score - a.score || a.i - b.i);
  return found.slice(0, MAX_CANDIDATES).map(({ i }) => ({
    x: m.x0 + (i % w),
    y: m.y0 + Math.floor(i / w),
    resp: resp[i],
    hxx: blur[i - 1] - 2 * blur[i] + blur[i + 1],
    hxy: 0.25 * (blur[i + w + 1] - blur[i + w - 1] - blur[i - w + 1] + blur[i - w - 1]),
    hyy: blur[i - w] - 2 * blur[i] + blur[i + w],
  }));
}

/**
 * A 3 × 3 block of corners centred on candidate k, or null. The two directions in which the
 * candidate's Hessian quadratic form vanishes approximate its edges; the nearest candidate of
 * opposite polarity within 25° of each of the four edge rays is the neighbour along it.
 */
function seedBlock(m: Maps, candidates: Candidate[], k: number, maxStep: number): { grid: Grid; minContrast: number; step: number } | null {
  const seed = candidates[k];
  const { hxx, hxy, hyy } = seed;
  const mean = (hxx + hyy) / 2;
  const radius = Math.hypot((hxx - hyy) / 2, hxy);
  if (!(radius > Math.abs(mean))) return null;
  // Q(θ) = mean + radius · cos(2θ − φ) is zero at θ = (φ ± acos(−mean / radius)) / 2
  const phi = Math.atan2(hxy, (hxx - hyy) / 2);
  const delta = Math.acos(-mean / radius);
  const d = [Math.cos((phi + delta) / 2), Math.sin((phi + delta) / 2), Math.cos((phi - delta) / 2), Math.sin((phi - delta) / 2)];
  // Polarity: the sign of d1ᵀ H d2, which flips from one lattice corner to the next
  const polarity = (c: Candidate) => c.hxx * d[0] * d[2] + c.hxy * (d[0] * d[3] + d[1] * d[2]) + c.hyy * d[1] * d[3];
  const own = polarity(seed);
  const best: Candidate[] = [];
  const bestDistance = [maxStep, maxStep, maxStep, maxStep];
  for (const c of candidates) {
    if (c.resp < 0.1 * seed.resp || polarity(c) * own >= 0) continue;
    const vx = c.x - seed.x;
    const vy = c.y - seed.y;
    const length = Math.hypot(vx, vy);
    if (length < MIN_STEP) continue;
    const along1 = (vx * d[0] + vy * d[1]) / length;
    const along2 = (vx * d[2] + vy * d[3]) / length;
    const ray = along1 >= CONE_COS ? 0 : along1 <= -CONE_COS ? 1 : along2 >= CONE_COS ? 2 : along2 <= -CONE_COS ? 3 : -1;
    if (ray >= 0 && length < bestDistance[ray]) {
      bestDistance[ray] = length;
      best[ray] = c;
    }
  }
  if (!(best[0] && best[1] && best[2] && best[3])) return null;
  const e1x = (best[0].x - best[1].x) / 2;
  const e1y = (best[0].y - best[1].y) / 2;
  const e2x = (best[2].x - best[3].x) / 2;
  const e2y = (best[2].y - best[3].y) / 2;
  const step = Math.min(Math.hypot(e1x, e1y), Math.hypot(e2x, e2y));
  if (!(Math.abs(e1x * e2y - e1y * e2x) > 0.3 * Math.hypot(e1x, e1y) * Math.hypot(e2x, e2y))) return null;
  const centre = acceptCorner(m, frameHomography({ x: seed.x, y: seed.y, e1x, e1y, e2x, e2y }), 0, 0, 0.3, MIN_CONTRAST);
  if (!centre) return null;
  const minContrast = CONTRAST_RATIO * Math.abs(centre.s);
  const H = frameHomography({ x: centre.x, y: centre.y, e1x, e1y, e2x, e2y });
  const grid: Grid = [];
  for (let b = -1; b <= 1; b++) {
    const row: Corner[] = [];
    for (let a = -1; a <= 1; a++) {
      const corner = a === 0 && b === 0 ? centre : acceptCorner(m, H, a, b, 0.3, minContrast);
      if (!corner) return null;
      row.push(corner);
    }
    grid.push(row);
  }
  return { grid, minContrast, step };
}

/** The grid turned a quarter, (i, j) → (j, nI − 1 − i): the old bottom row becomes the right column. */
function rotate(g: Grid): Grid {
  const nI = g[0].length;
  return Array.from({ length: nI }, (_, j) => g.map((row) => row[nI - 1 - j]));
}

function transpose(g: Grid): Grid {
  return Array.from({ length: g[0].length }, (_, i) => g.map((row) => row[i]));
}

/** Frames for a column beyond the right side, extrapolated along each row (quadratic from three). */
function predictRight(g: Grid): Frame[] {
  const nI = g[0].length;
  const ahead = g.map((row) => {
    const [a, b] = [row[nI - 1], row[nI - 2]];
    if (nI < 3) return { x: 2 * a.x - b.x, y: 2 * a.y - b.y };
    const c = row[nI - 3];
    return { x: 3 * (a.x - b.x) + c.x, y: 3 * (a.y - b.y) + c.y };
  });
  return ahead.map((p, j) => {
    const lo = ahead[Math.max(0, j - 1)];
    const hi = ahead[Math.min(ahead.length - 1, j + 1)];
    const span = Math.min(ahead.length - 1, j + 1) - Math.max(0, j - 1);
    const last = g[j][nI - 1];
    return { ...p, e1x: p.x - last.x, e1y: p.y - last.y, e2x: (hi.x - lo.x) / span, e2y: (hi.y - lo.y) / span };
  });
}

/** Adds a column on the right when every corner of it is found. */
function extendRight(m: Maps, g: Grid, minContrast: number): boolean {
  const added: Corner[] = [];
  for (const f of predictRight(g)) {
    const corner = acceptCorner(m, frameHomography(f), 0, 0, 0.3, minContrast);
    if (!corner) return false;
    added.push(corner);
  }
  g.forEach((row, j) => row.push(added[j]));
  return true;
}

/** Grows the grid until no side can be extended; null once it exceeds the requested size. */
function grow(m: Maps, seed: Grid, minContrast: number, maxDim: number, minDim: number): Grid | null {
  let g = seed;
  for (let fails = 0; fails < 4; g = rotate(g)) {
    if (!extendRight(m, g, minContrast)) {
      fails++;
      continue;
    }
    fails = 0;
    const [nI, nJ] = [g[0].length, g.length];
    if (Math.max(nI, nJ) > maxDim || Math.min(nI, nJ) > minDim) return null;
  }
  return g;
}

function detect(m: Maps, cornersX: number, cornersY: number): Float32Array | null {
  const candidates = findCandidates(m);
  const maxStep = 0.4 * Math.max(m.w, m.h);
  const used: { x: number; y: number; r2: number }[] = [];
  for (let k = 0, tries = 0; k < candidates.length && tries < MAX_SEEDS; k++) {
    const { x, y } = candidates[k];
    if (used.some((p) => (p.x - x) ** 2 + (p.y - y) ** 2 < p.r2)) continue;
    tries++;
    const seed = seedBlock(m, candidates, k, maxStep);
    if (!seed) continue;
    const g = grow(m, seed.grid, seed.minContrast, Math.max(cornersX, cornersY), Math.min(cornersX, cornersY));
    if (!g) return null; // a larger lattice than requested is visible (d)
    const [nI, nJ] = [g[0].length, g.length];
    if ((nI === cornersX && nJ === cornersY) || (nI === cornersY && nJ === cornersX)) return finish(m, g, cornersX, cornersY);
    for (const row of g) for (const p of row) used.push({ x: p.x, y: p.y, r2: (0.5 * seed.step) ** 2 });
  }
  return null;
}

// ---------------------------------------------------------------------------------------------
// Tracking, validation and ordering

/** The region a hint needs (its corners plus two lattice steps all round), or null if it can't be a board. */
function hintRegion(previous: Float32Array, cornersX: number, cornersY: number, width: number, height: number): Region | null {
  let [minX, minY, maxX, maxY, step] = [Infinity, Infinity, -Infinity, -Infinity, 0];
  for (let k = 0; k < cornersX * cornersY; k++) {
    const x = previous[2 * k];
    const y = previous[2 * k + 1];
    if (!(x >= 0 && y >= 0 && x <= width - 1 && y <= height - 1)) return null; // also NaN
    [minX, minY, maxX, maxY] = [Math.min(minX, x), Math.min(minY, y), Math.max(maxX, x), Math.max(maxY, y)];
    if (k % cornersX > 0) step = Math.max(step, Math.hypot(x - previous[2 * k - 2], y - previous[2 * k - 1]));
    if (k >= cornersX) step = Math.max(step, Math.hypot(x - previous[2 * (k - cornersX)], y - previous[2 * (k - cornersX) + 1]));
  }
  const pad = 2 * step + 8;
  const [x0, y0] = [Math.max(0, Math.floor(minX - pad)), Math.max(0, Math.floor(minY - pad))];
  return [x0, y0, Math.min(width, Math.ceil(maxX + pad) + 1), Math.min(height, Math.ceil(maxY + pad) + 1)];
}

/** Lattice steps at corner (i, j) of a grid: central differences, one-sided at the ends. */
function frameAt(g: Grid, i: number, j: number): Frame {
  const [nI, nJ] = [g[0].length, g.length];
  const [i0, i1, j0, j1] = [Math.max(0, i - 1), Math.min(nI - 1, i + 1), Math.max(0, j - 1), Math.min(nJ - 1, j + 1)];
  const p = g[j][i];
  return {
    x: p.x,
    y: p.y,
    e1x: (g[j][i1].x - g[j][i0].x) / (i1 - i0),
    e1y: (g[j][i1].y - g[j][i0].y) / (i1 - i0),
    e2x: (g[j1][i].x - g[j0][i].x) / (j1 - j0),
    e2y: (g[j1][i].y - g[j0][i].y) / (j1 - j0),
  };
}

/** Refines every corner of a hint in place; the result goes through the same checks as a search. */
function track(m: Maps, previous: Float32Array, cornersX: number, cornersY: number): Float32Array | null {
  const hint: Grid = Array.from({ length: cornersY }, (_, j) =>
    Array.from({ length: cornersX }, (_, i) => ({ x: previous[2 * (j * cornersX + i)], y: previous[2 * (j * cornersX + i) + 1] })),
  );
  const grid: Grid = [];
  for (let j = 0; j < cornersY; j++) {
    const row: Corner[] = [];
    for (let i = 0; i < cornersX; i++) {
      // The board may have moved up to 0.25 square since the hint (OQ-15)
      const corner = acceptCorner(m, frameHomography(frameAt(hint, i, j)), 0, 0, 0.4, MIN_CONTRAST);
      if (!corner) return null;
      row.push(corner);
    }
    grid.push(row);
  }
  return finish(m, grid, cornersX, cornersY);
}

/**
 * The homography through a lattice's four outer corners (Heckbert's square-to-quad mapping). Under
 * strong perspective it places samples beyond the lattice far better than local steps do.
 */
function latticeHomography(g: Grid): Homography | null {
  const [nI, nJ] = [g[0].length, g.length];
  const [p0, p1, p2, p3] = [g[0][0], g[0][nI - 1], g[nJ - 1][nI - 1], g[nJ - 1][0]];
  // Solve gu · (p1 − p2) + gv · (p3 − p2) = p0 − p1 + p2 − p3 for the perspective terms
  const [sx, sy] = [p0.x - p1.x + p2.x - p3.x, p0.y - p1.y + p2.y - p3.y];
  const [dx1, dy1, dx2, dy2] = [p1.x - p2.x, p1.y - p2.y, p3.x - p2.x, p3.y - p2.y];
  const det = dx1 * dy2 - dx2 * dy1;
  const gu = (sx * dy2 - sy * dx2) / det;
  const gv = (dx1 * sy - dy1 * sx) / det;
  const [su, sv] = [1 / (nI - 1), 1 / (nJ - 1)];
  const H = Float64Array.of(
    (p1.x - p0.x + gu * p1.x) * su,
    (p3.x - p0.x + gv * p3.x) * sv,
    p0.x,
    (p1.y - p0.y + gu * p1.y) * su,
    (p3.y - p0.y + gv * p3.y) * sv,
    p0.y,
    gu * su,
    gv * sv,
    1,
  );
  return H.every(Number.isFinite) ? H : null;
}

/** How far b deviates from the midpoint of its neighbours a and c, doubled (a second difference). */
const bend = (a: Corner, b: Corner, c: Corner): number => Math.hypot(a.x + c.x - 2 * b.x, a.y + c.y - 2 * b.y);

/** Whether a corner continues the lattice at lattice point (i, j), just beyond one of its sides. */
function continues(m: Maps, H: Homography, i: number, j: number, minContrast: number): boolean {
  const p = project(H, i, j);
  return Math.abs(xTest(m, p.x, p.y, H, i, j)) >= minContrast || acceptCorner(m, H, i, j, 0.3, minContrast) !== null;
}

/**
 * Checks a lattice of the requested size and orders it (O1–O3), or returns null. Every cell must
 * keep one orientation, rows and columns must be nearly straight, every corner must be an
 * X-junction of the lattice's polarity pattern and contrast, and no corner may continue the
 * lattice beyond any side (a larger board, rejection (d)).
 */
function finish(m: Maps, input: Grid, cornersX: number, cornersY: number): Float32Array | null {
  let g = input[0].length === cornersX ? input : transpose(input); // O1
  if (g[0].length !== cornersX || g.length !== cornersY) return null;
  const f0 = frameAt(g, 0, 0);
  if (f0.e1x * f0.e2y - f0.e1y * f0.e2x < 0) g = g.map((row) => row.slice().reverse()); // O2
  const H = latticeHomography(g);
  if (!H) return null;
  const contrast = new Float64Array(cornersX * cornersY);
  for (let j = 0; j < cornersY; j++) {
    for (let i = 0; i < cornersX; i++) {
      const f = frameAt(g, i, j);
      const [l1, l2] = [Math.hypot(f.e1x, f.e1y), Math.hypot(f.e2x, f.e2y)];
      if (!(f.e1x * f.e2y - f.e1y * f.e2x > 0.2 * l1 * l2)) return null;
      const p = g[j][i];
      if (i > 0 && i < cornersX - 1 && bend(g[j][i - 1], p, g[j][i + 1]) > 0.35 * l1) return null;
      if (j > 0 && j < cornersY - 1 && bend(g[j - 1][i], p, g[j + 1][i]) > 0.35 * l2) return null;
      contrast[j * cornersX + i] = xTest(m, p.x, p.y, H, i, j);
      if (Number.isNaN(contrast[j * cornersX + i])) return null;
    }
  }
  const sorted = Array.from(contrast, Math.abs).sort((a, b) => a - b);
  const minContrast = Math.max(MIN_CONTRAST, CONTRAST_RATIO * sorted[sorted.length >> 1]);
  // Polarity alternates from corner to corner; `sign` is that of corner 0
  const sign = Math.sign(contrast[0]);
  for (let k = 0; k < contrast.length; k++) {
    const parity = ((k % cornersX) + Math.floor(k / cornersX)) % 2 === 0 ? 1 : -1;
    if (!(Math.abs(contrast[k]) >= minContrast) || Math.sign(contrast[k]) * parity !== sign) return null;
  }
  for (let i = 0; i < cornersX; i++) {
    if (continues(m, H, i, -1, minContrast) || continues(m, H, i, cornersY, minContrast)) return null;
  }
  for (let j = 0; j < cornersY; j++) {
    if (continues(m, H, -1, j, minContrast) || continues(m, H, cornersX, j, minContrast)) return null;
  }
  // O3: corner 0's (−,−) quadrant, the square diagonally outward, must be dark. A half turn flips the
  // polarity of corner 0 because cornersX + cornersY is odd.
  if (sign < 0) g = g.slice().reverse().map((row) => row.slice().reverse());
  const out = new Float32Array(2 * cornersX * cornersY);
  g.forEach((row, j) =>
    row.forEach((p, i) => {
      out[2 * (j * cornersX + i)] = p.x;
      out[2 * (j * cornersX + i) + 1] = p.y;
    }),
  );
  return out;
}

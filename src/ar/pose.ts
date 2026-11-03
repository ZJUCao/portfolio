// Planar pose for camera AR: pinhole intrinsics, the board pose from its corners (planar PnP), the
// focal length from the board, and the three.js view and projection matrices as plain arrays.
// Contract: docs/design_camera_ar.md §5.3, the conventions of §6 and the resolved details in §14.
//
// Outline (design §7): a normalised DLT homography from the board plane to the image, decomposed
// with K⁻¹ into a first pose, then Levenberg–Marquardt on the pixel reprojection error. The focal
// length comes from the homography's orthogonality constraints. There is no linear-algebra
// dependency and no runtime import, so the module runs in Node, in the worker and on the page.

/** An image or viewport size in pixels. */
export interface Size {
  readonly width: number;
  readonly height: number;
}

/** Pinhole intrinsics in pixels, with pixel (u, v)'s centre at (u, v) (§6). */
export interface Intrinsics {
  readonly fx: number;
  readonly fy: number;
  readonly cx: number;
  readonly cy: number;
}

/**
 * Board frame → OpenCV camera frame (x right, y down, z forward): the board point (X, Y, 0) is at
 * R · (X, Y, 0) + t in camera coordinates.
 */
export interface Pose {
  /** Rotation, 3×3 row-major. */
  readonly R: Float64Array;
  /** The board origin in camera coordinates, in board units. */
  readonly t: Float64Array;
  /** Root mean square pixel distance between the image points and the reprojected board points. */
  readonly rms: number;
}

/**
 * Intrinsics of a camera with square pixels, the given horizontal field of view and the principal
 * point at the image centre: fx = fy = (width / 2) / tan(hfov / 2), cx = (width − 1) / 2 and
 * cy = (height − 1) / 2.
 *
 * @param width - Image width in pixels: positive and finite, not necessarily an integer.
 * @param height - Image height in pixels, under the same rules.
 * @param hfovDeg - Horizontal field of view in degrees, in (0, 180).
 * @throws RangeError if a size is not positive and finite, or hfovDeg is outside (0, 180).
 */
export function intrinsicsFromFov(width: number, height: number, hfovDeg: number): Intrinsics {
  if (!isPositiveFinite(width) || !isPositiveFinite(height)) {
    throw new RangeError("intrinsicsFromFov: width and height must be positive and finite");
  }
  if (!(hfovDeg > 0 && hfovDeg < 180)) throw new RangeError("intrinsicsFromFov: hfovDeg must lie in (0, 180)");
  const f = width / 2 / Math.tan((hfovDeg * Math.PI) / 360);
  return { fx: f, fy: f, cx: (width - 1) / 2, cy: (height - 1) / 2 };
}

/**
 * Finds the pose of a planar board from N ≥ 4 correspondences between points on the board plane
 * Z = 0 and their pixel positions. The pose minimises the pixel reprojection error, so its `rms` is
 * never larger than that of the pose taken directly from the homography.
 *
 * @param objectXY - Board-plane coordinates X0, Y0, X1, Y1, …
 * @param imageXY - Pixel coordinates u0, v0, u1, v1, … in the same order.
 * @param K - The camera intrinsics.
 * @returns A new pose with R orthonormal (det R = +1) and t_z > 0, or null when the problem is
 *   degenerate: no four object points, or no four image points, have no three on a line, or no
 *   finite solution puts the whole board, and the board origin, in front of the camera.
 * @throws RangeError if the arrays differ in length, their length is odd or below 8, a value is not
 *   finite, or K has a non-finite value or fx or fy ≤ 0.
 */
export function solvePlanarPnP(objectXY: ArrayLike<number>, imageXY: ArrayLike<number>, K: Intrinsics): Pose | null {
  const [object, image] = readCorrespondences("solvePlanarPnP", objectXY, imageXY);
  const { fx, fy, cx, cy } = K;
  if (![fx, fy, cx, cy].every(Number.isFinite) || !(fx > 0 && fy > 0)) {
    throw new RangeError("solvePlanarPnP: K must be finite with fx, fy > 0");
  }
  if (!inGeneralPosition(object) || !inGeneralPosition(image)) return null;
  // Normalised image coordinates K⁻¹ (u, v, 1), so that the homography is G = μ [r1 r2 t]
  const rays = image.map((value, m) => (m % 2 === 0 ? (value - cx) / fx : (value - cy) / fy));
  const G = fitHomography(object, rays);
  const start = G === null ? null : poseFromHomography(G, object);
  return start === null ? null : refinePose(start, object, image, K);
}

/**
 * Estimates the focal length in pixels from the board-to-image homography, assuming square pixels,
 * zero skew and the principal point at ((width − 1) / 2, (height − 1) / 2).
 *
 * A near fronto-parallel view carries no focal information. With tilt the angle between the board
 * normal and the optical axis, and a true horizontal field of view of 40–100°: under 10° the result
 * is null for exact data, and for σ ≤ 0.3 px data when the board spans at least 40 % of the image
 * width; from 10° to 25° it may be null; from 25° to 60° it is a value for exact or σ ≤ 0.3 px data
 * with the board spanning at least 40 % of the image width. Scaling the object points by a constant
 * factor leaves the estimate unchanged within 1e−9 relative.
 *
 * @returns The focal length, or null for a near fronto-parallel view, a degenerate point set, or an
 *   estimate that is not finite and positive.
 * @throws RangeError under the conditions of {@link solvePlanarPnP} for the arrays, or if width or
 *   height is not positive and finite.
 */
export function estimateFocal(
  objectXY: ArrayLike<number>,
  imageXY: ArrayLike<number>,
  width: number,
  height: number,
): number | null {
  const [object, image] = readCorrespondences("estimateFocal", objectXY, imageXY);
  if (!isPositiveFinite(width) || !isPositiveFinite(height)) {
    throw new RangeError("estimateFocal: width and height must be positive and finite");
  }
  if (!inGeneralPosition(object) || !inGeneralPosition(image)) return null;
  const cx = (width - 1) / 2;
  const cy = (height - 1) / 2;
  const H = fitHomography(object, image.map((value, m) => value - (m % 2 === 0 ? cx : cy)));
  if (H === null) return null;
  // In pixels centred on the principal point H = λ diag(f, f, 1) [r1 r2 t]. Let M be its upper-left
  // 2 × 2 block, S = MᵀM and g = (h31, h32). As r1 and r2 are orthonormal, S = f² (λ² I − g gᵀ), so
  // S / f² + g gᵀ is a multiple of I: the traceless parts a = ((s11 − s22) / 2, s12) of S and b of
  // g gᵀ satisfy a / f² + b = 0, which least squares solves for 1 / f². Scaling the object points
  // scales a and b alike and shifting them only changes H's third column, so neither moves the
  // estimate (OQ-63).
  const [h11, h12, , h21, h22, , h31, h32] = H;
  const a1 = (h11 * h11 + h21 * h21 - h12 * h12 - h22 * h22) / 2;
  const a2 = h11 * h12 + h21 * h22;
  const b1 = (h31 * h31 - h32 * h32) / 2;
  const b2 = h31 * h32;
  // S has the eigenvalues λ²f² and λ²f² cos² τ, τ being the tilt between the board normal and the
  // optical axis (OQ-23), so ρ = |a| / tr S gives sin² τ = 4ρ / (1 + 2ρ) without knowing f (§7).
  // Rejecting small tilts this way holds for every field of view, unlike a test on the size of g,
  // which for a given tilt grows as f shrinks (OQ-62); near fronto-parallel, b ∝ sin² τ drowns in noise.
  const rho = Math.hypot(a1, a2) / (h11 * h11 + h21 * h21 + h12 * h12 + h22 * h22);
  if (!((4 * rho) / (1 + 2 * rho) >= MIN_SIN2_TILT)) return null;
  const f = 1 / Math.sqrt(-(a1 * b1 + a2 * b2) / (a1 * a1 + a2 * a2));
  return f > 0 && f < Infinity ? f : null; // 1 / f² ≤ 0 gives NaN or Infinity
}

/**
 * The three.js view matrix (`camera.matrixWorldInverse`) for a pose, column-major like
 * `THREE.Matrix4.elements`: V · [p, 1] = [F · (R · B · p + t), 1] for every scene point p, where
 * B = [[1, 0, 0], [0, 0, 1], [0, −1, 0]] maps scene to board coordinates and F = diag(1, −1, −1)
 * maps the OpenCV camera to the three.js camera (§6). The pose is not validated.
 *
 * @returns A new 16-element array.
 */
export function viewMatrix(pose: Pose): Float64Array {
  const { R, t } = pose;
  // Columns of F · R · B: B sends the scene axes x, y, z to the board axes X, −Z, Y, so R · B has the
  // columns r1, −r3 and r2, and F negates their y and z entries; the last column is F · t
  return Float64Array.of(
    R[0], -R[3], -R[6], 0,
    -R[2], R[5], R[8], 0,
    R[1], -R[4], -R[7], 0,
    t[0], -t[1], -t[2], 1,
  );
}

/**
 * The three.js projection matrix for a viewport that shows the analysis image scaled like CSS
 * `object-fit: cover`: uniform scale s = max(W / w, H / h), centred. It is column-major like
 * `THREE.Matrix4.elements` and acts on three.js camera coordinates, which are (X, −Y, −Z) for the
 * OpenCV camera point (X, Y, Z). For Z > 0 the point lands, after perspective division, at
 * x_ndc = (2 s fx / W) · (X / Z) + (s / W) · (2 cx + 1 − w) and
 * y_ndc = −(2 s fy / H) · (Y / Z) − (s / H) · (2 cy + 1 − h), with near mapped to depth −1 and far
 * to +1 as in OpenGL.
 *
 * @param K - Intrinsics of the analysis image.
 * @param image - Analysis image size w × h.
 * @param viewport - Viewport size W × H, for example in CSS pixels.
 * @param near - Near plane distance in scene units.
 * @param far - Far plane distance in scene units.
 * @returns A new 16-element array.
 * @throws RangeError if a size is not positive and finite, K has a non-finite value or fx or fy ≤ 0,
 *   or near and far are not finite with 0 < near < far.
 */
export function projectionMatrix(K: Intrinsics, image: Size, viewport: Size, near: number, far: number): Float64Array {
  const { width: w, height: h } = image;
  const { width: W, height: H } = viewport;
  if (![w, h, W, H].every(isPositiveFinite)) {
    throw new RangeError("projectionMatrix: image and viewport sizes must be positive and finite");
  }
  if (![K.fx, K.fy, K.cx, K.cy].every(Number.isFinite) || !(K.fx > 0 && K.fy > 0)) {
    throw new RangeError("projectionMatrix: K must be finite with fx, fy > 0");
  }
  if (!(near > 0 && near < far && far < Infinity)) {
    throw new RangeError("projectionMatrix: near and far must be finite with 0 < near < far");
  }
  const s = Math.max(W / w, H / h);
  // The bottom row (0, 0, −1, 0) turns the three.js camera's −Z into clip w = Z. The §5.3 offsets
  // don't scale with X / Z, so they sit in the third column, which multiplies −Z; depth is OpenGL's
  const P = new Float64Array(16);
  P[0] = (2 * s * K.fx) / W;
  P[5] = (2 * s * K.fy) / H;
  P[8] = -(s / W) * (2 * K.cx + 1 - w);
  P[9] = (s / H) * (2 * K.cy + 1 - h);
  P[10] = -(far + near) / (far - near);
  P[11] = -1;
  P[14] = (-2 * far * near) / (far - near);
  return P;
}

/**
 * The camera centre in scene coordinates, B⁻¹ · (−Rᵀ · t) (§6). The pose is not validated.
 *
 * @returns A new 3-element array.
 */
export function cameraPosition(pose: Pose): Float64Array {
  const { R, t } = pose;
  // −Rᵀ t in board coordinates; B⁻¹ = Bᵀ sends board (X, Y, Z) to scene (X, −Z, Y)
  const X = -(R[0] * t[0] + R[3] * t[1] + R[6] * t[2]);
  const Y = -(R[1] * t[0] + R[4] * t[1] + R[7] * t[2]);
  const Z = -(R[2] * t[0] + R[5] * t[1] + R[8] * t[2]);
  return Float64Array.of(X, -Z, Y);
}

// estimateFocal gives null below a tilt of 17.5° from the optical axis, midway between the 10° under
// which the result must be null and the 25° from which it must be a value (§5.3). With σ = 0.3 px, a
// board spanning 40 % of the width and hfov 40–100°, the tilt read from M stayed below 10.9° for true
// tilts under 10° and above 24.4° at 25° in 3,000 seeded trials each: about 7° of margin either side
const MIN_SIN2_TILT = Math.sin((17.5 * Math.PI) / 180) ** 2;

// ---------------------------------------------------------------------------------------------
// Validation and degeneracy

const isPositiveFinite = (value: number): boolean => value > 0 && value < Infinity;

/** Float64 copies of the two coordinate arrays, after the §5.3 preconditions. */
function readCorrespondences(name: string, objectXY: ArrayLike<number>, imageXY: ArrayLike<number>): [Float64Array, Float64Array] {
  const length = objectXY.length;
  if (imageXY.length !== length || length % 2 !== 0 || length < 8) {
    throw new RangeError(`${name}: objectXY and imageXY must have the same even length, at least 8`);
  }
  const object = Float64Array.from(objectXY);
  const image = Float64Array.from(imageXY);
  if (!object.every(Number.isFinite) || !image.every(Number.isFinite)) {
    throw new RangeError(`${name}: every coordinate must be finite`);
  }
  return [object, image];
}

// Distances below this fraction of a point set's extent count as zero in the degeneracy tests:
// 1e−4 px across a 100 px board, far below any detector's noise yet above the rounding of float32
// pixel coordinates, and independent of the units of the object points
const COLLINEAR_TOLERANCE = 1e-6;

/**
 * Whether some four of the points have no three on a line (OQ-20, OQ-61). Given a triangle a, b, c
 * of the set, a fourth point off its three side lines completes such a four, and so do two points on
 * different sides (d on ab and e on bc give a, d, e, c). So the set is degenerate exactly when it is
 * collinear or, for some side, all points off that side's line are one and the same point. a, b and c
 * are picked far apart (a farthest from point 0, b farthest from a, c farthest from the line ab) to
 * keep the distances well conditioned.
 */
function inGeneralPosition(xy: Float64Array): boolean {
  const a = argMax(xy, (k) => distance(xy, k, 0));
  const b = argMax(xy, (k) => distance(xy, k, a));
  const tolerance = COLLINEAR_TOLERANCE * distance(xy, a, b);
  if (!(tolerance > 0)) return false; // all points coincide
  const c = argMax(xy, (k) => lineDistance(xy, k, a, b));
  if (lineDistance(xy, c, a, b) <= tolerance) return false; // all points on one line
  return !allButOneOnLine(xy, a, b, tolerance) && !allButOneOnLine(xy, b, c, tolerance) && !allButOneOnLine(xy, c, a, tolerance);
}

/** Index of the point with the largest score, the first one on ties. */
function argMax(xy: Float64Array, score: (k: number) => number): number {
  let best = 0;
  let bestScore = score(0);
  for (let k = 1; k < xy.length / 2; k++) {
    const value = score(k);
    if (value > bestScore) {
      best = k;
      bestScore = value;
    }
  }
  return best;
}

const distance = (xy: Float64Array, i: number, j: number): number => Math.hypot(xy[2 * i] - xy[2 * j], xy[2 * i + 1] - xy[2 * j + 1]);

/** Distance from point k to the line through the distinct points i and j. */
function lineDistance(xy: Float64Array, k: number, i: number, j: number): number {
  const dx = xy[2 * j] - xy[2 * i];
  const dy = xy[2 * j + 1] - xy[2 * i + 1];
  return Math.abs(dx * (xy[2 * k + 1] - xy[2 * i + 1]) - dy * (xy[2 * k] - xy[2 * i])) / Math.hypot(dx, dy);
}

/** Whether all the points off the line through i and j coincide, within the tolerance. */
function allButOneOnLine(xy: Float64Array, i: number, j: number, tolerance: number): boolean {
  let off = -1;
  for (let k = 0; k < xy.length / 2; k++) {
    if (lineDistance(xy, k, i, j) <= tolerance) continue;
    if (off < 0) off = k;
    else if (distance(xy, k, off) > tolerance) return false;
  }
  return true;
}

// ---------------------------------------------------------------------------------------------
// Homography and the first pose

/** Hartley normalisation [scale, mean x, mean y]: (p − mean) · scale has an RMS distance of √2 from 0. */
function hartley(xy: Float64Array): [number, number, number] {
  const n = xy.length / 2;
  let mx = 0;
  let my = 0;
  for (let k = 0; k < n; k++) {
    mx += xy[2 * k];
    my += xy[2 * k + 1];
  }
  mx /= n;
  my /= n;
  let sum = 0;
  for (let k = 0; k < n; k++) sum += (xy[2 * k] - mx) ** 2 + (xy[2 * k + 1] - my) ** 2;
  return [Math.sqrt((2 * n) / sum), mx, my];
}

/**
 * Normalised DLT: the row-major homography from `src` to `dst` (up to scale and sign) that minimises
 * the algebraic error of the Hartley-normalised points, as the eigenvector of AᵀA with the smallest
 * eigenvalue. The normalisation makes the fit independent of the units of either point set (OQ-63).
 */
function fitHomography(src: Float64Array, dst: Float64Array): Float64Array | null {
  const [s, sx, sy] = hartley(src);
  const [d, dx, dy] = hartley(dst);
  const ata = new Float64Array(81);
  const rows = [new Float64Array(9), new Float64Array(9)];
  for (let k = 0; k < src.length / 2; k++) {
    const x = (src[2 * k] - sx) * s;
    const y = (src[2 * k + 1] - sy) * s;
    const u = (dst[2 * k] - dx) * d;
    const v = (dst[2 * k + 1] - dy) * d;
    rows[0].set([x, y, 1, 0, 0, 0, -u * x, -u * y, -u]);
    rows[1].set([0, 0, 0, x, y, 1, -v * x, -v * y, -v]);
    for (const row of rows) for (let i = 0; i < 9; i++) for (let j = 0; j <= i; j++) ata[9 * i + j] += row[i] * row[j];
  }
  for (let i = 0; i < 9; i++) for (let j = 0; j < i; j++) ata[9 * j + i] = ata[9 * i + j];
  const vectors = jacobiEigen(ata, 9);
  let smallest = 0;
  for (let i = 1; i < 9; i++) if (ata[10 * i] < ata[10 * smallest]) smallest = i;
  // H = T_dst⁻¹ · Hn · T_src with T = [[s, 0, −s · mx], [0, s, −s · my], [0, 0, 1]]
  const H = new Float64Array(9);
  for (let r = 0; r < 3; r++) {
    const h0 = vectors[9 * (3 * r) + smallest] * s;
    const h1 = vectors[9 * (3 * r + 1) + smallest] * s;
    H.set([h0, h1, vectors[9 * (3 * r + 2) + smallest] - h0 * sx - h1 * sy], 3 * r);
  }
  for (let c = 0; c < 3; c++) {
    H[c] = H[c] / d + dx * H[6 + c];
    H[3 + c] = H[3 + c] / d + dy * H[6 + c];
  }
  return H.every(Number.isFinite) ? H : null;
}

/**
 * The pose read off G = μ [r1 r2 t] (§7): |μ| is the mean length of G's first two columns, the sign
 * of μ puts the board in front of the camera, and R is the rotation nearest to [r1 r2 r1 × r2].
 * Null when the board points' depths, all proportional to G's third row applied to (X, Y, 1), differ
 * in sign: the board would straddle the camera's z = 0 plane (OQ-67).
 */
function poseFromHomography(G: Float64Array, object: Float64Array): Pick<Pose, "R" | "t"> | null {
  const n = object.length / 2;
  let positive = 0;
  for (let k = 0; k < n; k++) if (G[6] * object[2 * k] + G[7] * object[2 * k + 1] + G[8] > 0) positive++;
  if (positive !== 0 && positive !== n) return null;
  const scale = (positive === n ? 2 : -2) / (Math.hypot(G[0], G[3], G[6]) + Math.hypot(G[1], G[4], G[7]));
  const r1 = [G[0] * scale, G[3] * scale, G[6] * scale];
  const r2 = [G[1] * scale, G[4] * scale, G[7] * scale];
  const r3 = [r1[1] * r2[2] - r1[2] * r2[1], r1[2] * r2[0] - r1[0] * r2[2], r1[0] * r2[1] - r1[1] * r2[0]];
  // det [r1 r2 r1 × r2] = |r1 × r2|² > 0, so the nearest orthogonal matrix is a rotation
  const R = nearestRotation(Float64Array.of(r1[0], r2[0], r3[0], r1[1], r2[1], r3[1], r1[2], r2[2], r3[2]));
  return R === null ? null : { R, t: Float64Array.of(G[2] * scale, G[5] * scale, G[8] * scale) };
}

// ---------------------------------------------------------------------------------------------
// Small dense linear algebra

/**
 * Eigenvectors of a symmetric n × n matrix by cyclic Jacobi rotations. `a` (row-major) is
 * overwritten and ends up diagonal with the eigenvalues; column k of the result is the unit
 * eigenvector of a[k][k]. An off-diagonal entry too small to change either diagonal entry it couples
 * is set to zero, so the sweeps end with an exactly diagonal matrix.
 */
function jacobiEigen(a: Float64Array, n: number): Float64Array {
  const v = new Float64Array(n * n);
  for (let i = 0; i < n; i++) v[i * (n + 1)] = 1;
  for (let sweep = 0, rotated = true; rotated && sweep < 100; sweep++) {
    rotated = false;
    for (let p = 0; p < n - 1; p++) {
      for (let q = p + 1; q < n; q++) {
        const apq = a[p * n + q];
        const app = a[p * (n + 1)];
        const aqq = a[q * (n + 1)];
        const g = 100 * Math.abs(apq);
        if (Math.abs(app) + g === Math.abs(app) && Math.abs(aqq) + g === Math.abs(aqq)) {
          a[p * n + q] = a[q * n + p] = 0;
          continue;
        }
        // The rotation by φ with cot 2φ = theta zeroes a[p][q]; t = tan φ is the root of
        // t² + 2 theta t − 1 = 0 with |φ| ≤ π / 4
        const theta = (aqq - app) / (2 * apq);
        const t = (theta >= 0 ? 1 : -1) / (Math.abs(theta) + Math.hypot(theta, 1));
        const c = 1 / Math.hypot(t, 1);
        const s = t * c;
        for (let k = 0; k < n; k++) {
          const akp = a[k * n + p];
          const akq = a[k * n + q];
          a[k * n + p] = c * akp - s * akq;
          a[k * n + q] = s * akp + c * akq;
        }
        for (let k = 0; k < n; k++) {
          const apk = a[p * n + k];
          const aqk = a[q * n + k];
          a[p * n + k] = c * apk - s * aqk;
          a[q * n + k] = s * apk + c * aqk;
          const vkp = v[k * n + p];
          const vkq = v[k * n + q];
          v[k * n + p] = c * vkp - s * vkq;
          v[k * n + q] = s * vkp + c * vkq;
        }
        a[p * n + q] = a[q * n + p] = 0;
        rotated = true;
      }
    }
  }
  return v;
}

/** The rotation nearest to M (row-major 3 × 3, det M > 0) in the Frobenius norm, M (MᵀM)^(−1/2). */
function nearestRotation(M: Float64Array): Float64Array | null {
  const S = new Float64Array(9);
  for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) S[3 * r + c] = M[r] * M[c] + M[3 + r] * M[3 + c] + M[6 + r] * M[6 + c];
  const V = jacobiEigen(S, 3);
  const W = new Float64Array(9);
  for (let k = 0; k < 3; k++) {
    if (!(S[4 * k] > 0)) return null;
    const weight = 1 / Math.sqrt(S[4 * k]);
    for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) W[3 * r + c] += weight * V[3 * r + k] * V[3 * c + k];
  }
  return multiply3(M, W);
}

function multiply3(A: Float64Array, B: Float64Array): Float64Array {
  const out = new Float64Array(9);
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 3; c++) out[3 * r + c] = A[3 * r] * B[c] + A[3 * r + 1] * B[3 + c] + A[3 * r + 2] * B[6 + c];
  }
  return out;
}

/** exp([ω]×) by Rodrigues' formula, with sin θ / θ and (1 − cos θ) / θ² kept accurate for small θ. */
function rotationFromVector(wx: number, wy: number, wz: number): Float64Array {
  const theta = Math.hypot(wx, wy, wz);
  const a = theta > 0 ? Math.sin(theta) / theta : 1;
  const half = theta > 0 ? Math.sin(theta / 2) / theta : 0.5;
  const b = 2 * half * half;
  const c = Math.cos(theta);
  return Float64Array.of(
    c + b * wx * wx, b * wx * wy - a * wz, b * wx * wz + a * wy,
    b * wx * wy + a * wz, c + b * wy * wy, b * wy * wz - a * wx,
    b * wx * wz - a * wy, b * wy * wz + a * wx, c + b * wz * wz,
  );
}

/**
 * Solves (A + damping · diag(A)) x = −b by Cholesky for a symmetric 6 × 6 A, of which only the lower
 * triangle is read; null when the matrix is not positive definite.
 */
function solveDamped(A: Float64Array, b: Float64Array, damping: number): Float64Array | null {
  const L = new Float64Array(36);
  for (let i = 0; i < 6; i++) {
    for (let j = 0; j <= i; j++) {
      let sum = i === j ? A[7 * i] * (1 + damping) : A[6 * i + j];
      for (let k = 0; k < j; k++) sum -= L[6 * i + k] * L[6 * j + k];
      if (i !== j) L[6 * i + j] = sum / L[7 * j];
      else if (sum > 0) L[7 * i] = Math.sqrt(sum);
      else return null;
    }
  }
  const x = new Float64Array(6);
  for (let i = 0; i < 6; i++) {
    let sum = -b[i];
    for (let k = 0; k < i; k++) sum -= L[6 * i + k] * x[k];
    x[i] = sum / L[7 * i];
  }
  for (let i = 5; i >= 0; i--) {
    let sum = x[i];
    for (let k = i + 1; k < 6; k++) sum -= L[6 * k + i] * x[k];
    x[i] = sum / L[7 * i];
  }
  return x;
}

// ---------------------------------------------------------------------------------------------
// Refinement

// Levenberg–Marquardt ends when an accepted step turns R by at most STEP_TOLERANCE rad about every
// axis and moves t by at most STEP_TOLERANCE · |t|, or when no step lowers the cost even with
// MAX_DAMPING. Exact data ends on the first; with noise the gains soon fall to the rounding of the
// cost, steps get rejected and the damping rises until one of the two holds, which leaves the pose
// within about 1e−8 rad of the minimum along the flattest direction of a frontal view.
const STEP_TOLERANCE = 1e-12;
const MAX_DAMPING = 1e8;
// A safety net only: board data converges within about ten steps
const MAX_ITERATIONS = 100;

/**
 * Levenberg–Marquardt on the pixel reprojection error over (ω, t), where R ← exp([ω]×) · R turns the
 * board about the camera axes. Only steps that lower the cost and keep the board and its origin in
 * front of the camera are taken, so the result is never worse than the pose from the homography.
 */
function refinePose(start: Pick<Pose, "R" | "t">, object: Float64Array, image: Float64Array, K: Intrinsics): Pose | null {
  let { R, t } = start;
  let cost = reprojectionCost(R, t, object, image, K);
  if (cost === Infinity) return null; // the first pose leaves a board point behind the camera
  let damping = 1e-3;
  for (let iteration = 0; iteration < MAX_ITERATIONS; iteration++) {
    const [JtJ, Jtr] = normalEquations(R, t, object, image, K);
    let step: Float64Array | null = null;
    for (; step === null && damping <= MAX_DAMPING; damping *= 10) {
      const delta = solveDamped(JtJ, Jtr, damping);
      if (delta === null) continue;
      const nextR = multiply3(rotationFromVector(delta[0], delta[1], delta[2]), R);
      const nextT = Float64Array.of(t[0] + delta[3], t[1] + delta[4], t[2] + delta[5]);
      const nextCost = reprojectionCost(nextR, nextT, object, image, K);
      if (nextCost < cost) {
        R = nextR;
        t = nextT;
        cost = nextCost;
        step = delta;
        damping /= 100; // with the loop's × 10, a success relaxes the damping tenfold
      }
    }
    if (step === null) break;
    damping = Math.max(damping, 1e-9);
    const turn = Math.max(Math.abs(step[0]), Math.abs(step[1]), Math.abs(step[2]));
    const move = Math.max(Math.abs(step[3]), Math.abs(step[4]), Math.abs(step[5]));
    if (turn <= STEP_TOLERANCE && move <= STEP_TOLERANCE * Math.hypot(t[0], t[1], t[2])) break;
  }
  return { R, t, rms: Math.sqrt(cost / (object.length / 2)) };
}

/**
 * Sum over the points of the squared pixel distance between the image point and K (R · (X, Y, 0) + t);
 * Infinity when a board point or the board origin is not in front of the camera.
 */
function reprojectionCost(R: Float64Array, t: Float64Array, object: Float64Array, image: Float64Array, K: Intrinsics): number {
  if (!(t[2] > 0)) return Infinity;
  let sum = 0;
  for (let k = 0; k < object.length / 2; k++) {
    const X = object[2 * k];
    const Y = object[2 * k + 1];
    const z = R[6] * X + R[7] * Y + t[2];
    if (!(z > 0)) return Infinity;
    const du = K.fx * ((R[0] * X + R[1] * Y + t[0]) / z) + K.cx - image[2 * k];
    const dv = K.fy * ((R[3] * X + R[4] * Y + t[1]) / z) + K.cy - image[2 * k + 1];
    sum += du * du + dv * dv;
  }
  return sum;
}

/** JᵀJ (6 × 6, lower triangle) and Jᵀr for the residuals r = projection − image and the parameters (ω, t). */
function normalEquations(
  R: Float64Array,
  t: Float64Array,
  object: Float64Array,
  image: Float64Array,
  K: Intrinsics,
): [Float64Array, Float64Array] {
  const JtJ = new Float64Array(36);
  const Jtr = new Float64Array(6);
  const J = new Float64Array(6);
  const add = (residual: number): void => {
    for (let i = 0; i < 6; i++) {
      Jtr[i] += J[i] * residual;
      for (let j = 0; j <= i; j++) JtJ[6 * i + j] += J[i] * J[j];
    }
  };
  for (let k = 0; k < object.length / 2; k++) {
    const X = object[2 * k];
    const Y = object[2 * k + 1];
    // The camera point is p = q + t with q = R · (X, Y, 0), and turning by ω moves it by ω × q, so a
    // pixel coordinate with gradient d with respect to p has gradient q × d with respect to ω
    const q0 = R[0] * X + R[1] * Y;
    const q1 = R[3] * X + R[4] * Y;
    const q2 = R[6] * X + R[7] * Y;
    const x = q0 + t[0];
    const y = q1 + t[1];
    const iz = 1 / (q2 + t[2]);
    const ux = K.fx * iz; // u = fx · x / z + cx: d = (ux, 0, uz)
    const uz = -K.fx * x * iz * iz;
    J.set([q1 * uz, q2 * ux - q0 * uz, -q1 * ux, ux, 0, uz]);
    add(K.fx * x * iz + K.cx - image[2 * k]);
    const vy = K.fy * iz; // v = fy · y / z + cy: d = (0, vy, vz)
    const vz = -K.fy * y * iz * iz;
    J.set([q1 * vz - q2 * vy, -q0 * vz, q0 * vy, 0, vy, vz]);
    add(K.fy * y * iz + K.cy - image[2 * k + 1]);
  }
  return [JtJ, Jtr];
}

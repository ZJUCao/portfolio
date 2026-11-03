// Small dense linear algebra for the camera AR tests: 3-vectors, row-major 3 × 3 matrices,
// rotations and a symmetric eigen-solver. Written independently of src/ so reference maths in the
// tests cannot share a bug with the code under test.

export type Vec3 = readonly [number, number, number];
/** Row-major 3 × 3 matrix: entry (r, c) at index 3r + c. */
export type Mat3 = readonly number[];

export const IDENTITY3: Mat3 = [1, 0, 0, 0, 1, 0, 0, 0, 1];

export function add3(a: Vec3, b: Vec3): [number, number, number] {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
}

export function sub3(a: Vec3, b: Vec3): [number, number, number] {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

export function scale3(a: Vec3, s: number): [number, number, number] {
  return [a[0] * s, a[1] * s, a[2] * s];
}

export function dot3(a: Vec3, b: Vec3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

export function cross3(a: Vec3, b: Vec3): [number, number, number] {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}

export function norm3(a: Vec3): number {
  return Math.hypot(a[0], a[1], a[2]);
}

export function normalize3(a: Vec3): [number, number, number] {
  const length = norm3(a);
  return [a[0] / length, a[1] / length, a[2] / length];
}

export function mul3(a: Mat3, b: Mat3): number[] {
  const out = new Array<number>(9).fill(0);
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 3; c++) {
      let sum = 0;
      for (let k = 0; k < 3; k++) sum += a[3 * r + k] * b[3 * k + c];
      out[3 * r + c] = sum;
    }
  }
  return out;
}

export function transpose3(a: Mat3): number[] {
  return [a[0], a[3], a[6], a[1], a[4], a[7], a[2], a[5], a[8]];
}

export function det3(a: Mat3): number {
  return a[0] * (a[4] * a[8] - a[5] * a[7]) - a[1] * (a[3] * a[8] - a[5] * a[6]) + a[2] * (a[3] * a[7] - a[4] * a[6]);
}

export function inverse3(a: Mat3): number[] {
  const d = det3(a);
  if (!Number.isFinite(d) || d === 0) throw new Error("inverse3: singular matrix");
  return [
    (a[4] * a[8] - a[5] * a[7]) / d,
    (a[2] * a[7] - a[1] * a[8]) / d,
    (a[1] * a[5] - a[2] * a[4]) / d,
    (a[5] * a[6] - a[3] * a[8]) / d,
    (a[0] * a[8] - a[2] * a[6]) / d,
    (a[2] * a[3] - a[0] * a[5]) / d,
    (a[3] * a[7] - a[4] * a[6]) / d,
    (a[1] * a[6] - a[0] * a[7]) / d,
    (a[0] * a[4] - a[1] * a[3]) / d,
  ];
}

export function apply3(a: Mat3, v: Vec3): [number, number, number] {
  return [
    a[0] * v[0] + a[1] * v[1] + a[2] * v[2],
    a[3] * v[0] + a[4] * v[1] + a[5] * v[2],
    a[6] * v[0] + a[7] * v[1] + a[8] * v[2],
  ];
}

/** Maps (x, y) through a homography: returns the dehomogenised point and the homogeneous weight w. */
export function applyHomography(h: Mat3, x: number, y: number): [number, number, number] {
  const w = h[6] * x + h[7] * y + h[8];
  return [(h[0] * x + h[1] * y + h[2]) / w, (h[3] * x + h[4] * y + h[5]) / w, w];
}

/** Rotation by `angle` radians about `axis` (Rodrigues' formula). */
export function rodrigues(axis: Vec3, angle: number): number[] {
  const [x, y, z] = normalize3(axis);
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  const v = 1 - c;
  return [
    c + x * x * v, x * y * v - z * s, x * z * v + y * s,
    y * x * v + z * s, c + y * y * v, y * z * v - x * s,
    z * x * v - y * s, z * y * v + x * s, c + z * z * v,
  ];
}

/**
 * Angle in radians of the rotation a · bᵀ. Uses atan2 of the skew and symmetric parts, which stays
 * accurate near 1e−6 rad where acos of the trace loses precision.
 */
export function rotationAngle(a: Mat3, b: Mat3): number {
  const m = mul3(a, transpose3(b));
  const s = Math.hypot(m[7] - m[5], m[2] - m[6], m[3] - m[1]) / 2;
  const c = (m[0] + m[4] + m[8] - 1) / 2;
  return Math.atan2(s, c);
}

/**
 * Eigen-decomposition of a symmetric matrix by cyclic Jacobi rotations.
 * `vectors[k]` is the unit eigenvector of `values[k]`.
 */
export function jacobiEigenSymmetric(matrix: readonly (readonly number[])[]): { values: number[]; vectors: number[][] } {
  const n = matrix.length;
  const a = matrix.map((row) => [...row]);
  const v: number[][] = a.map((_, i) => a.map((__, j) => (i === j ? 1 : 0)));
  for (let sweep = 0; sweep < 100; sweep++) {
    let off = 0;
    for (let p = 0; p < n; p++) for (let q = p + 1; q < n; q++) off += a[p][q] * a[p][q];
    if (off < 1e-30) break;
    for (let p = 0; p < n; p++) {
      for (let q = p + 1; q < n; q++) {
        if (Math.abs(a[p][q]) < 1e-300) continue;
        const theta = (a[q][q] - a[p][p]) / (2 * a[p][q]);
        const t = Math.sign(theta || 1) / (Math.abs(theta) + Math.sqrt(theta * theta + 1));
        const c = 1 / Math.sqrt(t * t + 1);
        const s = t * c;
        for (let k = 0; k < n; k++) {
          const akp = a[k][p];
          const akq = a[k][q];
          a[k][p] = c * akp - s * akq;
          a[k][q] = s * akp + c * akq;
        }
        for (let k = 0; k < n; k++) {
          const apk = a[p][k];
          const aqk = a[q][k];
          a[p][k] = c * apk - s * aqk;
          a[q][k] = s * apk + c * aqk;
        }
        for (let k = 0; k < n; k++) {
          const vkp = v[k][p];
          const vkq = v[k][q];
          v[k][p] = c * vkp - s * vkq;
          v[k][q] = s * vkp + c * vkq;
        }
      }
    }
  }
  return { values: a.map((row, i) => row[i]), vectors: a.map((_, k) => v.map((row) => row[k])) };
}

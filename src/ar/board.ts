// Geometry of the 10×7-square calibration board (9×6 inner corners) shared by the hero scene and
// the camera AR tracker. Contract: docs/design_camera_ar.md §5.1.
//
// Square (r, c) is dark when r + c is even, so square (0, 0) is dark. Inner corner (i, j) is the
// common vertex of squares (j, i), (j, i + 1), (j + 1, i) and (j + 1, i + 1).

export const BOARD = Object.freeze({
  /** Squares along the long side. */
  squaresX: 10,
  /** Squares along the short side. */
  squaresY: 7,
  /** Inner corners along the long side. */
  cornersX: 9,
  /** Inner corners along the short side. */
  cornersY: 6,
  /** Scene units per square; the hero scene draws the board at this size. */
  squareSize: 0.24,
  /** Printed size of one square, in metres. */
  squareMeters: 0.025,
} as const);

/**
 * Board-plane coordinates of every inner corner, in detector order.
 *
 * Corner k = j * cornersX + i is stored at [2k, 2k + 1] as X = (i + 1 - squaresX / 2) * squareSize
 * and Y = (j + 1 - squaresY / 2) * squareSize, so the corners are centred on the board.
 *
 * @returns A new array of length 2 * cornersX * cornersY.
 */
export function boardCorners(): Float64Array {
  const { cornersX, cornersY, squaresX, squaresY, squareSize } = BOARD;
  const out = new Float64Array(2 * cornersX * cornersY);
  for (let j = 0; j < cornersY; j++) {
    for (let i = 0; i < cornersX; i++) {
      const k = j * cornersX + i;
      out[2 * k] = (i + 1 - squaresX / 2) * squareSize;
      out[2 * k + 1] = (j + 1 - squaresY / 2) * squareSize;
    }
  }
  return out;
}

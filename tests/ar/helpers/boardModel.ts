// Board geometry for the tests, written from docs/design_camera_ar.md §5.1 independently of
// src/ar/board.ts, so a bug there cannot leak into the ground truth (P1-BRD-06 checks the two agree).
//
// A board has cornersX × cornersY inner corners and (cornersX + 1) × (cornersY + 1) squares of side
// `square`, centred at the origin. Square (r, c) is dark iff r + c is even. Inner corner (i, j) is the
// common vertex of squares (j, i), (j, i + 1), (j + 1, i) and (j + 1, i + 1).

export interface BoardSpec {
  readonly cornersX: number;
  readonly cornersY: number;
  /** Board units per square. */
  readonly square: number;
}

export const STANDARD_BOARD: BoardSpec = Object.freeze({ cornersX: 9, cornersY: 6, square: 0.24 });

export const squaresX = (board: BoardSpec): number => board.cornersX + 1;
export const squaresY = (board: BoardSpec): number => board.cornersY + 1;

/** Half the size of the squared area (margin excluded), in board units. */
export function halfExtent(board: BoardSpec): [number, number] {
  return [(squaresX(board) * board.square) / 2, (squaresY(board) * board.square) / 2];
}

/** Board-plane position of inner corner (i, j). */
export function cornerXY(board: BoardSpec, i: number, j: number): [number, number] {
  return [(i + 1 - squaresX(board) / 2) * board.square, (j + 1 - squaresY(board) / 2) * board.square];
}

/** Every inner corner in the board's own labelling: corner k = j · cornersX + i at [2k, 2k + 1]. */
export function cornerGrid(board: BoardSpec): Float64Array {
  const out = new Float64Array(2 * board.cornersX * board.cornersY);
  for (let j = 0; j < board.cornersY; j++) {
    for (let i = 0; i < board.cornersX; i++) {
      const [x, y] = cornerXY(board, i, j);
      out[2 * (j * board.cornersX + i)] = x;
      out[2 * (j * board.cornersX + i) + 1] = y;
    }
  }
  return out;
}

export const isDarkSquare = (r: number, c: number): boolean => (r + c) % 2 === 0;

/** Square (r, c) containing a board-plane point, or null outside the squared area. */
export function squareAt(board: BoardSpec, x: number, y: number): [number, number] | null {
  const c = Math.floor(x / board.square + squaresX(board) / 2);
  const r = Math.floor(y / board.square + squaresY(board) / 2);
  if (c < 0 || c >= squaresX(board) || r < 0 || r >= squaresY(board)) return null;
  return [r, c];
}

/** Board-plane centre of square (r, c). */
export function squareCentre(board: BoardSpec, r: number, c: number): [number, number] {
  return [(c + 0.5 - squaresX(board) / 2) * board.square, (r + 0.5 - squaresY(board) / 2) * board.square];
}

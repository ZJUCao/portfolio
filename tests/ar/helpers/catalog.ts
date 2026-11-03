// The scenes the P1 detector tests use (docs/test_plan_camera_ar.md §3.3). Each item says what
// its test needs from it; helper self-test H-11 checks that from the geometry alone, without
// calling the detector, so a fixture mistake cannot masquerade as a detector failure.

import { type BoardSpec, STANDARD_BOARD, cornerXY } from "./boardModel";
import { createRng, seedFor } from "./random";
import { type Background, type Mapping, type Render, type RenderOptions, type SceneGeometry, type SceneMeta, type Shape, describeScene, render } from "./render";
import {
  type Look,
  type MotionKind,
  type PlaceOptions,
  type SampleRanges,
  type Scene,
  clutter,
  intrinsicsFor,
  makeScene,
  moveScene,
  nominalScene,
  sampleScene,
  shiftInSquares,
} from "./scenes";

export type Request = readonly [number, number];

export interface CatalogItem {
  readonly label: string;
  readonly options: RenderOptions;
  readonly request: Request;
  /** Returns a problem description when the scene is not what its test needs. */
  readonly check: (geometry: SceneGeometry) => string | null;
  readonly scene?: Scene;
}

type Check = CatalogItem["check"];

const renders = new Map<string, Render>();

/** Draws a catalogue scene once per test file. */
export function renderItem(entry: CatalogItem): Render {
  let out = renders.get(entry.label);
  if (!out) {
    out = render(entry.options);
    renders.set(entry.label, out);
  }
  return out;
}

function memo<T>(build: () => T): () => T {
  let value: T | undefined;
  return () => (value ??= build());
}

function item(label: string, options: RenderOptions, check: Check, request: Request = [9, 6], scene?: Scene): CatalogItem {
  return { label, options, request, check, scene };
}

function fromScene(scene: Scene, check: Check, request: Request = [9, 6]): CatalogItem {
  return item(scene.label, scene.options, check, request, scene);
}

// ---------------------------------------------------------------------------------------------
// Checks

const nominal: Check = (g) => (g.meta.nominal ? null : `not nominal: ${g.meta.violations.join(", ")}`);
const hasBoard: Check = (g) => (g.board ? null : "the scene has no board");
const noBoard: Check = (g) => (g.board === null ? null : "the scene has a board");
const otherSize =
  (request: Request): Check =>
  (g) => {
    if (!g.board) return "the scene has no board";
    const { cornersX, cornersY } = g.board;
    const same = (cornersX === request[0] && cornersY === request[1]) || (cornersX === request[1] && cornersY === request[0]);
    return same ? `the ${cornersX}×${cornersY} board matches the request` : null;
  };
const cornerOutside =
  (minPx: number): Check =>
  (g) =>
    g.meta.minCornerBorderPx <= -minPx ? null : `no inner corner is ${minPx} px outside (closest ${g.meta.minCornerBorderPx.toFixed(2)})`;
const nearBorder =
  (lo: number, hi: number): Check =>
  (g) => {
    const d = g.meta.minCornerBorderPx;
    if (d < lo || d > hi) return `closest corner at ${d.toFixed(3)} px, wanted ${lo}…${hi}`;
    return g.meta.marginInside ? "the outer squares are not cut by the border" : null;
  };
const cutInside =
  (minPx: number): Check =>
  (g) => {
    if (g.meta.minCornerBorderPx < minPx) return `a corner is only ${g.meta.minCornerBorderPx.toFixed(2)} px inside`;
    return g.meta.marginInside ? "the outer squares are not cut by the border" : null;
  };
const violates =
  (intended: string, allowed: readonly string[] = []): Check =>
  (g) => {
    const v = g.meta.violations;
    if (!v.includes(intended)) return `does not violate "${intended}" (violations: ${v.join(", ") || "none"})`;
    const stray = v.filter((name) => name !== intended && !allowed.includes(name));
    if (stray.length > 0) return `also violates ${stray.join(", ")}`;
    return g.meta.marginInside ? null : "the board is not inside the image";
  };
const all =
  (...checks: Check[]): Check =>
  (g) => {
    for (const check of checks) {
      const problem = check(g);
      if (problem) return problem;
    }
    return null;
  };

// ---------------------------------------------------------------------------------------------
// Building blocks

export const BASE_LOOK: Look = { dark: 40, light: 200, marginSquares: 0.5, background: 128, blurSigma: 0.6, noiseSigma: 2 };
export const S0_PLACE: PlaceOptions = { width: 640, height: 360, tiltDeg: 15, tiltAxisDeg: 30, inPlaneDeg: 10, minEdgePx: 22 };

/** A fronto-parallel board (normal along the optical axis) with square edges of exactly edgePx. */
function exactPlace(width: number, height: number, edgePx: number, centre: readonly [number, number], board: BoardSpec = STANDARD_BOARD, inPlaneDeg = 0): PlaceOptions {
  const f = intrinsicsFor(width, height).fx;
  return { width, height, board, normalRef: "axis", tiltDeg: 0, inPlaneDeg, centre, depth: (f * board.square) / edgePx };
}

const physicalOf = (options: RenderOptions): Float64Array => {
  const geometry = describeScene(options);
  if (!geometry.physical) throw new Error("catalog: the scene has no board");
  return geometry.physical;
};

/** Board-space disc on inner corner (i, j) of the standard board. */
function discOnCorner(i: number, j: number, radiusSquares: number, fill: Shape["fill"]): Shape {
  const [x, y] = cornerXY(STANDARD_BOARD, i, j);
  return { kind: "disc", space: "board", x, y, r: radiusSquares * STANDARD_BOARD.square, fill };
}

// ---------------------------------------------------------------------------------------------
// Positive scenes (P1-DET-06…25)

export const s0Scene = memo(() => makeScene("S0", S0_PLACE, BASE_LOOK));
export const s0 = memo(() => fromScene(s0Scene(), nominal));

export const rotationSweep = memo(() =>
  Array.from({ length: 24 }, (_, k) =>
    fromScene(
      makeScene(`P1-DET-06 in-plane ${15 * k}°`, { width: 640, height: 360, tiltDeg: 20, tiltAxisDeg: 60, inPlaneDeg: 15 * k, minEdgePx: 16 }, { ...BASE_LOOK, blurSigma: 0.8, noiseSigma: 3 }),
      nominal,
    ),
  ),
);

export const rotated180 = memo(() =>
  [180, 175, 185].map((deg) =>
    fromScene(makeScene(`P1-DET-08 in-plane ${deg}°`, { width: 640, height: 360, tiltDeg: 20, tiltAxisDeg: 60, inPlaneDeg: deg, minEdgePx: 16 }, BASE_LOOK), nominal),
  ),
);

export const longSideVertical = memo(() =>
  [
    [640, 360, 90],
    [640, 360, 270],
    [360, 640, 90],
    [360, 640, 270],
  ].map(([width, height, deg]) =>
    fromScene(makeScene(`P1-DET-09 ${width}×${height} in-plane ${deg}°`, { width, height, tiltDeg: 20, tiltAxisDeg: 10, inPlaneDeg: deg, minEdgePx: 16 }, BASE_LOOK), nominal),
  ),
);

export const swappedRequest = memo(() =>
  [0, 37, 90, 143, 200, 300].map((deg) =>
    fromScene(
      makeScene(`P1-DET-10 request 6×9, in-plane ${deg}°`, { width: 640, height: 360, tiltDeg: 25, tiltAxisDeg: 120, inPlaneDeg: deg, minEdgePx: 16 }, BASE_LOOK),
      nominal,
      [6, 9],
    ),
  ),
);

export const nominalSet = memo(() => Array.from({ length: 40 }, (_, k) => fromScene(nominalScene(`P1-DET-12 #${k}`, createRng(seedFor(`P1-DET-12#${k}`))), nominal)));

export const minEdgeScenes = memo(() =>
  [0, 30, 60].map((tilt) =>
    fromScene(
      makeScene(`P1-DET-13 min edge 12.25 px, tilt ${tilt}°`, { width: 640, height: 360, tiltDeg: tilt, tiltAxisDeg: 45, inPlaneDeg: 20, minEdgePx: 12.25 }, { ...BASE_LOOK, blurSigma: 1, noiseSigma: 4 }),
      all(nominal, (g) => (g.meta.minEdgePx >= 12 && g.meta.minEdgePx <= 12.5 ? null : `min edge ${g.meta.minEdgePx}`)),
    ),
  ),
);

export const maxTiltScenes = memo(() =>
  [0, 180, 90, 270, 45, 225].map((axis) =>
    fromScene(
      makeScene(`P1-DET-14 tilt 60°, axis ${axis}°`, { width: 640, height: 360, hfovDeg: 45, tiltDeg: 60, tiltAxisDeg: axis, inPlaneDeg: 0, minEdgePx: 13 }, BASE_LOOK),
      all(nominal, (g) => (Math.abs(g.meta.tiltDeg - 60) < 1e-6 ? null : `tilt ${g.meta.tiltDeg}`)),
    ),
  ),
);

export const maxBlurScenes = memo(() =>
  [12, 30].map((edge) =>
    fromScene(makeScene(`P1-DET-15 blur 1.0, min edge ${edge} px`, { width: 640, height: 360, tiltDeg: 10, tiltAxisDeg: 200, inPlaneDeg: 10, minEdgePx: edge }, { ...BASE_LOOK, blurSigma: 1 }), nominal),
  ),
);

export const maxNoiseScenes = memo(() =>
  Array.from({ length: 5 }, (_, k) =>
    fromScene(nominalScene(`P1-DET-16 #${k}`, createRng(seedFor(`P1-DET-16#${k}`)), { noiseSigma: 4, dark: 88, light: 168, gainAmplitude: null }), nominal),
  ),
);

export const minContrastScenes = memo(() =>
  [
    [88, 168],
    [10, 90],
    [150, 230],
  ].map(([dark, light]) => fromScene(makeScene(`P1-DET-17 levels ${dark}/${light}`, S0_PLACE, { ...BASE_LOOK, dark, light }), nominal)),
);

export const gradientScenes = memo(() =>
  [
    [0, 0.25],
    [45, -0.25],
    [90, 0.25],
    [135, -0.25],
  ].map(([angleDeg, amplitude]) =>
    fromScene(
      makeScene(`P1-DET-18 gain ${amplitude} along ${angleDeg}°`, S0_PLACE, { ...BASE_LOOK, dark: 40, light: 152, gain: { amplitude, angleDeg } }),
      all(nominal, (g) => (g.meta.contrastMin >= 80 ? null : `contrast ${g.meta.contrastMin}`)),
    ),
  ),
);

export const tightFramingScenes = memo(() => {
  const backgrounds = ["dark background", "clutter"] as const;
  const frames: [string, PlaceOptions][] = [
    ["1 side", exactPlace(640, 360, 20, [639.49 - 5.25 * 20, 179.5])],
    ["2 sides", exactPlace(640, 360, 20, [639.49 - 5.25 * 20, 359.49 - 3.75 * 20])],
    ["4 sides", exactPlace(420, 300, 39.99, [209.5, 149.5])],
  ];
  return frames.flatMap(([frame, place]) =>
    backgrounds.map((name) => {
      const background = name === "clutter" ? clutter(createRng(seedFor(`P1-DET-19 ${frame}`)), "rects", place.width, place.height) : 20;
      const look = { ...BASE_LOOK, marginSquares: 0.25, background };
      return fromScene(makeScene(`P1-DET-19 margin 0.25 touching ${frame}, ${name}`, place, look), nominal);
    }),
  );
});

export const clutterScenes = memo(() =>
  (["rects", "text", "graph", "rects", "text"] as const).map((kind, k) =>
    fromScene(nominalScene(`P1-DET-20 ${kind} #${k}`, createRng(seedFor(`P1-DET-20#${k}`)), { background: clutter(createRng(seedFor(`P1-DET-20 bg#${k}`)), kind, 640, 360) }), nominal),
  ),
);

export const allLimitScenes = memo(() =>
  Array.from({ length: 4 }, (_, k) =>
    fromScene(
      nominalScene(`P1-DET-21 #${k}`, createRng(seedFor(`P1-DET-21#${k}`)), {
        minEdgePx: 12,
        tiltDeg: 60,
        blurSigma: 1,
        noiseSigma: 4,
        dark: 40,
        light: 147,
        gainAmplitude: k % 2 === 0 ? 0.25 : -0.25,
        marginSquares: 0.25,
        background: "clutter",
      }),
      all(nominal, (g) => (g.meta.contrastMin < 81 ? null : `contrast ${g.meta.contrastMin} is not at the limit`)),
    ),
  ),
);

export const largeSquareScenes = memo(() => [
  fromScene(makeScene("P1-DET-22 640×360, 45 px squares", exactPlace(640, 360, 45, [319.5, 179.5]), BASE_LOOK), nominal),
  fromScene(makeScene("P1-DET-22 1280×720, 90 px squares", exactPlace(1280, 720, 90, [639.5, 359.5]), BASE_LOOK), nominal),
]);

export const imageShapeScenes = memo(() =>
  [
    [360, 640],
    [320, 240],
    [641, 359],
    [1280, 720],
  ].map(([width, height]) =>
    fromScene(nominalScene(`P1-DET-23 ${width}×${height}`, createRng(seedFor(`P1-DET-23 ${width}x${height}`)), { width, height, minEdgePx: [12, 24] }), nominal),
  ),
);

export const pixelCentreScenes = memo(() =>
  [
    ["integer", 320],
    ["half-integer", 320.5],
  ].map(([name, c]) => {
    const centre = c as number;
    return fromScene(
      makeScene(`P1-DET-24 corners on ${name} pixels`, exactPlace(640, 360, 24, [centre, centre - 140]), { ...BASE_LOOK, blurSigma: 0, noiseSigma: 0 }),
      all(nominal, (g) => {
        const offset = centre % 1; // 0 for integer corners, 0.5 for half-integer ones
        const off = Array.from(g.physical ?? []).some((value) => Math.abs(value - offset - Math.round(value - offset)) > 1e-9);
        return off ? "corners are not on the intended pixel grid" : null;
      }),
    );
  }),
);

// ---------------------------------------------------------------------------------------------
// Rejection (P1-DET-26…35)

export const noBoardScenes = memo(() => {
  const plain = (label: string, background: Background): CatalogItem => item(label, { width: 640, height: 360, board: null, background, seed: seedFor(label) }, noBoard);
  return [
    plain("P1-DET-26 uniform 0", 0),
    plain("P1-DET-26 uniform 128", 128),
    plain("P1-DET-26 uniform 255", 255),
    ...[1, 2, 3].map((k) => plain(`P1-DET-26 noise σ 40 #${k}`, { kind: "noise", mean: 128, sigma: 40 })),
    plain("P1-DET-26 linear gradient", { kind: "linear", from: 20, to: 235, angleDeg: 30 }),
    plain("P1-DET-26 radial gradient", { kind: "radial", inner: 230, outer: 30 }),
    ...[1, 2, 3, 4, 5].map((k) => plain(`P1-DET-26 random rectangles #${k}`, clutter(createRng(seedFor(`P1-DET-26 rects#${k}`)), "rects", 640, 360))),
    ...[1, 2, 3].map((k) => plain(`P1-DET-26 text-like texture #${k}`, clutter(createRng(seedFor(`P1-DET-26 text#${k}`)), "text", 640, 360))),
    plain("P1-DET-26 graph paper", clutter(createRng(seedFor("P1-DET-26 graph")), "graph", 640, 360)),
    plain("P1-DET-26 9×6 dot grid", clutter(createRng(seedFor("P1-DET-26 dots")), "dots", 640, 360)),
    fromScene(makeScene("P1-DET-26 single 2×2 checker", exactPlace(640, 360, 40, [319.5, 179.5], { cornersX: 1, cornersY: 1, square: 0.24 }), BASE_LOOK), otherSize([9, 6])),
  ];
});

export const outsideScenes = memo(() => {
  const rightColumn = exactPlace(640, 360, 20, [639.5 + 10 - 80, 179.5]);
  // Rotate by −35° so corner 53 is the rightmost corner, then shift it 5 px past the right border
  const rotatedAt = exactPlace(640, 360, 18, [319.5, 179.5], STANDARD_BOARD, -35);
  const u53 = physicalOf(makeScene("probe", rotatedAt, BASE_LOOK).options)[2 * 53];
  const onlyCorner53 = { ...rotatedAt, centre: [319.5 + (639.5 + 5 - u53), 179.5] as const };
  const corner0 = exactPlace(640, 360, 20, [-0.5 - 5 + 80, -0.5 - 5 + 50]);
  const huge = exactPlace(640, 360, 192, [319.5, 179.5]);
  return [
    fromScene(makeScene("P1-DET-27 last column 0.5 square past the right border", rightColumn, BASE_LOOK), cornerOutside(4)),
    fromScene(
      makeScene("P1-DET-27 only corner 53 outside", onlyCorner53, BASE_LOOK),
      all(cornerOutside(4), (g) => {
        const outside = Array.from(g.meta.cornerBorderPx).filter((d) => d < 0).length;
        return outside === 1 && g.meta.cornerBorderPx[53] <= -4 ? null : `${outside} corners outside`;
      }),
    ),
    fromScene(makeScene("P1-DET-27 corner 0 outside the top left", corner0, BASE_LOOK), all(cornerOutside(4), (g) => (g.meta.cornerBorderPx[0] <= -4 ? null : "corner 0 is not outside"))),
    fromScene(makeScene("P1-DET-27 board 3× larger than the frame", huge, BASE_LOOK), cornerOutside(4)),
  ];
});

const OCCLUDED_CORNERS: readonly (readonly [number, number])[] = [
  [4, 3],
  [0, 0],
  [8, 5],
  [0, 3],
];
const OCCLUDER_FILLS: readonly Shape["fill"][] = [40, 200, 128, "texture"];

export const occludedScenes = memo(() => [
  ...OCCLUDED_CORNERS.flatMap(([i, j]) =>
    OCCLUDER_FILLS.map((fill) =>
      fromScene(makeScene(`P1-DET-28 disc r 0.4 on corner (${i}, ${j}), fill ${fill}`, S0_PLACE, { ...BASE_LOOK, occluders: [discOnCorner(i, j, 0.4, fill)] }), violates("occluded")),
    ),
  ),
  fromScene(
    makeScene("P1-DET-28 bar over corner row 3", S0_PLACE, {
      ...BASE_LOOK,
      occluders: [{ kind: "rect", space: "board", x: 0, y: cornerXY(STANDARD_BOARD, 0, 3)[1], w: 2.6, h: 0.16, fill: 128 }],
    }),
    violates("occluded"),
  ),
]);

export const partialOcclusionScenes = memo(() => {
  const s0Corners = physicalOf(s0Scene().options);
  const k = 3 * 9 + 4;
  return [
    fromScene(
      makeScene("P1-DET-29 1 px disc on corner (4, 3)", S0_PLACE, { ...BASE_LOOK, occluders: [{ kind: "disc", space: "image", x: s0Corners[2 * k], y: s0Corners[2 * k + 1], r: 1, fill: 128 }] }),
      violates("occluded"),
    ),
    fromScene(
      makeScene("P1-DET-29 finger over outer square (0, 4), no corner covered", S0_PLACE, {
        ...BASE_LOOK,
        occluders: [
          {
            kind: "polygon",
            space: "board",
            points: [
              [-0.2, -0.82],
              [-0.04, -0.82],
              [-0.04, -0.75],
              [-0.2, -0.75],
            ],
            fill: 150,
          },
        ],
      }),
      violates("occluded"),
    ),
  ];
});

const sizedPlace = (board: BoardSpec): PlaceOptions => ({ ...S0_PLACE, board, minEdgePx: 16 });

export const largerLatticeScenes = memo(() =>
  [
    { cornersX: 10, cornersY: 7, square: 0.24 },
    { cornersX: 9, cornersY: 7, square: 0.24 },
    { cornersX: 10, cornersY: 6, square: 0.24 },
  ].map((board) => fromScene(makeScene(`P1-DET-30 ${board.cornersX}×${board.cornersY} inner corners`, sizedPlace(board), BASE_LOOK), all(nominal, otherSize([9, 6])))),
);

export const smallerLatticeScenes = memo(() =>
  [
    { cornersX: 8, cornersY: 5, square: 0.24 },
    { cornersX: 8, cornersY: 6, square: 0.24 },
    { cornersX: 9, cornersY: 5, square: 0.24 },
  ].map((board) => fromScene(makeScene(`P1-DET-31 ${board.cornersX}×${board.cornersY} inner corners`, sizedPlace(board), BASE_LOOK), all(nominal, otherSize([9, 6])))),
);

export const WRONG_REQUESTS: readonly Request[] = [
  [8, 5],
  [10, 7],
  [9, 4],
  [7, 6],
  [2, 3],
  [4, 3],
];

export const destroyedCornerScenes = memo(() =>
  [
    [3, 4],
    [0, 5],
  ].map(([r, c]) => fromScene(makeScene(`P1-DET-33 square (${r}, ${c}) colour flipped`, S0_PLACE, { ...BASE_LOOK, flippedSquares: [[r, c]] }), violates("flipped"))),
);

export const twoBoardsScene = memo(() => {
  const left = makeScene("P1-DET-34 left board", { width: 640, height: 360, tiltDeg: 10, tiltAxisDeg: 0, inPlaneDeg: 5, minEdgePx: 14, centre: [165, 180] }, BASE_LOOK);
  const right = makeScene("P1-DET-34 right board", { width: 640, height: 360, tiltDeg: 10, tiltAxisDeg: 180, inPlaneDeg: -8, minEdgePx: 14, centre: [475, 180] }, BASE_LOOK);
  const both = item("P1-DET-34 two boards", { ...left.options, extraBoards: [{ board: STANDARD_BOARD, mapping: right.options.mapping as Mapping }] }, violates("extraBoard"));
  return { both, left: fromScene(left, nominal), right: fromScene(right, nominal) };
});

const STRESS_KINDS: readonly { name: string; ranges: SampleRanges; intended: string; allowed?: string[] }[] = [
  { name: "blur 1.5–2.5", ranges: { blurSigma: [1.5, 2.5] }, intended: "blur" },
  { name: "noise 8–16", ranges: { noiseSigma: [8, 16] }, intended: "noise" },
  { name: "tilt 65–80°", ranges: { tiltDeg: [65, 80], minEdgePx: [7, 9] }, intended: "tilt", allowed: ["minEdge"] },
  { name: "squares 7–11 px", ranges: { minEdgePx: [7, 11] }, intended: "minEdge" },
  { name: "contrast 30–79", ranges: { dark: [40, 80], light: [110, 119], gainAmplitude: null }, intended: "contrast" },
  { name: "gain ±0.4–0.6", ranges: { gainAmplitude: [0.4, 0.6], dark: 20, light: 230 }, intended: "gain", allowed: ["contrast"] },
  { name: "5 px motion blur", ranges: { look: { motionBlurPx: 5 } }, intended: "motion" },
  { name: "posterised to 16 levels", ranges: { look: { posterizeLevels: 16 } }, intended: "posterize" },
  { name: "no margin on a dark background", ranges: { marginSquares: 0, background: 20 }, intended: "margin" },
  { name: "glare", ranges: {}, intended: "glare" },
];

export const stressScenes = memo(() =>
  STRESS_KINDS.flatMap((kind) =>
    Array.from({ length: 6 }, (_, k) => {
      const label = `P1-DET-35 ${kind.name} #${k}`;
      const rng = createRng(seedFor(label));
      const accept = (meta: SceneMeta) =>
        meta.marginInside && meta.violations.includes(kind.intended) && meta.violations.every((v) => v === kind.intended || (kind.allowed ?? []).includes(v));
      let scene = sampleScene(label, rng, { ...kind.ranges, gainAmplitude: kind.ranges.gainAmplitude ?? null, look: kind.ranges.look }, (meta) =>
        kind.intended === "glare" ? meta.nominal : accept(meta),
      );
      if (kind.intended === "glare") {
        const corners = physicalOf(scene.options);
        const c = 2 * (2 * 9 + 3);
        scene = makeScene(label, scene.place, { ...scene.look, glare: { x: corners[c] + 4, y: corners[c + 1] + 3, radius: 18, strength: 120 } });
      }
      return fromScene(scene, violates(kind.intended, kind.allowed));
    }),
  ),
);

// ---------------------------------------------------------------------------------------------
// Near the image border (P1-DET-36…38)

type Side = "right" | "left" | "top" | "bottom";
const SIDES: readonly Side[] = ["right", "left", "top", "bottom"];

/** 20 px squares, fronto-parallel; the outermost corner line sits `inside` px inside the given border. */
function borderPlace(side: Side, inside: number): PlaceOptions {
  const half = { x: 4 * 20, y: 2.5 * 20 };
  const centre: [number, number] = {
    right: [639.5 - inside - half.x, 179.5],
    left: [-0.5 + inside + half.x, 179.5],
    top: [319.5, -0.5 + inside + half.y],
    bottom: [319.5, 359.5 - inside - half.y],
  }[side] as [number, number];
  return exactPlace(640, 360, 20, centre);
}

export const nearBorderInsideScenes = memo(() =>
  SIDES.flatMap((side) => [0.6, 2.8].map((d) => fromScene(makeScene(`P1-DET-36 ${side}, corners ${d} px inside`, borderPlace(side, d), BASE_LOOK), nearBorder(0.5, 3)))),
);

export const nearBorderOutsideScenes = memo(() =>
  SIDES.flatMap((side) => [0.6, 2.8].map((d) => fromScene(makeScene(`P1-DET-37 ${side}, corners ${d} px outside`, borderPlace(side, -d), BASE_LOOK), nearBorder(-3, -0.5)))),
);

export const cutInsideScenes = memo(() =>
  SIDES.map((side, k) => {
    const d = [4, 6, 9, 12][k];
    return fromScene(makeScene(`P1-DET-38 ${side}, outer squares cut, corners ${d} px inside`, borderPlace(side, d), BASE_LOOK), cutInside(4));
  }),
);

// ---------------------------------------------------------------------------------------------
// Tracking (P1-DET-39…52) and performance

function movedItem(base: Scene, label: string, kind: MotionKind, direction: number, shiftSquares: number): CatalogItem {
  const scene = moveScene(base, label, kind, direction, shiftSquares);
  const shift = shiftInSquares(base.options, scene.options);
  return fromScene(
    scene,
    all(nominal, () => (shift <= shiftSquares + 1e-9 && shift >= 0.9 * shiftSquares ? null : `moved ${shift.toFixed(4)} squares, wanted ${shiftSquares}`)),
  );
}

export const smallMotions = memo(() => {
  const base = s0Scene();
  return [
    ...[0, 45, 90, 135, 180, 225, 270, 315].map((dir) => movedItem(base, `P1-DET-40 translate ${dir}°`, "translate", dir, 0.25)),
    movedItem(base, "P1-DET-40 rotate", "rotate", 1, 0.25),
    movedItem(base, "P1-DET-40 scale up", "scale", -1, 0.25),
    movedItem(base, "P1-DET-40 scale down", "scale", 1, 0.25),
    movedItem(base, "P1-DET-40 tilt", "tilt", 1, 0.25),
  ];
});

export const trackingSequence = memo(() => {
  const rng = createRng(seedFor("P1-DET-41"));
  const kinds: MotionKind[] = ["translate", "rotate", "translate", "scale", "translate", "tilt"];
  const frames: CatalogItem[] = [fromScene(makeScene("P1-DET-41 frame 0", { ...S0_PLACE, minEdgePx: 18 }, BASE_LOOK), nominal)];
  for (let k = 1; k < 30; k++) {
    const previous = frames[k - 1].scene as Scene;
    const kind = kinds[k % kinds.length];
    const direction = kind === "translate" ? rng.range(0, 360) : rng.next() < 0.5 ? -1 : 1;
    frames.push(movedItem(previous, `P1-DET-41 frame ${k}`, kind, direction, 0.2));
  }
  return frames;
});

export const staleHintScenes = memo(() => {
  const base = s0Scene();
  const edge = describeScene(base.options).meta.minEdgePx;
  const centre = base.place.centre ?? [319.5, 179.5];
  return [
    fromScene(makeScene("P1-DET-42 hint from 2 squares away", { ...base.place, centre: [centre[0] + 2 * edge, centre[1]] }, base.look), nominal),
    fromScene(makeScene("P1-DET-42 hint rotated 30°", { ...base.place, inPlaneDeg: (base.place.inPlaneDeg ?? 0) + 30 }, base.look), nominal),
    // Only its corners are used, as a stale hint, so it need not fit the frame
    fromScene(makeScene("P1-DET-42 hint scaled ×1.5", { ...base.place, minEdgePx: (base.place.minEdgePx ?? 22) * 1.5 }, base.look), hasBoard),
  ];
});

export const oneSquareMotion = memo(() => movedItem(s0Scene(), "P1-DET-51 moved 1 square", "translate", 20, 1));
export const perfHintMotion = memo(() => movedItem(s0Scene(), "P1-PERF-02 moved 0.1 square", "translate", 60, 0.1));

/** Garbage hints of the right length (P1-DET-45). */
export function garbageHints(width: number, height: number): { name: string; hint: Float32Array }[] {
  const n = 108;
  const rng = createRng(seedFor("P1-DET-45 random"));
  const make = (name: string, value: (k: number) => number) => ({ name, hint: Float32Array.from({ length: n }, (_, k) => value(k)) });
  return [
    make("all zero", () => 0),
    make("all NaN", () => NaN),
    make("+Infinity", () => Infinity),
    make("−Infinity", () => -Infinity),
    make("random in-image values", (k) => (k % 2 === 0 ? rng.range(0, width - 1) : rng.range(0, height - 1))),
    make("1e9", () => 1e9),
    make("all corners at one point", (k) => (k % 2 === 0 ? width / 2 : height / 2)),
    make("negative values", (k) => -10 - k),
  ];
}

export const garbageHintScenes = memo(() => [s0(), ...nominalSet().slice(0, 5)]);

export const noBoardPerfScene = memo(() =>
  item("P1-PERF-03 noise and clutter", { width: 640, height: 360, board: null, background: clutter(createRng(seedFor("P1-PERF-03")), "rects", 640, 360), noiseSigma: 12, seed: seedFor("P1-PERF-03") }, noBoard),
);

// ---------------------------------------------------------------------------------------------
// Catalogue check (H-11)

export interface CatalogGroup {
  readonly name: string;
  readonly items: readonly CatalogItem[];
  readonly expectedCount: number;
}

export function catalogGroups(): CatalogGroup[] {
  const two = twoBoardsScene();
  return [
    { name: "S0", items: [s0()], expectedCount: 1 },
    { name: "P1-DET-06 rotations", items: rotationSweep(), expectedCount: 24 },
    { name: "P1-DET-08 180°", items: rotated180(), expectedCount: 3 },
    { name: "P1-DET-09 long side vertical", items: longSideVertical(), expectedCount: 4 },
    { name: "P1-DET-10 swapped request", items: swappedRequest(), expectedCount: 6 },
    { name: "P1-DET-12 nominal set", items: nominalSet(), expectedCount: 40 },
    { name: "P1-DET-13 min edge", items: minEdgeScenes(), expectedCount: 3 },
    { name: "P1-DET-14 max tilt", items: maxTiltScenes(), expectedCount: 6 },
    { name: "P1-DET-15 max blur", items: maxBlurScenes(), expectedCount: 2 },
    { name: "P1-DET-16 max noise", items: maxNoiseScenes(), expectedCount: 5 },
    { name: "P1-DET-17 min contrast", items: minContrastScenes(), expectedCount: 3 },
    { name: "P1-DET-18 gradient", items: gradientScenes(), expectedCount: 4 },
    { name: "P1-DET-19 tight framing", items: tightFramingScenes(), expectedCount: 6 },
    { name: "P1-DET-20 clutter", items: clutterScenes(), expectedCount: 5 },
    { name: "P1-DET-21 all limits", items: allLimitScenes(), expectedCount: 4 },
    { name: "P1-DET-22 large squares", items: largeSquareScenes(), expectedCount: 2 },
    { name: "P1-DET-23 image shapes", items: imageShapeScenes(), expectedCount: 4 },
    { name: "P1-DET-24 pixel centres", items: pixelCentreScenes(), expectedCount: 2 },
    { name: "P1-DET-26 no board", items: noBoardScenes(), expectedCount: 19 },
    { name: "P1-DET-27 corner outside", items: outsideScenes(), expectedCount: 4 },
    { name: "P1-DET-28 occluded", items: occludedScenes(), expectedCount: 17 },
    { name: "P1-DET-29 partial occlusion", items: partialOcclusionScenes(), expectedCount: 2 },
    { name: "P1-DET-30 larger lattice", items: largerLatticeScenes(), expectedCount: 3 },
    { name: "P1-DET-31 smaller lattice", items: smallerLatticeScenes(), expectedCount: 3 },
    { name: "P1-DET-33 destroyed corner", items: destroyedCornerScenes(), expectedCount: 2 },
    { name: "P1-DET-34 two boards", items: [two.both, two.left, two.right], expectedCount: 3 },
    { name: "P1-DET-35 stress", items: stressScenes(), expectedCount: 60 },
    { name: "P1-DET-36 near border, inside", items: nearBorderInsideScenes(), expectedCount: 8 },
    { name: "P1-DET-37 near border, outside", items: nearBorderOutsideScenes(), expectedCount: 8 },
    { name: "P1-DET-38 cut, inside", items: cutInsideScenes(), expectedCount: 4 },
    { name: "P1-DET-40 small motions", items: smallMotions(), expectedCount: 12 },
    { name: "P1-DET-41 sequence", items: trackingSequence(), expectedCount: 30 },
    { name: "P1-DET-42 stale hints", items: staleHintScenes(), expectedCount: 3 },
    { name: "P1-DET-51 one square", items: [oneSquareMotion()], expectedCount: 1 },
    { name: "P1-PERF-02 hint motion", items: [perfHintMotion()], expectedCount: 1 },
    { name: "P1-PERF-03 no board", items: [noBoardPerfScene()], expectedCount: 1 },
  ];
}

/** Problems with the catalogue, or an empty list. */
export function checkCatalog(): string[] {
  const problems: string[] = [];
  for (const group of catalogGroups()) {
    if (group.items.length !== group.expectedCount) problems.push(`${group.name}: ${group.items.length} scenes, expected ${group.expectedCount}`);
    for (const entry of group.items) {
      const problem = entry.check(describeScene(entry.options));
      if (problem) problems.push(`${entry.label}: ${problem}`);
    }
  }
  return problems;
}

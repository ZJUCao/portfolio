# Test plan: Camera AR on a calibration board

Status: **Confirmed on 2026-11-02**; P1 tests written and red against the skeleton (this plan §9) · Design: `docs/design_camera_ar.md` (resolved details in its §14) · Chinese version: `docs/test_plan_camera_ar.zh.md` (kept in sync section by section)

This plan maps the contracts of the design (§5, with the conventions of §6 and the strategy of §9) to test cases, phase by phase (§10 of the design). Decisions D1–D14 are option A. The 60 questions the contract left open are resolved (this plan §10): option A for all except OQ-04, OQ-06, OQ-09, OQ-27 and OQ-47. Section numbers such as "§5.2" refer to the design; "this plan §x" refers to this document.

Cases removed by the resolutions, whose IDs are not reused: P1-DET-11 (OQ-09), P2-PNP-06 (OQ-19), P3-TRK-41 (OQ-47), P3-COPY-01, P3-COPY-02 and P4-COPY-01 (OQ-04), and M3-20 (OQ-03).

## 1. Scope and conventions

### 1.1 Runner and files

- Vitest 4.1.12 with vite 8.3.4. `vitest.config.mts` sets the `node` environment, includes `tests/**/*.test.ts` and aliases `@` to `src`; `npm test` runs `vitest run`. Tests import `describe`, `it` and `expect` from `"vitest"` (no globals). No jsdom or Testing Library: UI and WebGL behaviour is checked manually (this plan §8).
- The dev dependency jpeg-js 0.4.4 decodes the photo fixtures. three.js is imported by a few P2 tests only, to check the matrix element order with `THREE.Matrix4`; its math classes run in Node.

| File | Covers | Phase |
| :--- | :--- | :--- |
| `tests/ar/helpers.test.ts` | Helper self-tests H-01…H-11 | P1 (H-09 in P3, H-10 in P4) |
| `tests/ar/board.test.ts` | P1-BRD | P1 |
| `tests/ar/chessboard.test.ts` | P1-GRY; P1-DET-01…25: validation, layout, ordering, accuracy | P1 |
| `tests/ar/chessboard.reject.test.ts` | P1-DET-26…38: rejection, near the border | P1 |
| `tests/ar/chessboard.tracking.test.ts` | P1-DET-39…57: tracking hint, determinism, immutability | P1 |
| `tests/ar/chessboard.perf.test.ts` | P1-PERF | P1 |
| `tests/ar/fixtures.test.ts` | P1-FIX (real photos, D12) | P1 |
| `tests/ar/pose.test.ts` | P2-INT, P2-PNP, P2-FOC, P2-VM, P2-PM, P2-CP, P2-CHN | P2 |
| `tests/ar/filter.test.ts` | P2-CF, P2-FT | P2 |
| `tests/ar/pipeline.test.ts` | P2-PIP cases on the real modules | P2 |
| `tests/ar/pipeline.spy.test.ts` | P2-PIP cases that spy on or mock `chessboard` / `pose` | P2 |
| `tests/ar/options.test.ts` | P2-OPT | P2 |
| `tests/ar/worker.test.ts` | P2-WRK, P2-WKE | P2 |
| `tests/ar/arch.test.ts` | P2-ARCH, P3-ARCH (OQ-03) | P2, P3 |
| `tests/ar/tracker.test.ts` | P3-TRK | P3 |
| `tests/app/chessboard-pdf.test.ts` | P4-PDF | P4 |

Helpers live in `tests/ar/helpers/`: `random.ts`, `boardModel.ts`, `linalg.ts`, `render.ts`, `scenes.ts`, `catalog.ts` (every P1 scene), `metrics.ts`, `fixtures.ts` (photo loading), and from P3 `cameraFakes.ts`. The PDF reader sits next to its only user, in `tests/app/helpers/pdf.ts`. Real photos and their manifest go to `tests/fixtures/board/`.

Module mocks (`vi.mock`) appear only in `pipeline.spy.test.ts`, and only for calls that §5.4 itself specifies: the detector call with its hint, `estimateFocal` and `solvePlanarPnP`. Everything else goes through the public interfaces.

### 1.2 Terms used in the tables

| Term | Meaning |
| :--- | :--- |
| truth | Ground-truth corners from the renderer (float64), in the canonical O1–O3 order for the requested lattice size (this plan §2.3) |
| accurate | A new `Float32Array` of length 2 · cornersX · cornersY with index-wise RMS error ≤ 0.25 px and maximum error ≤ 0.6 px against truth (§5.2), and O2 and O3 measured on the result. Because truth is in canonical order, this also proves O1–O3 |
| identity-correct | Non-null, right length, and every corner within 0.3 × the local corner spacing of its own true corner: what "not a wrong answer" means outside nominal conditions (OQ-10) |
| null-or-accurate, null-or-identity-correct | Either `null` or a result as defined above |
| nominal | The conditions of §5.2 "Accuracy under nominal conditions", verified by the scene generator (this plan §2.3) |
| S0 | Base positive scene: 640×360, 9×6 board, tilt 15°, in-plane rotation 10°, shortest square edge 22 px, dark 40 / light 200, margin 0.5 square, background 128, blur σ 0.6 px, noise σ 2 |
| min edge | The shortest projected square edge, in px, over all 70 squares |
| tilt | The §5.2 definition: angle between the board normal and the ray to the board centre. For `estimateFocal`, the angle between the board normal and the optical axis (OQ-23) |

### 1.3 Decisions encoded in the tests

D1–D14 are option A.

| Decision | Cases that encode it |
| :--- | :--- |
| D1 focal estimated from the board | P2-FT-*, P2-PIP-09…11, P2-PIP-19, P2-PIP-22 |
| D3 keep the last pose for 0.5 s | P3-TRK-23…26 |
| D4 rear camera, no switch | P3-TRK-05, P3-TRK-06 |
| D8 A4 PDF | P4-PDF-* |
| D12 real-photo fixtures | P1-FIX-* |
| D2, D5, D6, D7, D9, D10, D11, D13, D14 | Manual checklist (this plan §8) |

## 2. Test helpers

### 2.1 Seeded random numbers (`random.ts`)

- `mulberry32(seed)`: a 32-bit integer generator (`Math.imul`, `>>> 0`) that gives the same stream on every platform. On top: `uniform()`, `range(a, b)`, `int(n)`, `gaussian()` (Box–Muller with u₁ ∈ (0, 1]) and `pick()`.
- `seedFor(label)`: FNV-1a hash of a label such as `"P1-DET-12#7"`, so every case owns its stream and adding a case does not shift the others.
- Seeds and trial counts are constants in the test files and the scene catalogue. `Math.random`, `Date.now` and real timers are not used in unit tests.

### 2.2 Independent board model (`boardModel.ts`)

- A generic board of cornersX × cornersY inner corners and (cornersX + 1) × (cornersY + 1) squares of side s (default 0.24), centred at the origin: corner (i, j) at ((i + 1 − (cornersX + 1)/2) · s, (j + 1 − (cornersY + 1)/2) · s); square (r, c) is dark iff r + c is even.
- Written from §5.1 independently of `src/ar/board.ts`, so a bug in `boardCorners()` cannot leak into the ground truth. P1-BRD-06 checks that the two agree.

### 2.3 Synthetic chessboard renderer (`render.ts`)

Inputs: board spec (lattice size, square size, margin width in squares, default 0.5), mapping, image size, grey levels (dark, light, margin = light unless set, background level or generator), and optional illumination gain, glare, occluders, flipped squares, extra boards, motion blur, Gaussian blur σ, noise σ, posterisation and seed.

The mapping from the board plane to the image is either:
- `homography`: a 3 × 3 matrix H (board XY → pixel), used for helper self-tests; or
- `camera`: (K, R, t) with H = K · [r₁ r₂ t], used for every detector scene so that tilt is well defined.

Rendering, per pixel (u, v):
1. Pixel-centre convention of §6: pixel (u, v) covers [u − 0.5, u + 0.5] × [v − 0.5, v + 0.5].
2. 4 × 4 supersampling: 16 samples on a sheared grid with offsets ((4a + b + 0.5)/16 − 0.5, (4b + a + 0.5)/16 − 0.5) for a, b ∈ {0, 1, 2, 3}. Each axis sees 16 distinct offsets, so an axis-aligned edge is quantised to 1/16 px (bias ≤ 1/32 px). A plain 4 × 4 grid quantises to 1/4 px (bias up to 0.125 px), which would spend half of the 0.25 px RMS budget on the fixture itself.
3. Each sample is mapped through H⁻¹. A non-positive homogeneous coordinate means the ray misses the plane (background). Inside the squares the sample is dark or light by the r + c rule (flipped squares invert it); inside the margin it takes the margin level; outside, the background. Occluders (discs, rectangles, polygons; in image or board coordinates; flat or textured) are evaluated per sample, on top.
4. The sample mean gives a linear grey value (no gamma).
5. Illumination gain g(p) = 1 + a · ((p − c) · d) / e, with c the board centre in the image, d a unit direction, e the board's half extent along d, and |a| ≤ 0.25 in nominal scenes. Applied to the whole image.
6. Glare: an additive blob, strength · exp(−d² / 2r²).
7. Horizontal box blur (motion), then separable Gaussian blur with sampled weights, radius ⌈4σ⌉ and clamp-to-edge borders.
8. Additive Gaussian noise of the requested σ from the seeded stream, optional posterisation, then rounding and clamping to [0, 255].

`describeScene(options)` returns the geometry without drawing; `render(options)` adds the image:
- `physical`: float64 corner positions H · (X, Y) in the board's own (i, j) labelling; `H`: board → pixel.
- `truth(cornersX, cornersY)`: the physical corners in the unique order that satisfies O1–O3 for the requested size. The helper tries the lattice symmetries (for a transposed request, the transposed ones) and keeps the one with cross > 0 whose outward square is dark in the board model. For a (9, 6) request on a camera render this is the physical order (H-05); for a (6, 9) request it is T(i′, j′) = physical (j′, 5 − i′).
- `meta`: min edge, tilt, the signed distance of every inner corner to the image border, whether board plus 0.25-square margin are inside the image, the minimum dark/light contrast after the gain, and a `nominal` flag with the names of the violated conditions (`minEdge`, `tilt`, `margin`, `marginLevel`, `inside`, `contrast`, `blur`, `noise`, `gain`, `occluded`, `flipped`, `extraBoard`, `motion`, `posterize`, `glare`).

Cost: a 640×360 frame takes 10–40 ms. Rendering all 305 catalogue scenes takes about 6.5 s.

Note on mirroring: the 10×7 board's colouring is symmetric about its long axis, so a mirrored image of the board is pixel-identical to an unmirrored view, and a 180° rotation equals a colour inversion. Mirrored and colour-inverted boards therefore need no separate cases; P1-DET-08 covers both.

### 2.4 Scene generators and catalogue (`scenes.ts`, `catalog.ts`)

- `placeBoard({ width, height, hfovDeg, inPlaneDeg, tiltDeg, tiltAxisDeg, normalRef, centre, minEdgePx | widthFraction | depth })`: takes the ray d to the requested board centre and tilts the normal by τ from d (`normalRef: "ray"`, the §5.2 tilt) or from the optical axis (`"axis"`, used for exact fronto-parallel placements). R = [X̂ Ŷ n] with X̂ rotated by the in-plane angle and Ŷ = n × X̂. The depth comes from bisection on the requested min edge or width, keeping every board point in front of the camera.
- `sampleScene` / `nominalScene`: sample the §5.2 envelope (in-plane rotation 0–360°, tilt 0–60° about any axis, min edge 12–30 px, blur 0–1.0, noise 0–4, contrast 80–160 after the gain, gain ±0.25 in 60 % of scenes, margin 0.25–1 square, uniform or cluttered background) by bounded, deterministic rejection sampling, and keep the first scene whose `meta` the caller accepts (nominal, or off-nominal for exactly the intended reasons). Contrast stays ≥ 80 at every point after the gain (OQ-12).
- `clutter(rng, kind)`: random rectangles, text-like rows of strokes, graph paper, a 9×6 dot grid.
- `moveScene(scene, kind, direction, shift)`: translation, rotation, scale or tilt change, bisected so that the largest corner displacement equals `shift` × the shortest projected square edge (OQ-15); `shiftInSquares` measures it.
- `catalog.ts` holds every scene of the P1 detector tests as an item with a label, render options, the requested lattice size and a check of what its test needs (nominal; off-nominal for the intended reason only; no board; a corner ≥ 4 px outside; the closest corner within a given band; a moved scene's measured shift). Helper self-test H-11 runs every check from the geometry alone, without calling the detector. `renderItem` draws each item once per test file.

### 2.5 Metrics and assertions (`metrics.ts`, `linalg.ts`)

- `cornerErrors(result, truth)`: per-corner distances, RMS and maximum.
- `expectLayout`, `expectAccurate`, `expectIdentityCorrect` and their `expectNullOr…` forms; `expectAccurate` also runs `expectOrderProperties` (O2 from the cross product at corner 0, O3 from the image).
- `crossAtCorner0(result, cornersX)`; `outwardSquareContrast(image, result)`: fits a homography to the result and compares 5 × 5-sample patch means of the square diagonally outward from corner 0 and its two light neighbours.
- `fitHomography(src, dst)`: normalised DLT (Hartley normalisation, 9 × 9 Jacobi eigen-solver, sign fixed so the source points are in front) and its geometric RMS residual.
- `rotationAngle(Ra, Rb)` = atan2(‖vee(M − Mᵀ)‖ / 2, (tr M − 1) / 2) with M = Ra · Rbᵀ, accurate near 1e−6 rad (for P2).
- `expectRangeError(call)`: passes on a `RangeError` and rethrows any other exception unchanged, so in the Red run a validation case fails with the stub's own "not implemented".
- `bytesOf(view)` copies the bytes behind a typed array for immutability checks; `toFloat32` builds hints.

### 2.6 Fakes for `startCameraAR` (`cameraFakes.ts`, P3)

| Fake | Behaviour |
| :--- | :--- |
| `deferred<T>()` | `{ promise, resolve, reject }`, to settle `getUserMedia` and `play()` at chosen moments |
| `FakeTrack` | `kind`, `readyState` ("live" → "ended"), `stop()` counting its calls |
| `FakeStream` | `getTracks()`, `getVideoTracks()`, `getAudioTracks()` over one or two `FakeTrack`s; passed where a `MediaStream` is expected |
| `fakeMediaDevices()` | `getUserMedia` spy that returns the current deferred and records the constraints |
| `FakeVideo` (`VideoLike`) | Settable `videoWidth` and `videoHeight`; records every `srcObject` assignment; `play()` returns a deferred and records `srcObject` at call time |
| `FakeWorker` (`WorkerLike`) | `postMessage(msg, transfer)` records the message and transfer list, then runs `structuredClone(msg, { transfer })`, so posted buffers are really detached as in a browser. `respond(partial)` builds a `result` reply around the received buffer and delivers it to `onmessage` through another `structuredClone` with transfer, so the tracker receives a new `ArrayBuffer` object as in a browser. `respondError(message)`; `crash(event)` calls `onerror`; `terminate()` counts calls and keeps the last handlers so a test can simulate a late event |
| `createWorker` | Spy that returns a new `FakeWorker` and records every instance |
| `captureFrame` | Spy that checks `out.length === 4 · w · h` and that its buffer is not detached, then fills `out` with a pattern that encodes the frame number |
| `ManualScheduler` (`requestFrame`) | Stores callbacks; `tick()` runs the ones pending at that moment (FIFO; callbacks requested during a tick wait for the next one); the returned cancel function marks the entry cancelled |
| `ManualClock` (`now`) | `set(ms)`, `advance(ms)` |
| `recorder()` | An `onUpdate` that stores every update and applies the invariants of P3-TRK-36 to it |
| `flush()` | Awaits one macrotask so pending promise chains settle |

Tests always pass every dependency, and `startCameraAR` resolves a default only when its dependency is missing (OQ-02).

### 2.7 PDF reader (`tests/app/helpers/pdf.ts`, P4)

- Reads the header, `startxref`, the classic cross-reference table and the trailer (it fails on cross-reference streams); resolves indirect objects with a small tokenizer (numbers, names, literal strings with escapes, hex strings, arrays, dictionaries, references, streams); decodes streams that are unfiltered or FlateDecode (`node:zlib`).
- Interprets the page content stream: `q` `Q` `cm`, path operators `m l c v y h re`, painting `f F f* S s B B* b b* n`, colour `g G rg RG k K cs CS sc scn`, text `BT ET Tf Tm Td TD T* Tj TJ ' "`. It returns filled polygons with their fill colour, stroked segments, and text runs with font resource, effective size and origin in page coordinates, decoding WinAnsi bytes (0xB7 → ·, 0xD7 → ×).

### 2.8 Tolerances, seeds and determinism

- Contract numbers are the assertion thresholds, unchanged: RMS 0.25 px and maximum 0.6 px; 1e−6 rad and 1e−6 · ‖t‖; the PnP bounds of OQ-18; 1 % and 10 %; 0.5 × the input std; 0.5 px within 6 frames; 1e−9 orthonormality. Tests never loosen them.
- Closed-form results (intrinsics, matrices, camera position, board coordinates) use a relative tolerance of 1e−12. Results that go through a solver use the contract's own tolerance, or 1e−9.
- Statistical clauses were checked offline before being turned into tests (this plan §10.1); the PnP rotation bound was changed accordingly (OQ-18).
- Seeds are fixed before the implementation exists (Red phase) and are not changed to make a run pass; changing a seed needs a note in this plan.
- No golden images or stored outputs: truth is computed analytically, so a last-ulp difference between Node versions can at most flip one 8-bit rounding, which bounded assertions absorb. Determinism tests compare two runs in the same process.
- Wall-clock time appears only in P1-PERF, with warm-up runs, medians and 3× bounds (OQ-05). Every other test uses the manual clock and scheduler.
- Each test builds its own pipeline, filter, tracker and fakes; `vi.restoreAllMocks()` and `vi.unstubAllGlobals()` run after every test that uses them. Heavy P1 cases set a 120 s timeout.

### 2.9 Helper self-tests

| ID | Checks | Expected |
| :--- | :--- | :--- |
| H-01 | Random numbers | Same seed → same 1,000 values; different seeds differ; `next()` in [0, 1); Gaussian mean within 0.01 and std within 1 % over 10⁵ draws |
| H-02 | Pixel-centre convention | A board with 10 px squares whose edges lie on pixel boundaries renders no mixed pixel: only 40, 128 and 200 occur, and pixels 10–19 of the first square row are dark |
| H-03 | Supersampling bias | Vertical and horizontal square edges at 37 sub-pixel offsets: the sum of normalised intensities across the edge gives its position within 1/32 px (+ 0.004 for 8-bit rounding) |
| H-04 | Ground truth | For 20 random camera placements, `physical` equals K(R[X Y 0]ᵀ + t) of the board model within 1e−9 px |
| H-05 | Canonical order | For 50 nominal scenes, truth(9, 6) equals the physical order and satisfies O2 and O3 (outward-square contrast > 40); for 6 scenes, truth(6, 9) is the transposed order (j′, 5 − i′) and satisfies O2 and O3 |
| H-06 | Nominal verifier | 50 sampled scenes are nominal; 8 broken ones (min edge 11 px, tilt 61°, margin 0.2, contrast 79, blur 1.1, noise 4.5, gain ±0.3, board partly outside) are flagged with exactly their reason; the 60 stress scenes are not nominal |
| H-07 | Blur | The kernel sums to 1; a constant image is unchanged; the impulse response has std σ within 1 % (σ 1 and 2) |
| H-08 | Noise | Measured σ within 3 % and mean within 0.05 on 640×360; same seed → same image, another seed → another |
| H-09 | Camera fakes (P3) | A buffer is detached after `postMessage`; `respond` delivers a new buffer object; the scheduler runs only pending callbacks and honours cancel |
| H-10 | PDF reader (P4) | Parses a minimal PDF 1.4 written by hand in the test, and rejects a copy with one wrong cross-reference offset |
| H-11 | Scene catalogue | Every P1 catalogue group has its expected number of scenes and every scene passes its check (from geometry alone) |

## 3. P1 Detector

### 3.1 `board.ts` (§5.1)

| ID | Clause | Setup / input | Expected |
| :--- | :--- | :--- | :--- |
| P1-BRD-01 | §5.1 `BOARD` | Read `BOARD` | squaresX 10, squaresY 7, cornersX 9, cornersY 6, squareSize 0.24, squareMeters 0.025 |
| P1-BRD-02 | §5.1 `boardCorners` | One call | `Float64Array` of length 108 |
| P1-BRD-03 | §5.1 corner k = j · 9 + i | All 54 corners | [2k, 2k+1] = ((i + 1 − 5) · 0.24, (j + 1 − 3.5) · 0.24) within 1e−12 |
| P1-BRD-04 | §5.1 anchors | Corners 0, 8, 45, 53; centroid | (−0.96, −0.6), (0.96, −0.6), (−0.96, 0.6), (0.96, 0.6); centroid (0, 0) within 1e−12 |
| P1-BRD-05 | §5.1 "a new array" | Two calls; write into the first result | Different objects and buffers; the second result is unaffected |
| P1-BRD-06 | §5.1 layout rule | Compare with the helper board model | Corner (i, j) is the common vertex of squares (j, i), (j, i+1), (j+1, i), (j+1, i+1); square (0, 0), diagonally outward from corner 0, is dark |
| P1-BRD-07 | §5.1 `readonly` (OQ-07) | `Object.isFrozen(BOARD)` | true |

The last bullet of §5.1 (heroScene takes `COLS`, `ROWS` and `SQUARE` from `BOARD`) is a P3 change, checked by P3-ARCH-01.

### 3.2 `rgbaToGray` (§5.2)

| ID | Clause | Setup / input | Expected |
| :--- | :--- | :--- | :--- |
| P1-GRY-01 | BT.601, within 1 | Each channel swept 0–255 with the other two at each of {0, 255}; the 16-level grid (multiples of 17, 4,096 colours); 65,536 seeded random colours with random alpha | Every value within 1 of round(0.299 R + 0.587 G + 0.114 B) |
| P1-GRY-02 | BT.601 anchors | Black, white, pure red, pure green, pure blue | 0–1, 254–255, 75–77, 149–151, 28–30 (catches channel order) |
| P1-GRY-03 | Alpha ignored | 1,000 random colours with alpha 0, 1, 128, random and 255 | Identical output |
| P1-GRY-04 | Layout | 3×2 image of 6 distinct colours | data[v · w + u] belongs to pixel (u, v); width and height echoed; data.length = w · h; data is a `Uint8Array` or `Uint8ClampedArray` |
| P1-GRY-05 | `out` given | `out` pre-filled with 0xAA | Returned `data` is `out` itself; every byte overwritten with the P1-GRY-01 values |
| P1-GRY-06 | Input types and views | `Uint8Array` vs `Uint8ClampedArray` input; input as a view with byteOffset 4 inside white pixels; `out` as a subarray of a larger buffer | Identical values; nothing outside the views is read or written |
| P1-GRY-07 | Smallest image | 1×1 | Works |
| P1-GRY-08 | `RangeError` | width or height 0, −1, 2.5, NaN, Infinity; rgba.length 4wh − 1, 4wh + 4, 0; out.length wh − 1, wh + 1 | `RangeError` |
| P1-GRY-09 | §8 pure function | Byte copy of `rgba`; two calls without `out` | `rgba` unchanged; the two results share no data. An `out` that overlaps `rgba` is unsupported and untested (OQ-08) |

### 3.3 `findChessboardCorners` (§5.2)

Only (cornersX, cornersY) = (9, 6) and (6, 9) carry the accuracy, rejection and tracking guarantees; other sizes appear only as negatives for rejection (d) (OQ-09).

#### Validation and result layout

| ID | Clause | Setup / input | Expected |
| :--- | :--- | :--- | :--- |
| P1-DET-01 | Precondition: image | width or height 0, −1, 1.5, NaN; data.length wh − 1 and wh + 1 | `RangeError` |
| P1-DET-02 | Precondition: lattice size | cornersX or cornersY 1, 0, 2.5, NaN; equal sizes (5, 5); even sums (4, 6), (9, 7) | `RangeError` |
| P1-DET-03 | Precondition: `previous` | Length 107, 109, 0 for 9×6 | `RangeError`; length 108 filled with NaN: no error |
| P1-DET-04 | Valid edge inputs | (2, 3) and (3, 2) on a 1×1 image; (9, 6) on 1×1, 3×3 and 16×16 images; options `undefined`, `{}`, `{ previous: null }`, `{ previous: undefined }` on S0 | No throw; tiny images → null; the four option forms give identical results |
| P1-DET-05 | Result layout | (9, 6) and (6, 9) on S0, twice each; also every non-null result in P1 (shared assertion) | A new `Float32Array` of length 2 · cornersX · cornersY |

#### Ordering O1–O3

| ID | Clause | Setup / input | Expected |
| :--- | :--- | :--- | :--- |
| P1-DET-06 | O1–O3 at any in-plane rotation | In-plane 0°, 15°, …, 345° (24 scenes), tilt 20°, min edge 16 px, blur 0.8, noise 3 | Accurate, hence O1–O3 |
| P1-DET-07 | O2 and O3 as properties | S0 and the 0°, 90°, 180°, 270° scenes of P1-DET-06; also every accurate result in P1 (shared assertion) | cross(p(1,0) − p(0,0), p(0,1) − p(0,0)) > 0; the square diagonally outward from corner 0 is darker than its two light neighbours |
| P1-DET-08 | O3 picks corner 0 | In-plane 180° and 180° ± 5° | Accurate: result corner 0 is still the board's own corner 0, now at the image position corner 53 had before the rotation, so the colour rule, not the image position, picks corner 0 (also covers colour inversion, this plan §2.3) |
| P1-DET-09 | O1 | In-plane 90° and 270°, in landscape and portrait images | Accurate: i runs along the side with 9 corners |
| P1-DET-10 | O1 with swapped sizes | (6, 9) requested on the 9×6 board, 6 scenes | Accurate against truth(6, 9): T(i′, j′) = physical (j′, 5 − i′). Not a size mismatch, since §7 step 5 accepts either orientation |

#### Accuracy under nominal conditions

| ID | Clause | Setup / input | Expected |
| :--- | :--- | :--- | :--- |
| P1-DET-12 | Nominal accuracy | 40 seeded `nominalScene`s at 640×360 | Each accurate |
| P1-DET-13 | Square edge ≥ 12 px | Min edge 12.25 px at tilt 0°, 30°, 60°; blur 1.0, noise 4 | Accurate |
| P1-DET-14 | Tilt ≤ 60° | Tilt 60° about the board X, Y and diagonal axes, both signs (6 scenes), min edge 13 px, 45° field of view so the board fits | Accurate |
| P1-DET-15 | Blur σ ≤ 1.0 | Blur 1.0 at min edge 12 px and 30 px | Accurate |
| P1-DET-16 | Noise σ ≤ 4 | Noise 4 at contrast 80 (levels 88/168, 5 seeds) | Accurate |
| P1-DET-17 | Contrast ≥ 80 | Levels 88/168, 10/90, 150/230, no gain | Accurate |
| P1-DET-18 | Gradient ±25 % (OQ-12) | Gain ±0.25 along 0°, 45°, 90°, 135°, levels 40/152, contrast ≥ 80 at every point | Accurate |
| P1-DET-19 | Margin ≥ 0.25 square | Margin exactly 0.25 square touching the image border on 1, 2 and 4 sides; beyond it a dark (20) background or clutter | Accurate |
| P1-DET-20 | Background beyond the margin | Clutter outside the margin: rectangles, text-like rows, graph paper (5 seeds) | Accurate |
| P1-DET-21 | All limits at once | Min edge 12 px, tilt 60°, blur 1.0, noise 4, contrast 80.25 at the dim end, gain ±0.25, margin 0.25, clutter (4 seeds) | Accurate |
| P1-DET-22 | No upper size limit | Board filling 640×360 (45 px squares); 1280×720 (90 px squares) | Accurate |
| P1-DET-23 | Image shapes | 360×640, 320×240, 641×359, 1280×720 | Accurate |
| P1-DET-24 | Pixel-centre convention | Fronto-parallel, in-plane 0°, 24 px squares, corners on integer and on half-integer pixel positions, no blur or noise | Accurate (a half-pixel convention error alone gives a 0.71 px maximum error) |
| P1-DET-25 | Data types | S0 as `Uint8ClampedArray`, `Uint8Array`, and a subarray view with byteOffset 7 | Identical results, accurate |

#### Rejection

| ID | Clause | Setup / input | Expected |
| :--- | :--- | :--- | :--- |
| P1-DET-26 | (a) no board | Uniform 0, 128, 255; noise σ 40 (3 seeds); linear and radial gradients; random rectangles (5 seeds); text-like texture (3 seeds); graph paper; a 9×6 dot grid; a single 2×2 checker | null, each |
| P1-DET-27 | (b) inner corner outside | Last column of corners 0.5 square past the right border; only corner 53 outside, by 5 px (board rotated −35°); corner 0 5 px outside at the top left; board 3× wider than the frame | null |
| P1-DET-28 | (c) occluded corner | Disc of radius 0.4 square on corner (4, 3), (0, 0), (8, 5) or (0, 3), filled dark, light, 128 or textured; a bar 0.67 square high (half-height 0.33 square) over the whole corner row 3 | null, each |
| P1-DET-29 | (c) partial occlusion (OQ-13) | Disc of radius 1 px on corner (4, 3); a finger-shaped occluder over outer square (0, 4) that covers no inner corner | null-or-accurate |
| P1-DET-30 | (d) larger lattice | Boards with 10×7, 9×7 and 10×6 inner corners, requested as (9, 6) | null |
| P1-DET-31 | (d) smaller lattice | Boards with 8×5, 8×6 and 9×5 inner corners, requested as (9, 6) | null |
| P1-DET-32 | (d) wrong request (OQ-09) | The 9×6 board requested as (8, 5), (10, 7), (9, 4), (7, 6), (2, 3), (4, 3) | null |
| P1-DET-33 | (c) destroyed corner (OQ-13) | Colour of square (3, 4), and of outer square (0, 5), flipped | null |
| P1-DET-34 | §1 out of scope (OQ-14) | Two complete 9×6 boards in one image | null, or accurate against one of the two boards |
| P1-DET-35 | "`null` is preferable to a wrong answer" (OQ-10) | 60 seeded off-nominal scenes, 6 each: blur 1.5–2.5, noise 8–16, tilt 65–80°, squares 7–11 px, contrast 30–79, gain ±0.4–0.6, 5 px motion blur, posterised to 16 levels, no margin on a dark background, glare | Each null-or-identity-correct |

#### Near the image border

| ID | Clause | Setup / input | Expected |
| :--- | :--- | :--- | :--- |
| P1-DET-36 | Near-border allowance | Outer squares cut by the border, the outermost corners 0.6 or 2.8 px inside it, otherwise nominal (8 scenes, all 4 sides) | null-or-accurate |
| P1-DET-37 | Allowance vs (b) (OQ-11) | The outermost corners 0.6 or 2.8 px outside the border (8 scenes) | null-or-accurate (two-sided band) |
| P1-DET-38 | Between nominal and the band (OQ-11) | Outer squares and margin cut, every inner corner ≥ 4 px inside (4, 6, 9, 12 px) | null-or-accurate |

#### Tracking hint

| ID | Clause | Setup / input | Expected |
| :--- | :--- | :--- | :--- |
| P1-DET-39 | Correct hint | `previous` = the detector's own result on S0; and `previous` = truth | Accurate; the result is not the `previous` array |
| P1-DET-40 | Moved ≤ 0.25 square (OQ-15) | Every corner moved by 0.25 × min edge: translation in 8 directions, rotation, scale up and down, tilt change; `previous` = the result on S0 | Accurate |
| P1-DET-41 | Sequence | 30 nominal frames moving 0.2 square per frame, each result fed as the next hint | Every frame accurate (no drift) |
| P1-DET-42 | Stale hint | `previous` = truth of S0 moved 2 squares, rotated 30°, scaled ×1.5 | Accurate on S0 |
| P1-DET-43 | Reordered hint | Truth of S0 reversed (k ↔ 53 − k), with i flipped, or with j flipped | Accurate in canonical order, never in the hint's order |
| P1-DET-44 | Off-by-one hint | Lattice shifted by one column; by one row | Accurate |
| P1-DET-45 | Garbage hint | All 0; all NaN; +Infinity; −Infinity; seeded random in-image values; 1e9; all corners at one point; negative values; on S0 and 5 nominal scenes | Accurate; no throw |
| P1-DET-46 | Hint + (a) | `previous` = truth of S0; the images of P1-DET-26 | null |
| P1-DET-47 | Hint + (c) | `previous` = result on S0; the occluded frames of P1-DET-28 | null |
| P1-DET-48 | Hint + (b) | `previous` = each scene's own truth; the frames of P1-DET-27 | null |
| P1-DET-49 | Hint + (d), larger | Board with 10×7 inner corners; `previous` = an exact 9×6 sub-lattice of it | null |
| P1-DET-50 | Hint + (d), smaller | Board with 8×5 inner corners; `previous` = a 9×6 lattice extrapolated one column and one row beyond it | null |
| P1-DET-51 | Large motion | Board moved 1 square since `previous` | Accurate |
| P1-DET-52 | Same guarantees off nominal (OQ-10) | The P1-DET-35 scenes with `previous` = truth | null-or-identity-correct |

#### Determinism and input immutability

| ID | Clause | Setup / input | Expected |
| :--- | :--- | :--- | :--- |
| P1-DET-53 | Deterministic | Same input twice, with and without the same hint | Identical results |
| P1-DET-54 | No hidden state | S0, another scene (with and without a hint), S0 again | Both S0 results identical |
| P1-DET-55 | Image not modified | Byte copy of `image.data`, width and height, for a found and a null call | Unchanged |
| P1-DET-56 | Hint not modified | Byte copy of the `previous` buffer, including NaNs with distinctive payloads | Unchanged |
| P1-DET-57 | New result array (OQ-17) | A found call with a hint; two calls | The result is not `previous` and shares no buffer with `previous` or `image.data`; byteOffset 0 and buffer byteLength 432 (exactly sized); two calls return two objects |

### 3.4 Performance smoke test (§5.2, §9)

Default suite with bounds 3× the targets (OQ-05). Each case first checks the timed frame's outcome, so a fast wrong answer cannot pass.

| ID | Clause | Setup / input | Expected |
| :--- | :--- | :--- | :--- |
| P1-PERF-01 | Full detection ≤ 30 ms | S0 (found); 3 warm-up and 15 timed runs | Median ≤ 90 ms; median logged |
| P1-PERF-02 | With a valid hint ≤ 5 ms | `previous` = the result on S0; S0 moved 0.1 square (found) | Median ≤ 15 ms |
| P1-PERF-03 | Frames without a board (OQ-16) | 640×360 clutter with noise σ 12 (null) | Median ≤ 90 ms |

The phone figure (≥ 20 results per second) is checked manually (M3-15, M3-16).

## 4. P2 Pose and worker pipeline

### 4.1 `intrinsicsFromFov` (§5.3)

| ID | Clause | Setup / input | Expected |
| :--- | :--- | :--- | :--- |
| P2-INT-01 | Formula | 640×360, 60° | fx = fy = 554.2562584, cx 319.5, cy 179.5 (1e−9) |
| P2-INT-02 | Formula | 1280×720 at 90°; 360×640 at 60°; 1×1 at 60° | fx = 640; fx = 311.7691454 with cx 179.5, cy 319.5; cx = cy = 0 |
| P2-INT-03 | `RangeError` | width or height 0, −1; hfovDeg 0, 180, −1, 181, NaN, Infinity | `RangeError` |
| P2-INT-04 | Non-finite or non-integer sizes (OQ-22) | width or height NaN, ±Infinity; width 640.5 | `RangeError` for NaN and ±Infinity; 640.5 accepted (fx = 320.25 / tan 30°) |

### 4.2 `solvePlanarPnP` (§5.3)

| ID | Clause | Setup / input | Expected |
| :--- | :--- | :--- | :--- |
| P2-PNP-01 | Preconditions | Lengths 108 and 106; length 7; N = 3; empty arrays; NaN or ±Infinity in either array; K with fx 0, fy −1, fx NaN, cx Infinity | `RangeError` |
| P2-PNP-02 | `ArrayLike` inputs | `number[]`, `Float64Array`, `Float32Array` | Accepted; `number[]` and `Float64Array` with the same values give identical poses |
| P2-PNP-03 | Exact projections (OQ-19) | 30 seeded poses: board ≥ 1/3 of the width, tilt 0–60°, any in-plane rotation, centred and off-centre; float64 image points | Rotation error ≤ 1e−6 rad, ‖t − t_true‖ ≤ 1e−6 · ‖t_true‖; R compared row-major |
| P2-PNP-04 | Exact, small sets | N = 4 (corners 0, 8, 45, 53); N = 10 random planar points | Same bounds |
| P2-PNP-05 | General K | fx 500, fy 520, cx 300, cy 200, exact data | Same bounds |
| P2-PNP-07 | Postconditions | Every pose returned in P2 (shared assertion) | R a `Float64Array(9)`, max abs(RᵀR − I) ≤ 1e−9, abs(det R − 1) ≤ 1e−9; t a `Float64Array(3)` with t_z > 0; `rms` finite and ≥ 0 |
| P2-PNP-08 | `rms` definition | The test recomputes sqrt((1/N) · Σ ‖imageXY_k − K(R [X Y 0]ᵀ + t)‖²), the mean over N points | Equals `rms` within 1e−9 relative |
| P2-PNP-09 | Noisy accuracy (OQ-18) | σ 0.3 px on the 54 corners, true K, board ≥ 1/3 of the width; 20 seeded trials with tilt 35–60° and 20 with tilt 0–35° | Tilt 35–60°: rotation ≤ 0.5°; tilt 0–35°: rotation ≤ 3°; translation ≤ 1 % of ‖t_true‖ in both |
| P2-PNP-10 | Minimises pixel error | The 40 noisy trials | `rms` ≤ the true pose's rms + 1e−9, and ≤ the rms of the helper's homography-only pose + 1e−9 |
| P2-PNP-11 | Local minimum | Rotation perturbed by ±1e−4 rad about each axis, t by ±1e−4 · ‖t‖ per component | `rms` never lower by more than 1e−9 relative |
| P2-PNP-12 | Degenerate → null (OQ-20) | All object points collinear; all image points collinear; all image points equal; 4 copies of 2 points; 4 points with 3 collinear | null |
| P2-PNP-13 | Board behind the camera (OQ-21) | Image points from the point reflection −P of a valid projection | null |
| P2-PNP-14 | §8 pure function | Same inputs twice; byte copies of the inputs | Bitwise-identical R, t, rms; inputs unchanged |
| P2-PNP-15 | Scale invariance | Object points × 7 with t_true × 7, exact data | Same R; t × 7 within 1e−6 relative |

### 4.3 `estimateFocal` (§5.3)

In this section tilt is the angle between the board normal and the optical axis (OQ-23).

| ID | Clause | Setup / input | Expected |
| :--- | :--- | :--- | :--- |
| P2-FOC-01 | Preconditions (OQ-22) | The P2-PNP-01 array cases; width or height 0, −1, NaN, ±Infinity | `RangeError` |
| P2-FOC-02 | Exact data, tilt ≥ 30° | Tilt 30°, 45°, 60° about the board X, Y and diagonal axes; true hfov 40°, 60°, 90°, 100°; board centred | Within 1 % |
| P2-FOC-03 | Noisy, tilt 45° | σ 0.3 px, board ≥ 40 % of the width, 20 seeded trials | Within 10 % in each |
| P2-FOC-04 | Tilt < 10° → null | Tilt 0°, 5°, 9.5°, exact and noisy (20 trials each) | null |
| P2-FOC-05 | Tilt 10–25° | 10°, 15°, 20°, 24° | null or a finite positive number |
| P2-FOC-06 | Tilt ≥ 25° → a value (OQ-24) | Tilt 25°, 30°, 45°, 60°; exact and σ 0.3 px data (20 trials each); board ≥ 40 % of the width | Non-null |
| P2-FOC-07 | Fronto-parallel off-centre (OQ-23) | R = I, board near an image corner (ray angle ≈ 25°, optical-axis tilt 0°) | null |
| P2-FOC-08 | Degenerate points (OQ-25) | Collinear; duplicates | null; never throws |
| P2-FOC-09 | Output domain | All P2-FOC inputs plus 50 seeded random correspondences | null or a finite number > 0 |
| P2-FOC-10 | Invariance, §8 | Object points × 7; same input twice; byte copies | Same estimate within 1e−9 relative; identical outputs; inputs unchanged |

### 4.4 `viewMatrix`, `projectionMatrix`, `cameraPosition` (§5.3, §6)

| ID | Clause | Setup / input | Expected |
| :--- | :--- | :--- | :--- |
| P2-VM-01 | `viewMatrix` formula | 20 random poses × 10 random scene points | V · [p, 1] (column-major, V[4c + r]) = [F (R · B · p + t), 1] within 1e−12 |
| P2-VM-02 | Shape | Any pose | `Float64Array(16)`; (V[3], V[7], V[11], V[15]) = (0, 0, 0, 1); a new array per call; pose unchanged |
| P2-VM-03 | `THREE.Matrix4` element order | `new THREE.Matrix4().fromArray(V)`, then `Vector3.applyMatrix4` | Same result as the formula |
| P2-VM-04 | Known pose | R = I, t = (0, 0, 5); scene points (0,0,0), (0,1,0), (1,0,0), (0,0,1) | (0, 0, −5), (0, 0, −4), (1, 0, −5), (0, −1, −5) |
| P2-PM-01 | NDC formulas | K with fx 500, fy 520, cx 300, cy 200, and the default K; image 640×360; viewports 1280×720, 390×844, 1920×800, 320×180; random points with Z ∈ [near, far] | P · [X, −Y, −Z, 1] after perspective division gives the §5.3 x_ndc and y_ndc within 1e−9 |
| P2-PM-02 | Cover fit (§6), derived independently | Same inputs | Equals u = fx · X/Z + cx → viewport x = (W − s · w)/2 + s · (u + 0.5) → x_ndc = 2x/W − 1 (y the same way, flipped), with s = max(W/w, H/h), within 1e−9 |
| P2-PM-03 | Cover edges | Wide viewport 1920×800 (s = W/w); tall viewport 390×844 (s = H/h) | Wide: u = −0.5 → x_ndc = −1 and u = w − 0.5 → +1. Tall: v = −0.5 → y_ndc = +1 and v = h − 0.5 → −1 |
| P2-PM-04 | Depth | Z = near, Z = far, points in between | z_ndc = −1 and +1 within 1e−9; increasing with Z |
| P2-PM-05 | Usable by WebGL (OQ-26) | Points with Z > 0 | Clip w = k · Z with k > 0; det P ≠ 0 |
| P2-PM-06 | `RangeError` (OQ-22) | Image or viewport width or height 0, −1, NaN, ±Infinity; near 0, −1; near = far; near > far; near or far NaN | `RangeError` |
| P2-PM-07 | Shape, use in three.js | Any valid input | `Float64Array(16)`, new per call; through `Matrix4.fromArray` and `Vector3.applyMatrix4` (which divides by w), the same NDC |
| P2-CP-01 | `cameraPosition` formula | 20 random poses | B⁻¹ · (−Rᵀ t) within 1e−12; a new `Float64Array(3)` per call |
| P2-CP-02 | Consistent with `viewMatrix` | Same poses | V · [c, 1] = (0, 0, 0, 1) within 1e−9 |
| P2-CP-03 | Known pose | R = I, t = (0, 0, 5) | (0, 5, 0) |
| P2-CHN-01 | Corner markers land on the detected corners | 10 random poses; scene points (X, 0, Y) of the 54 board corners | P · V puts each on the cover-mapped K-projection of (X, Y, 0) within 1e−9 in NDC |
| P2-CHN-02 | Scene up (§6) | Poses that see the board from the front | Scene point (0, 0.5, 0) is nearer the three.js camera than (0, 0, 0) |

`viewMatrix` and `cameraPosition` do not validate their arguments (OQ-22), so there are no error cases for them.

### 4.5 `createCornerFilter` (§5.4)

`time` is in milliseconds, like `FrameInput.time` (OQ-01); frames are 1000/30 ms apart. Only the behavioural clauses are tested; the One Euro formulation in §7 is implementation guidance (OQ-27).

| ID | Clause | Setup / input | Expected |
| :--- | :--- | :--- | :--- |
| P2-CF-01 | First call | Fresh filter, any array | A copy: equal values, new object and buffer |
| P2-CF-02 | After `reset()` | Converged filter, `reset()`, a far-away input | Output equals the input exactly |
| P2-CF-03 | Length change | 108 → 10 → 108 values | A copy at each change; later calls smooth from the new start |
| P2-CF-04 | Time not later | The same time twice; an earlier time | A copy, and the filter restarts from it |
| P2-CF-05 | Constant input | 100 identical frames | Output equals the input on every call |
| P2-CF-06 | Each coordinate independent | Coordinate a static, coordinate b moving at 300 px/s, filtered in one array | Equals two separate one-coordinate filters within 1e−12 |
| P2-CF-07 | One Euro is a first-order low-pass | 500 random frames | Each output lies between the previous output and the current input; no overshoot on steps |
| P2-CF-08 | Jitter (OQ-28) | 108 static coordinates with σ 0.3 px seeded jitter, 30 fps, 300 frames | For every coordinate, the output std over frames 11–300 ≤ 0.5 × its input std |
| P2-CF-09 | Step ≥ 12 px (OQ-29) | Converged, then +12 px in x, −12 px in y, and a 12 px diagonal step; noise-free | From the 6th output at the new position on, every corner within 0.5 px of it (Euclidean) |
| P2-CF-10 | Larger steps | 50 px and 200 px | Same bound |
| P2-CF-11 | Options honoured | minCutoff 1e6; minCutoff 0.01 with beta 0 | ‖out − in‖ ≤ 1e−3 px; a 12 px step moves < 1 px in 10 frames |
| P2-CF-12 | New array, input untouched | Any | A distinct object per call; input bytes unchanged |

### 4.6 `createFocalTracker` (§5.4)

| ID | Clause | Setup / input | Expected |
| :--- | :--- | :--- | :--- |
| P2-FT-01 | Default until `minSamples` | hfovDeg 60: focal(640), focal(360); hfovDeg 75: focal(640) | 554.2562584; 311.7691454; 417.0321 |
| P2-FT-02 | `minSamples` 5 | Add 500, 510, 490, 520, query; add 480, query | Default; then 500 |
| P2-FT-03 | `add(null)` ignored | Nulls between estimates | Nulls neither count toward `minSamples` nor take window slots |
| P2-FT-04 | `window` 15 | 5 × 1000, then 15 × 500; then one more 1000 | 500; still 500 |
| P2-FT-05 | Median | 7 and 15 unsorted estimates | The middle value |
| P2-FT-06 | Even count (OQ-30) | 100, 200, 300, 400, 500, 600; and 8 estimates | Mean of the two middle values: 350; the mean of the 4th and 5th |
| P2-FT-07 | Clamp at the query width | Estimates of 1e6 at width 640; estimates of 1; a median of 500 queried at width 320 | 879.1928 (40°); 268.5119 (100°); 439.5964 (40° at width 320) |
| P2-FT-08 | Options | window 3, minSamples 1, minFovDeg 50, maxFovDeg 90 | Behaviour follows the options |
| P2-FT-09 | `reset()` | After learning: `reset()`, then 4 new estimates | Default until the 5th |
| P2-FT-10 | Default is not clamped | hfovDeg 30 | (w/2)/tan(15°) before `minSamples`, i.e. 1194.2563 at width 640 |
| P2-FT-11 | Non-finite estimates (OQ-31) | NaN, ±Infinity, 0, −1 between valid estimates | Ignored like null |

### 4.7 `createPipeline` (§5.4 steps 1–6)

Frames are 320×180 (nominal 12 px squares fit) unless stated, RGBA from the grey renderer with R = G = B, 1000/30 ms apart. "Raw" corners are those returned by the spied detector call.

| ID | Clause | Setup / input | Expected |
| :--- | :--- | :--- | :--- |
| P2-PIP-01 | Step 3 | Blank frame | found false, corners null, pose null, intrinsics { fx = fy = 277.1281292, cx 159.5, cy 89.5 }, `ms` finite and ≥ 0 |
| P2-PIP-02 | Step 4 | Nominal board frame | found true; corners a `Float32Array(108)`; pose non-null; intrinsics fx = fy, cx = (w − 1)/2, cy = (h − 1)/2 |
| P2-PIP-03 | Step 4 composition | Same frame | `pose` equals `solvePlanarPnP(boardCorners(), corners, intrinsics)` recomputed by the test, bitwise |
| P2-PIP-04 | Step 2 (spy) | 5 moving frames | `findChessboardCorners` called with a `GrayImage` of the frame size whose data equals `rgbaToGray(rgba)`, and 9, 6; `previous` null or absent first, then the previous call's return value (raw), which differs from the smoothed output |
| P2-PIP-05 | Step 2, hint dropped (spy) | After a not-found frame; after `reset()`; after a size change | `previous` null or absent |
| P2-PIP-06 | Steps 2 and 4 (OQ-33) | Detection succeeds, `solvePlanarPnP` mocked to null; next frame | The next call's `previous` is that frame's raw corners |
| P2-PIP-07 | Step 4 smoothing (spy) | 10 moving frames, smoothing on; and off | On: corners equal a standalone `createCornerFilter()` fed the raw corners and frame times, exactly. Off: equal the raw corners |
| P2-PIP-08 | Step 3 filter reset | found, found, not found, found | The 4th output's corners equal its raw corners |
| P2-PIP-09 | Step 4, `autoFocal` false (spy) | 10 frames, hfovDeg 60 and 75 | `estimateFocal` never called; fx = (w/2)/tan(hfov/2) on every frame |
| P2-PIP-10 | Step 4, `autoFocal` true (mock) | `estimateFocal` scripted: 400, null, 410, 405, 395, 402, … | Called once per found frame with (boardCorners(), raw, width, height); fx on each frame follows the tracker rule of §5.4, with that frame's estimate added before K is built |
| P2-PIP-11 | Steps 4 + tracker, end to end | 640×360, true hfov 50°, tilt 40–50°, 12 frames; again with true hfov 30° | After frame 12, abs(fx/f_true − 1) ≤ 10 %; with 30°: fx = 879.1928 (the 40° clamp at width 640) within 1e−9 |
| P2-PIP-12 | Step 5, transfer | After each call, detach the corners, `pose.R` and `pose.t` buffers with `structuredClone(…, { transfer })`; smoothing on and off | Later calls do not throw and match a run without detaching, `ms` aside |
| P2-PIP-13 | Step 5, determinism | Two fresh pipelines, the same 20 frames with found, lost, size change and `reset()` | Identical outputs, `ms` aside |
| P2-PIP-14 | Step 1 | A: 8 frames at 320×180, then 6 at 180×320. B: a fresh pipeline on the same 6 | Identical outputs; intrinsics back to the default for 180×320 |
| P2-PIP-15 | Step 6 | `reset()` in the middle of a sequence | Later outputs equal a fresh pipeline's |
| P2-PIP-16 | Step 4, PnP null (mock) | `solvePlanarPnP` returns null | found false, corners null, pose null, intrinsics = the tracker's value; the next found frame's corners equal its raw corners |
| P2-PIP-17 | Step 2, grey conversion | RGBA whose red channel alone shows the inverted board (grey 80/180) | found; corner 0 within 1 px of corner 0 of the grey truth |
| P2-PIP-18 | Sanity, not a contract bound | 640×360, true hfov 60°, `autoFocal` false, tilt 30–50°, board ≥ 50 % of the width | Rotation error ≤ 2°, translation error ≤ 3 % |
| P2-PIP-19 | Defaults | `createPipeline()` vs `createPipeline({ hfovDeg: 60, autoFocal: true, smoothing: true })`, 15 frames | Identical outputs, `ms` aside |
| P2-PIP-20 | §8 self-contained | Byte copy of `frame.rgba` | Unchanged after `process` |
| P2-PIP-21 | Malformed frame (OQ-35) | `rgba` of length 4 · w · h − 4, between valid frames | `process` throws `RangeError`; the following frames give the outputs of a run without the malformed frame |
| P2-PIP-22 | Step 3 intrinsics (OQ-34) | A not-found frame after ≥ 5 scripted estimates | fx = fy = the tracker's focal, cx = (w − 1)/2, cy = (h − 1)/2 |

### 4.8 `handleWorkerMessage` and `tracker.worker.ts` (§5.4)

| ID | Clause | Setup / input | Expected |
| :--- | :--- | :--- | :--- |
| P2-WRK-01 | `frame` → `result` (fake pipeline) | `process` returns a scripted found output | type "result", same id; found, corners, intrinsics, ms from the output; pose as { R: number[9], t: number[3], rms } (`Array.isArray`, equal values); `buffer === message.buffer` |
| P2-WRK-02 | "Wraps buffer as RGBA" | Spy on `process` | width, height, time copied; rgba a `Uint8ClampedArray` over the whole buffer (`rgba.buffer === buffer`, byteOffset 0, length = byteLength) |
| P2-WRK-03 | Transfer list | Found and not-found outputs | Exactly { buffer, corners.buffer } with no duplicates; [buffer] when corners is null |
| P2-WRK-04 | Transferable in practice | `structuredClone(reply, { transfer })` | Succeeds; both buffers detached; the clone keeps the data |
| P2-WRK-05 | `reset` | `{ type: "reset" }` | `pipeline.reset()` called once; returns null |
| P2-WRK-06 | Other types | `{ type: "bogus" }` | null; neither `process` nor `reset` called |
| P2-WRK-07 | Exception in `process` | `process` throws `Error("boom")` | `{ type: "error", id, message: "boom" }`; transfer []; no throw |
| P2-WRK-08 | Odd throws and messages (OQ-36) | `process` throws a string or an object; message `null` or `undefined` | message = `String(value)`; null and undefined messages return null without throwing |
| P2-WRK-09 | Real pipeline | Board frame; blank frame | Board: found true, pose non-null, corners of length 108. Blank: pose null, corners null, transfer [buffer] |
| P2-WRK-10 | Real pipeline, bad buffer | Buffer 4 bytes too short | `error` reply with the same id; transfer [] |
| P2-WKE-01 | Worker wiring | `vi.stubGlobal("self", fake)`, import the module, dispatch a frame event | `self.onmessage` set; `self.postMessage` called once with a `result` reply and a transfer list containing the buffer (`postMessage(m, transfer)` and `postMessage(m, { transfer })` both accepted) |
| P2-WKE-02 | Null replies are not posted | `reset` and unknown messages | `postMessage` not called |
| P2-WKE-03 | Error path | Malformed frame | `postMessage` with an `error` reply and an empty transfer list |

### 4.9 Option validation

| ID | Clause | Setup / input | Expected |
| :--- | :--- | :--- | :--- |
| P2-OPT-01 | §5.4 options (OQ-32) | `createPipeline({ hfovDeg: 0 })`, `createCornerFilter({ minCutoff: 0 })`, `createFocalTracker({ hfovDeg: 60, window: 0 })`, `{ minSamples: 0 }`, minFovDeg ≥ maxFovDeg | `RangeError` on creation |

### 4.10 Static dependency checks (OQ-03)

| ID | Clause | Setup / input | Expected |
| :--- | :--- | :--- | :--- |
| P2-ARCH-01 | §4 dependency directions | Scan the import statements in `src/ar` | board: none; chessboard → board; pose: type-only imports; pipeline → chessboard, pose, board; tracker.worker → pipeline; tracker → pipeline and pose through `import type` only |
| P2-ARCH-02 | §4 DOM-free, no three.js in the worker | Same scan | No runtime import of `three`, `react` or `src/components`; no `window` or `document` outside the defaults in `tracker.ts` |

## 5. P3 Camera AR overlay

### 5.1 `startCameraAR` (§5.5)

All cases use the fakes of this plan §2.6, with every dependency supplied.

| ID | Clause | Setup / input | Expected |
| :--- | :--- | :--- | :--- |
| P3-TRK-01 | B1 (OQ-37) | Call `startCameraAR` | Exactly one update before it returns: status "starting", error null, pose null, intrinsics null, frame null, fps 0 |
| P3-TRK-02 | B2 insecure | `isSecureContext` false | Updates [starting, error/insecure]; `getUserMedia` never called; nothing more after flushing every fake |
| P3-TRK-03 | B2 unsupported | `mediaDevices` undefined; `mediaDevices` = {} without `getUserMedia` | error/unsupported |
| P3-TRK-04 | B2 precedence | Insecure and no `mediaDevices` together | error/insecure (the insecure rule is unconditional) |
| P3-TRK-05 | B3 | Default options | `getUserMedia` called once with exactly { audio: false, video: { facingMode: { ideal: "environment" }, width: { ideal: 1280 }, height: { ideal: 720 } } } (`toStrictEqual`) |
| P3-TRK-06 | B3 | facingMode "user" | `{ ideal: "user" }`, the rest unchanged |
| P3-TRK-07 | B4 mapping | Rejections with `DOMException` and plain `{ name }` objects | NotAllowedError, SecurityError → denied; NotFoundError, OverconstrainedError → no-camera; AbortError, NotReadableError, TypeError, `{}`, a string, `undefined` → failed |
| P3-TRK-08 | B4 terminal | After each error: worker replies, ticks, `play()` or `getUserMedia` settling | No further update; every created worker terminated; every obtained track stopped; no frame callback pending |
| P3-TRK-09 | B4 `play()` (OQ-41) | `play()` rejects with an `Error`; with a `DOMException` NotAllowedError | failed in both cases; tracks stopped; worker terminated |
| P3-TRK-10 | B4 worker `error` reply | Reply `{ type: "error" }` | failed, terminal, resources released |
| P3-TRK-11 | B4 `onerror` | `crash(event)` | failed, terminal, resources released |
| P3-TRK-12 | B4 dependency exceptions (OQ-42) | `createWorker`, `captureFrame` or `requestFrame` throws | error/failed, terminal, resources released |
| P3-TRK-13 | B5 | Resolve `getUserMedia`, then `play()` | `srcObject === stream` when `play()` is called; no searching update and no `requestFrame` before `play()` resolves; afterwards: searching (error null, pose null) |
| P3-TRK-14 | B6 one in flight | First post, then 10 ticks; a reply, then a tick; a 50-frame run | No new post while a frame is in flight; after each reply a new frame is posted no later than the next tick; posts ≤ replies + 1 at all times |
| P3-TRK-15 | B6 message (OQ-49) | Any frame | { type "frame", id, width, height, buffer, time } with buffer.byteLength = 4 · w · h; transfer list contains the buffer; time = `deps.now()` at capture |
| P3-TRK-16 | B6 capture | Any frame | `captureFrame(video, w, h, out)` with `out` a `Uint8ClampedArray(4 · w · h)` over the posted buffer; the posted bytes are those `captureFrame` wrote |
| P3-TRK-17 | B6 analysis size (OQ-48) | Video 1280×720, 720×1280, 1920×1080, 640×480, 320×240, 1366×768, 1000×563, 720×720, 2000×1; analysisLongSide 480 at 1280×720 | 640×360, 360×640, 640×360, 640×480, 320×240, 640×360, 640×360, 640×640, 640×1 (`Math.round`, each side ≥ 1); 480×270 |
| P3-TRK-18 | B6 zero size | videoWidth or videoHeight 0 for 3 ticks, then 1280×720 | No capture and no post while 0; frame callbacks keep being requested; posting starts once both are non-zero |
| P3-TRK-19 | B6 buffer reuse | Same size; then a video size change | Frame n + 1 is posted in the buffer returned with reply n (same object); after the change, a buffer of the new size |
| P3-TRK-20 | B6/B7 ids (OQ-45) | Ids of posted frames; a reply with a foreign id | Ids strictly increase; the foreign reply produces no update |
| P3-TRK-21 | B7 one update per reply | N replies | Exactly N updates after searching; ticks alone produce none |
| P3-TRK-22 | B7 found | Found reply; also with the video size changed while the frame was in flight | tracking with the reply's pose (R and t equal, as `Float64Array` per the `Pose` type; rms equal) and intrinsics; frame = the in-flight frame's size |
| P3-TRK-23 | B7 hold (D3) | holdMs 500: found at t0, not found at t0 + 200, not found at t0 + 600; holdMs 200: misses at +150 and +250; holdMs 0: miss at +1 | tracking with the last pose; searching with pose null; tracking then searching; searching |
| P3-TRK-24 | B7 hold clock | Frame 1 captured at 0, found reply at 100; frame 2 captured at 130, not-found reply at 650 | searching: the hold runs between reply arrivals (`deps.now()` in `onmessage`), not capture times |
| P3-TRK-25 | B7 re-acquire | After searching, a found reply, then a miss 300 ms later | tracking, then tracking with the new pose held |
| P3-TRK-26 | B7 boundary, held fields (OQ-38) | Miss exactly holdMs after the last found reply; fields of a held update | Still tracking (≤ holdMs counts as within); a held update carries the last found reply's intrinsics and frame |
| P3-TRK-27 | B8 | Replies every 34 ms for 2 s; the first reply; a reply after a 1.5 s gap; found and not-found replies mixed | fps 30 at steady state (29 × 34 = 986 < 1000 < 1020, so no reply sits on the boundary); 1; 1; both kinds counted |
| P3-TRK-28 | B8 boundary (OQ-39) | A reply exactly 1000 ms old | Not counted (now − t < 1000 ms counts, the current reply included) |
| P3-TRK-29 | B9 stop while tracking | Stream with 2 tracks; frame callback pending | Every track stopped; worker terminated; no frame callback left pending; `stop()` emits no update and nothing later does (late reply through the kept handler, ticks, clock) |
| P3-TRK-30 | B9 idempotent (OQ-44) | Second `stop()` | No throw, no update; `terminate()` and each track's `stop()` called exactly once in total |
| P3-TRK-31 | B9 before `getUserMedia` resolves (OQ-43) | `stop()`, then resolve with a 2-track stream, then `flush()` | No update; all tracks of the late stream stopped; `srcObject` not set; `play()` not called |
| P3-TRK-32 | B9 before `getUserMedia` rejects | `stop()`, then reject | No error update |
| P3-TRK-33 | B9 while `play()` is pending | `stop()`, then resolve `play()` | No searching update; no frame requested; tracks stopped |
| P3-TRK-34 | B9 with a frame in flight | `stop()`, then a late reply through the kept handler | Worker terminated; no update; no further posts |
| P3-TRK-35 | B9 after an error | `stop()` after error/denied | No throw, no update |
| P3-TRK-36 | `TrackingUpdate` invariants | Every update recorded in P3 (shared assertion) | error non-null ⇔ status "error"; pose non-null ⇔ status "tracking"; fps an integer ≥ 0 |
| P3-TRK-37 | `TrackingUpdate` fields (OQ-37) | intrinsics and frame in starting, searching and error updates | null before the first reply; afterwards the latest reply's intrinsics and frame size, also while searching |
| P3-TRK-38 | B2 timing (OQ-40) | Insecure and unsupported cases | Only starting is emitted synchronously; the error update arrives after `startCameraAR` returns |
| P3-TRK-39 | Seams (§8, OQ-02) | Full deps under Vitest's node environment | `startCameraAR` runs without touching `window`, `navigator` or `document` |
| P3-TRK-40 | Options (OQ-32) | analysisLongSide 0 or −1; holdMs −1 | `RangeError` from `startCameraAR` |

### 5.2 Static check

| ID | Clause | Setup / input | Expected |
| :--- | :--- | :--- | :--- |
| P3-ARCH-01 | §5.1 last bullet (OQ-03) | Scan `heroScene.ts` | Imports `BOARD` from `src/ar/board`; `COLS`, `ROWS` and `SQUARE` derive from it (no literal 10, 7, 0.24) |

UI copy is checked manually only (OQ-04): M3-06 and M4-05.

## 6. P4 Board view, QR code and PDF

### 6.1 `src/app/chessboard.pdf/route.ts` (§5.8)

Numbers: 25 mm = 70.8661 pt; 50 mm = 141.7323 pt; the board is 708.661 × 496.063 pt; centred on the page (OQ-50) its lower-left corner is at (66.669, 49.468) and square (0, 0) spans x 66.669–137.535, y 474.665–545.531 (PDF y points up).

| ID | Clause | Setup / input | Expected |
| :--- | :--- | :--- | :--- |
| P4-PDF-01 | `dynamic` | Import the module | `dynamic === "force-static"` |
| P4-PDF-02 | Response | `await GET()` | A `Response`, status 200, `Content-Type` exactly `application/pdf` |
| P4-PDF-03 | Header and end (OQ-54) | Body bytes | Bytes 0–7 are `%PDF-1.4`; the file ends with `%%EOF`, optionally followed by one EOL |
| P4-PDF-04 | Cross-reference offsets | Parse `startxref`, the table, the trailer | `startxref` points at `xref`; one subsection `0 N` with N entries of exactly 20 bytes; entry 0 is `0000000000 65535 f`; every in-use offset points at `k 0 obj`; trailer `/Size` = N |
| P4-PDF-05 | Trailer `/Root`, one page | Follow the references | `/Root` → `/Type /Catalog` → `/Pages` (`/Type /Pages`, `/Count 1`, one `/Kids` entry) → `/Type /Page` with `/Parent` back to it; every reference resolves |
| P4-PDF-06 | A4 landscape | Page dictionary | Effective `/MediaBox [0 0 842 595]` (own or inherited); no `/Rotate` (or 0); no `/CropBox` smaller than the MediaBox |
| P4-PDF-07 | Streams (OQ-54) | Content stream | `/Length` equals the real stream length; decodes when unfiltered or FlateDecode |
| P4-PDF-08 | 35 dark squares filled black | Interpreted content | Exactly 35 black fills (`0 g`, `0 0 0 rg` or `0 0 0 1 k`), each an axis-aligned square 70.866 ± 0.01 pt on a side |
| P4-PDF-09 | Layout | Same | The squares sit on a 10 × 7 grid of pitch 70.866 ± 0.01 pt; counting rows from the top of the page, square (r, c) is black iff r + c is even, so square (0, 0) is top left; no light square is black |
| P4-PDF-10 | Centred (OQ-50) | Board bounding box | Centred on the page both ways within 0.5 pt (lower edge at 49.468 pt) |
| P4-PDF-11 | White background (OQ-55) | All fills | No fill other than the 35 squares, the scale bar and glyphs; nothing non-white under the board (the page's own white is the background) |
| P4-PDF-12 | Caption | Text runs and font resources | A Helvetica font (`/Subtype /Type1 /BaseFont /Helvetica`); effective size (Tf × text matrix × CTM scale) ≤ 10 pt; the decoded text equals "SceneGraph AR board · 10×7 squares, 9×6 inner corners · 25 mm squares · print at 100% (actual size)"; baseline below the board and above the page bottom; starts at x ≥ 0 |
| P4-PDF-13 | Caption encoding (OQ-51) | Font dictionary and string bytes | `/Encoding /WinAnsiEncoding`; · and × are the bytes 0xB7 and 0xD7 |
| P4-PDF-14 | 50 mm scale bar (OQ-52) | Fills and text below the board | A filled bar 141.732 ± 0.05 pt long, below the board, inside the page, with a "50 mm" label next to it |
| P4-PDF-15 | Reproducible bytes (OQ-53) | Two `GET()` calls | Identical bodies |
| P4-PDF-16 | PDF 1.4 only | Whole file | No cross-reference stream or object stream (`/Type /XRef`, `/ObjStm` absent) |

## 7. Real-photo fixtures (D12)

### 7.1 Files and manifest

- Photos are JPEG files scaled once to a 640 px long side with macOS `sips` (for example `sips -Z 640 IMG_0001.jpg --out tests/fixtures/board/01-desk-frontal.jpg`) and decoded in the tests with jpeg-js 0.4.4 (OQ-06). The test helper converts them to grey with the BT.601 formula itself, not with `rgbaToGray`.
- jpeg-js ignores the EXIF orientation tag, so annotations refer to the pixel grid as decoded. Either save the photo upright first, or annotate in the decoded frame.
- `tests/fixtures/board/manifest.json` is a JSON array of entries. It is an empty list until the photos are added, and the suite is skipped while it is empty.

```json
[
  {
    "file": "01-desk-frontal.jpg",
    "expect": "found",
    "device": "iPhone, rear camera 1x",
    "board": "paper",
    "conditions": ["frontal", "office light"],
    "corners": { "0": [112.5, 80.0], "8": [520.0, 84.5], "45": [110.0, 300.5], "53": [522.5, 298.0] },
    "notes": ""
  }
]
```

- `expect`: `"found"`, `"null"` or `"either"` (borderline photos, e.g. glare).
- `corners` (optional): approximate pixel positions of corners 0, 8, 45 and 53, annotated by hand with the O1–O3 rule: corner 0 is the inner corner next to a dark corner square such that, walking from it along the long side (i), the short side (j) lies clockwise on screen (cross > 0 with y down).

### 7.2 Checks

| ID | Clause | Setup / input | Expected |
| :--- | :--- | :--- | :--- |
| P1-FIX-01 | §9 manifest | Manifest and files | Valid schema; unique file names; at least 5 entries; every photo decodes to w · h grey values with a 640 px long side |
| P1-FIX-02 | §5.2 result | `expect: "found"` | Non-null, length 108 |
| P1-FIX-03 | O2 | Same | cross(p(1,0) − p(0,0), p(0,1) − p(0,0)) > 0 |
| P1-FIX-04 | O3 | Square centres located with a homography fitted to the result | Mean of the designated-dark squares ≥ 20 grey levels below the mean of the designated-light squares; square (0, 0) darker than the median designated-light square |
| P1-FIX-05 | §9 residual | `fitHomography(board corners, result)` | Geometric RMS residual ≤ 1.5 px (this also covers O1: a transposed or scrambled layout cannot fit) |
| P1-FIX-06 | §5.2 rejection | `expect: "null"`; `expect: "either"` | null; null or passes P1-FIX-02…05 |
| P1-FIX-07 | O1–O3 against a human label | Entries with `corners` | Result corners 0, 8, 45, 53 within 3 px of the annotations |
| P1-FIX-08 | Determinism, tracking hint | Two runs; `previous` = own result; `previous` = own result reversed (k ↔ 53 − k) | Identical runs; each hinted run passes P1-FIX-02…05 (and P1-FIX-07 when annotated) |

### 7.3 Suggested photo set (5–10 photos of the printed board)

| # | Content | expect |
| :--- | :--- | :--- |
| 1 | Frontal, even office light | found |
| 2 | Tilt ≈ 45° | found |
| 3 | Tilt ≈ 60°, board small in the frame | found |
| 4 | Board upside down (rotated 180° in the plane) | found |
| 5 | Board rotated ≈ 90° (long side vertical) | found |
| 6 | Strong glare or a shadow across the board | either |
| 7 | Slight motion blur | either |
| 8 | Part of the board outside the frame | null |
| 9 | A hand covering an inner corner | null |
| 10 | Optional: the board shown on a screen | either |

## 8. Manual checklist

Not automated: WebGL output (§5.6), UI behaviour U1–U12 (§5.7, copy included, OQ-04), the camera permission flow, devices. Each phase also ends with `npm run lint`, `npx tsc --noEmit` and `next build`.

### 8.1 P1

| ID | Clause | Steps | Expected |
| :--- | :--- | :--- | :--- |
| M1-01 | §9 | lint, tsc, build | Clean; the site is unchanged (the new modules are unused) |

### 8.2 P2

| ID | Clause | Steps | Expected |
| :--- | :--- | :--- | :--- |
| M2-01 | §12 worker bundling (OQ-60) | Add a temporary, uncommitted reference to `new Worker(new URL("./tracker.worker.ts", import.meta.url), { type: "module" })`, run `next build`, then remove it | A separate worker chunk is emitted and contains no three.js (search it for `WebGLRenderer`) |
| M2-02 | §9 | lint, tsc, build | Clean |

### 8.3 P3

| ID | Clause | Steps | Expected |
| :--- | :--- | :--- | :--- |
| M3-01 | U1, D10, D14, D9 | Home page over HTTPS (Vercel preview); over a LAN `http://` URL on a phone; on a WebXR device | The 「用摄像头看 AR」 / "Try camera AR" button appears only with a secure context and `getUserMedia`; bottom right of the hero viewport, before the WebXR buttons; the pointer hint is no longer shown there; on a WebXR device both kinds of buttons appear |
| M3-02 | U2 (P3), OQ-58 | Click the button; Back; reopen and ✕; reopen and Esc; load `?ar=camera` directly, then ✕; load `?ar=foo`; load `?ar=camera` where camera access is unsupported | `?ar=camera` is pushed; Back closes; ✕ and Esc call `history.back()` (the parameter disappears, no navigation away); a direct load opens the overlay and starts the camera at once (D6), and ✕ then replaces the URL without leaving the site; `?ar=foo` is ignored (no overlay, URL untouched); without camera support `?ar=camera` opens the overlay with the unsupported message |
| M3-03 | U3, OQ-57 | Open, try to scroll, close; also open from the URL where the entry button is hidden | The hero animation stops (FPS readout frozen); the page does not scroll; focus returns to the entry button, or to the hero viewport when there is none |
| M3-04 | U4 | Network panel on first load and on opening; `next build` output before and after | Tracker, pose and scene glue load only on opening; the home page bundle grows only by the button; the worker chunk has no three.js |
| M3-05 | U5, D2 | Phone in portrait and landscape; desktop window resized | Full screen above the navigation; `<video playsinline muted autoplay>` with `object-fit: cover`; corner markers sit on the printed corners at every aspect ratio; not mirrored (moving the board left moves it left on screen) |
| M3-06 | U6, D7, OQ-04 | Each status, in zh and en | Copy exactly as in U6; tracking fps; position "x … y … z … m · …°" in metres at 25 mm squares, with the note; with the phone ~30 cm above the board centre the readout shows y ≈ 0.30 m |
| M3-07 | U7, B2, B4 | Patch `getUserMedia` to reject with NotAllowedError, NotFoundError, OverconstrainedError, NotReadableError; delete `navigator.mediaDevices`; open `?ar=camera` over LAN `http://` | A short message and Close for denied, no-camera, failed, unsupported and insecure; denied explains how to allow camera access again |
| M3-08 | U8, OQ-56 | VoiceOver or an accessibility checker; keyboard only | `role="dialog"`, `aria-modal="true"`, an accessible name; focus on Close (✕ with an `aria-label`) on opening; Tab cycles inside the overlay; Esc closes |
| M3-09 | §5.6 `createCameraScene` | Track a board | Castle, corner rows coloured and connected like `drawChessboardCorners`, axes at corner 0 (red along i, green along j, blue out of the board towards the camera), blob shadow, scan ring; transparent canvas; no board mesh, dust, floor grid or pointer look |
| M3-10 | §5.6 `setPose`, D3 | Take the board out of view, then back | The castle stays ≈ 0.5 s, then disappears; it comes back with the board |
| M3-11 | D13 | Turn on reduced motion | Camera AR available; scan ring static |
| M3-12 | §5.6 `dispose`, B9 | Open and close 10 times | No WebGL context warnings; the canvas is removed; the camera indicator turns off after each close |
| M3-13 | §5.6 `setPaused` | Open and close while the hero runs; on a WebXR device start a session, then open the overlay if reachable | The hero loop stops while open and resumes afterwards; an XR session is unaffected |
| M3-14 | §9 fake stream | In the browser pane, replace `getUserMedia` with a canvas `captureStream(30)` of a moving rendered board; blank it for 1 s; patch it to reject | starting → searching → tracking; overlay follows the board; tracking held ≈ 0.5 s, then searching; error states as in M3-07 |
| M3-15 | Devices: iPhone Safari | Current iOS; rotate; lock and unlock | Permission prompt; rear camera (D4); no full-screen video takeover; ≥ 20 tracking results per second at 640×360 (§5.2); after rotation tracking recovers within ≈ 1 s |
| M3-16 | Devices: Android Chrome | Same | Same |
| M3-17 | Devices: desktop webcam | Chrome, Safari, Firefox | The default camera is used; not mirrored; both the `requestVideoFrameCallback` path and the `requestAnimationFrame` fallback track |
| M3-18 | Board on paper | Printed 10×7 board with 25 mm squares; office light; tilt 0–60°; 20–80 cm; glare; a hand over a corner | Stable tracking; with a corner covered the castle disappears rather than jumping |
| M3-19 | Board on a screen | Board image on a laptop or tablet (before P4: any image of the board) | Tracks despite moiré and glare; note the limits |
| M3-21 | §9 | lint, tsc, build | Clean |

### 8.4 P4

| ID | Clause | Steps | Expected |
| :--- | :--- | :--- | :--- |
| M4-01 | U2 (P4), D5, OQ-58 | Click on a desktop (no coarse pointer) and on a touch device; load `?ar=board` | Desktop pushes `?ar=board`, touch pushes `?ar=camera`; a direct load opens the board view |
| M4-02 | U7 (P4) | Any error state | Offers "Show the board instead" |
| M4-03 | U9 | Camera view | "Show board" switches to the board view; "Print board (PDF)" downloads `/chessboard.pdf` |
| M4-04 | U10, OQ-59 | Board view in portrait and landscape; wait past the screen timeout; leave the board view; close | The 10×7 board on a white panel with at least a half-square margin, as large as fits, square (0, 0) top left; the screen stays awake where the Wake Lock API exists; the lock is released on leaving the board view or closing |
| M4-05 | U11, OQ-04 | Desktop and touch, zh and en | Desktop: a QR code beside the board decoding to `${origin}/${lang}?ar=camera`, caption 「用手机扫码，对准这块屏幕」 / "Scan with your phone and point it at this screen". Touch: no QR code, caption 「用另一台设备的摄像头对准这块屏幕」 / "Point another device's camera at this screen" |
| M4-06 | U12, OQ-59 | "Use this device's camera"; a browser without camera support | Camera view; the URL parameter is replaced with `camera`; Back closes the overlay. Without camera support the action is hidden |
| M4-07 | §5.8 print | Open `/chessboard.pdf` in Preview and Chrome; print at 100 % on A4 | One landscape page; squares 25.0 ± 0.3 mm; scale bar 50.0 ± 0.5 mm with its label; caption legible; the print tracks (M3-18) |
| M4-08 | Q3 hand-off | Desktop board view → scan the QR code with an iPhone → point it at the screen | The camera starts at once (D6) and tracks the on-screen board |
| M4-09 | §2 static export | `next build`; preview deployment | `out/chessboard.pdf` exists and equals the route's body; it is served as `application/pdf` |
| M4-10 | §9 | lint, tsc, build | Clean |

## 9. Case counts and status

| Phase | Automated contract cases | Helper self-tests | Real-photo cases (D12) | Manual |
| :--- | ---: | ---: | ---: | ---: |
| P1 | 75 | 9 (H-01…H-08, H-11) | 8 | 1 |
| P2 | 105 | 0 | — | 2 |
| P3 | 41 | 1 (H-09) | — | 20 |
| P4 | 16 | 1 (H-10) | — | 10 |
| Total | 237 | 11 | 8 | 33 |

P1 Red check, 2026-11-02, against the skeleton (stubs throw `new Error("not implemented")`):
- `npx vitest run`: 92 tests in 7 files. 73 fail, each with `Error: not implemented`, and none for another reason. 11 pass: the 9 helper self-tests, plus P1-BRD-01 and P1-BRD-07, which check `BOARD`; the skeleton already implements it as a frozen constant. The 8 P1-FIX cases are skipped while the manifest is empty.
- `npx tsc --noEmit` and `npx eslint tests`: clean.
- All 305 catalogue scenes render without error, in about 6.5 s.

## 10. Resolved questions

Resolved on 2026-11-02. "A" and "B" refer to the options proposed in the first draft of this plan; the design's §14 lists the same resolutions.

### 10.1 Evidence behind OQ-18, OQ-23 and OQ-27

Throwaway, seeded Node scripts (not part of the repository) checked the statistical clauses before they were turned into tests.

`solvePlanarPnP`, noisy accuracy (OQ-18). 640×360, hfov 60° (f = 554.26 px), the 54 corners with σ 0.3 px per coordinate, board centred, depth chosen so that the projected board spans exactly the stated fraction of the width, random tilt axis and in-plane rotation. The estimator is Gauss–Newton on reprojection error started at the true pose, i.e. the maximum-likelihood estimate, the best any correct solver can do (the Cramér–Rao bound agreed).

| Tilt | Board width | P(rotation error > 0.5°) per trial | P(all 20 trials pass; bound 0.5° unless stated) |
| :--- | :--- | ---: | ---: |
| 0° | 1/3 | 67.5 % | 0.000 |
| 10° | 1/3 | 38.5 % | 0.000 |
| 20° | 1/3 | 7.7 % | 0.199 |
| 30° | 1/3 | 0.7 % | 0.860 |
| 45°, 60° | 1/3 | 0 % | 1.000 |
| Uniform 0–60° | 1/3 | — | 0.056 |
| Uniform 35–60° | 1/3 | maximum 0.44° in 3,000 trials | 1.000 |
| Uniform 0–35°, bound 3° | 1/3 | maximum 1.91° in 3,000 trials | 1.000 |
| Exactly 0°, bound 3° | 1/3 | maximum 3.34° in 3,000 trials | 0.993 |
| Uniform 20–60° | 1/2 | — | 0.993 |

Translation error: at most 0.27 % in 400 trials (tilt 0–60°, 1/3 of the width), well within 1 %.

`estimateFocal` (OQ-23, OQ-24). Closed form from a normalised-DLT homography, σ 0.3 px, 4,000 trials per row:

| Tilt | Board width | Median error | 99th percentile | P(error > 10 %) |
| :--- | :--- | ---: | ---: | ---: |
| 45° | 40 % | 0.63 % | 3.3 % | 0 % |
| 30° | 40 % | 0.94 % | 4.3 % | 0 % |
| 25° | 40 % | 1.2 % | 5.3 % | 0 % |
| 10° | 40 % | 4.0 % | 19 % | 12 % |
| 5° | 40 % | 13.5 % | 159 % | 61 % |

Exact data at tilt 30–60°: worst error 4 · 10⁻¹³. A fronto-parallel board placed off-centre (R = I) gives h31 = h32 = 0 to machine precision, and the closed form returned 6 · 10¹¹ px.

Corner filter (OQ-27, OQ-28). Defaults (minCutoff 1, beta 0.05, dCutoff 1), 30 fps:

| One Euro variant | 12 px x-step: first output within 0.5 px | 12 px diagonal step | Jitter std ratio, pooled / worst coordinate |
| :--- | ---: | ---: | :--- |
| α = 1/(1 + τ/T_e), derivative from the previous filtered value | 5 | 6 | 0.34 / 0.41 |
| α = 1/(1 + τ/T_e), derivative from the previous raw value (Casiez's reference C++) | 7 | 9 | 0.33 / 0.40 |
| α = 1 − exp(−T_e/τ), previous filtered value | 4 | 4 | 0.36 / 0.43 |
| α = 1 − exp(−T_e/τ), previous raw value | 5 | 7 | 0.35 / 0.42 |

Passing milliseconds where seconds are expected leaves 0.06 px of a 12 px step after one frame, i.e. almost no smoothing (OQ-01). Under OQ-27 only the behavioural clauses are tested, so an implementation must pick a variant that meets them; §7 recommends the derivative from the previous filtered value.

### 10.2 Table

| ID | Clause | Question | Chosen | Resolution | Cases |
| :--- | :--- | :--- | :--- | :--- | :--- |
| OQ-01 | §5.4 `createCornerFilter` | Unit of `time` in `apply(corners, time)` | A | Milliseconds, like `FrameInput.time` | P2-CF-*, P2-PIP-07 |
| OQ-02 | §5.5 deps, §8 | Must defaults be resolved lazily so tests run in Node? | A | Yes: a default is resolved only when its dependency is missing | P3-TRK-39 |
| OQ-03 | §4, §5.1 | How to check dependency directions and heroScene's use of `BOARD` | A | Static import-scan tests | P2-ARCH-01, P2-ARCH-02, P3-ARCH-01 |
| OQ-04 | §5.7 copy | Automate copy checks on `profile.ts`? | B | No: copy is checked manually only | M3-06, M4-05 |
| OQ-05 | §5.2 performance | Performance tests in the default suite? | A | Yes, with bounds 3× the targets (90 ms, 15 ms), medians logged | P1-PERF-* |
| OQ-06 | §9 real photos | Fixture image format | B (variant) | 640 px (long side) JPEG files scaled with macOS `sips`, decoded with the dev dependency jpeg-js 0.4.4 | P1-FIX-* |
| OQ-07 | §5.1 `BOARD` | Frozen at runtime? | A | Yes, `Object.freeze` | P1-BRD-07 |
| OQ-08 | §5.2 `rgbaToGray` | May `out` share memory with `rgba`? | A | No: unsupported, untested | P1-GRY-09 |
| OQ-09 | §1, §5.2 | Which lattice sizes carry the guarantees? | B (variant) | Only (9, 6) and (6, 9); other sizes appear only as negatives for rejection (d) | P1-DET-05, P1-DET-32; P1-DET-11 removed |
| OQ-10 | §5.2 rejection | What is a wrong answer outside nominal conditions? | A | Wrong length, O1–O3 violated, or a corner farther than 0.3 × the local spacing from its own true corner | P1-DET-35, P1-DET-52 |
| OQ-11 | §5.2 near-border allowance | Is the 3 px band two-sided, and must a result with cut outer squares be non-null? | A | Two-sided band; null-or-accurate (non-null is promised only under nominal conditions) | P1-DET-37, P1-DET-38 |
| OQ-12 | §5.2 nominal conditions | Contrast before or after the gradient; margin level | A | After the gradient, at every point; margin at the light-square level | P1-DET-18 |
| OQ-13 | §5.2 (c) | Which occlusions force null? | A | An occluder covering a disc of radius ≥ 0.3 square on an inner corner, or a destroyed corner → null; smaller partial occlusion and occluders away from corners → null-or-accurate | P1-DET-28, P1-DET-29, P1-DET-33 |
| OQ-14 | §1, §5.2 | Two complete boards in one image | A | null, or one of the boards meeting the guarantees | P1-DET-34 |
| OQ-15 | §5.2 tracking hint | How is "moved ≤ 0.25 square" measured? | A | Every corner's image displacement ≤ 0.25 × the shortest projected square edge; no extra envelope | P1-DET-40 |
| OQ-16 | §5.2 performance | Frames without a board | A | Same target as found frames (30 ms; tested at 90 ms) | P1-PERF-03 |
| OQ-17 | §5.2 result | Exactly sized result buffer? | A | Yes: byteOffset 0, byteLength = 8 · cornersX · cornersY | P1-DET-57 |
| OQ-18 | §5.3 noisy PnP | The 0.5° bound is unattainable near fronto-parallel views | A | Tilt 35–60°: rotation ≤ 0.5°; tilt 0–35°: rotation ≤ 3°; translation ≤ 1 % for both | P2-PNP-09 |
| OQ-19 | §5.3 exact accuracy | Envelope of the 1e−6 bound | A | The noisy-test envelope (board ≥ 1/3 of the width, tilt ≤ 60°) plus minimal N = 4 sets | P2-PNP-03, P2-PNP-04; P2-PNP-06 removed |
| OQ-20 | §5.3 degenerate | 4 points with 3 collinear | A | null unless the set contains 4 points with no three collinear | P2-PNP-12 |
| OQ-21 | §5.3 degenerate | Correspondences only a board behind the camera explains | A | null | P2-PNP-13 |
| OQ-22 | §5.3 validation | Non-finite and non-integer sizes; `viewMatrix` and `cameraPosition` arguments | A | `RangeError` for non-finite sizes; non-integer sizes allowed; `viewMatrix` and `cameraPosition` unvalidated | P2-INT-04, P2-FOC-01, P2-PM-06 |
| OQ-23 | §5.3 `estimateFocal` | Which tilt? | A | The angle between the board normal and the optical axis | P2-FOC-04…07 |
| OQ-24 | §5.3 `estimateFocal` | Conditions for "tilt ≥ 25° returns a value" | A | Exact or σ ≤ 0.3 px correspondences, board ≥ 40 % of the width, tilt 25–60° | P2-FOC-06 |
| OQ-25 | §5.3 `estimateFocal` | Degenerate point sets | A | null | P2-FOC-08 |
| OQ-26 | §5.3 `projectionMatrix` | Positive clip w and invertibility | A | w = k · Z with k > 0, and det P ≠ 0 | P2-PM-05 |
| OQ-27 | §5.4 corner filter | One Euro formulation | B | Behavioural clauses only; the formulation (derivative against the previous filtered value) is implementation guidance in §7; no reference-implementation comparison | P2-CF-09, P2-CF-11 |
| OQ-28 | §5.4 jitter clause | How is the output std measured? | A | Per coordinate over frames 11–300 of a 300-frame run | P2-CF-08 |
| OQ-29 | §5.4 step clause | Noise, distance and counting | A | Noise-free; Euclidean distance per corner; from the 6th output at the new position on | P2-CF-09, P2-CF-10 |
| OQ-30 | §5.4 focal tracker | Median of an even count | A | Mean of the two middle values | P2-FT-06 |
| OQ-31 | §5.4 focal tracker | Non-finite or non-positive estimates | A | Ignored like null | P2-FT-11 |
| OQ-32 | §5.4, §5.5 options | Option validation | A | `RangeError` on creation or start | P2-OPT-01, P3-TRK-40 |
| OQ-33 | §5.4 steps 2, 4 | Hint after a frame whose PnP returned null | A | Keep its raw corners as the hint | P2-PIP-06 |
| OQ-34 | §5.4 step 3 | Not-found `intrinsics` | A | { fx = fy = tracker.focal(width), cx = (width − 1)/2, cy = (height − 1)/2 } | P2-PIP-22 |
| OQ-35 | §5.4 `process` | Malformed frames | A | `RangeError`; pipeline state unchanged | P2-PIP-21 |
| OQ-36 | §5.4 `handleWorkerMessage` | Error text; non-object messages | A | `error.message` for an `Error`, `String(value)` otherwise; non-objects return null without throwing | P2-WRK-07, P2-WRK-08 |
| OQ-37 | §5.5 `TrackingUpdate` | `intrinsics` and `frame` outside tracking | A | null until the first reply, then the latest reply's values, also while searching | P3-TRK-01, P3-TRK-37 |
| OQ-38 | §5.5 B7 | Hold boundary; held fields | A | ≤ holdMs counts as within; a held update carries the last found reply's intrinsics and frame | P3-TRK-26 |
| OQ-39 | §5.5 B8 | fps window boundary | A | now − t < 1000 ms counts, the current reply included | P3-TRK-28 |
| OQ-40 | §5.5 B2 | Timing of the insecure/unsupported update | A | After `startCameraAR` returns | P3-TRK-38 |
| OQ-41 | §5.5 B4 | `play()` rejections | A | Always `failed` | P3-TRK-09 |
| OQ-42 | §5.5 B4 | Exceptions thrown by dependencies | A | error/failed: terminal, resources released | P3-TRK-12 |
| OQ-43 | §5.5 B9 | Late `getUserMedia` after `stop()` | A | Its tracks are stopped; `srcObject` is not set; `play()` is not called | P3-TRK-31 |
| OQ-44 | §5.5 B9 | Idempotence of `stop()` | A | `terminate()` and each track's `stop()` exactly once | P3-TRK-30 |
| OQ-45 | §5.5 B6, B7 | Frame ids and stray replies | A | Ids strictly increase; a reply with another id is ignored | P3-TRK-20 |
| OQ-46 | §5.5 B6 | Worker that never replies | A | No watchdog (out of scope) | — |
| OQ-47 | §11 in-thread fallback | "Every other frame" vs one frame in flight | — | The fallback is removed from the design; its case is dropped | P3-TRK-41 removed |
| OQ-48 | §5.5 B6 | Rounding of the analysis size | A | `Math.round`; each side ≥ 1 | P3-TRK-17 |
| OQ-49 | §5.5 B6 | `time` of a posted frame | A | `deps.now()` at capture | P3-TRK-15 |
| OQ-50 | §5.8 | Meaning of "centred" | A | On the page centre both ways | P4-PDF-10 |
| OQ-51 | §5.8 caption | · and × with Helvetica | A | The exact characters through `/WinAnsiEncoding` (bytes 0xB7, 0xD7) | P4-PDF-12, P4-PDF-13 |
| OQ-52 | §5.8 scale bar | Form and label | A | A filled bar 141.73 pt long with a "50 mm" label | P4-PDF-14 |
| OQ-53 | §5.8 | Byte-identical output | A | Required | P4-PDF-15 |
| OQ-54 | §5.8 structure | EOL after `%%EOF`; compressed content | A | One EOL allowed; unfiltered or FlateDecode | P4-PDF-03, P4-PDF-07 |
| OQ-55 | §5.8 | White background | A | Implicit: no non-white fill under the board | P4-PDF-11 |
| OQ-56 | §5.7 U8 | Focus trap | A | Tab cycles inside the overlay | M3-08 |
| OQ-57 | §5.7 U3 | Focus on close without an entry button | A | The hero viewport | M3-03 |
| OQ-58 | §5.7 U2 | Unknown `?ar` values; `?ar=camera` without camera support | A | Unknown values are ignored; `?ar=camera` without support opens the overlay with the unsupported message | M3-02, M4-01 |
| OQ-59 | §5.7 U10, U12 | Board view without camera support; wake lock release | A | "Use this device's camera" hidden without camera support; the lock is released on leaving the board view or closing | M4-04, M4-06 |
| OQ-60 | §10, §12 | Worker bundling check in P2 | A | A temporary, uncommitted reference in P2 | M2-01 |

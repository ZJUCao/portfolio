# Design: Space-cut transitions

Status: **Confirmed 2026-11-06**, D1–D9 and OQ-1–OQ-5 all settled as recommended; **the P0 spike is done** (§12), P0-1 and P0-2 adopted on 2026-11-06; the P1 engine is merged (PR #5); P2 is merged (PR #6); P3 is merged (PR #7); **P4 is done** (2026-11-06), awaiting review, see §13 · Based on: [requirements](requirements_space_cut.md) (confirmed) · Phases: P0–P5 (§9)

## 1. Goal

Build the transitions from the requirements into the portfolio. Section 4 of the requirements lists the entrances: camera AR, the language switch, the 404 page, an easter egg in the home page's 3D viewport, and project card to detail page, plus gesture mode.

All entrances share one cut engine. It is ported from the prototype, rewritten as TypeScript modules and covered by tests.

Out of scope: everything listed in §8 of the requirements.

## 2. Facts this design rests on

| Fact | Consequence |
| :--- | :--- |
| The language switch is a client-side navigation. Checked on 2026-11-06 against the 11-04 static build served locally: a JS variable on the page survives the switch | Same-document view transitions work. But P0 found that React does not start a view transition on a language switch, so the site has to call `document.startViewTransition` itself (§12) |
| Going from the 404 page to the home page is a full page load (checked the same day) | The 404 page cannot use view transitions and has to cut open in place |
| During a view transition the old page is a still snapshot. Per the spec, the new page (`::view-transition-new`) is live | The cut's rim and dust can be drawn on their own named element and keep moving during the transition. **P0 confirmed it is live in Chromium (§12)** |
| In this project's `@types/react`, `ViewTransitionInstance` has only a `name` field | The cut shape does not rely on React's instance object; `document.documentElement.animate({ clipPath }, { pseudoElement: "::view-transition-new(…)" })` drives it instead. **P0 confirmed it works in Chromium; Safari and Firefox not tested (§12)** |
| Camera AR is a full-screen `fixed` overlay portaled to `document.body`, with its state in `?ar=` (`CameraAR.tsx`, `HeroViewport.tsx`) | Camera AR cuts open in place: the overlay itself gets the `clip-path`, and the window shows the live view |
| The home page's 3D scene already draws OpenCV-style corners and axes (`corners()` and `axes()` in `heroScene.ts`) | The easter egg's engineering view cannot be just corners and axes; it has to show things the normal view does not (§3 D3) |
| three.js's `WebGLRenderer` defaults to `stencil: false` | The easter egg uses the stencil buffer, so `createRenderer` has to turn it on |
| The project detail page has no header image today, only the title, summary, buttons and README | Q7's "the card grows into the detail page's header image" means adding a header image to the detail page. That conflicts with §8 of the requirements, "no changes to the content or layout of existing pages", and the requirements were changed to allow it (§11 OQ-2, requirements D6) |
| `Reveal` brings elements in from opacity 0 and 32 px lower | Elements in a shared-element transition cannot sit inside a `Reveal` |
| The npm package of MediaPipe Tasks Vision 1.1.1 contains the runtime (wasm and JS) but not the hand model; the model, 7.8 MB, lives on Google's storage | The runtime can be copied from `node_modules`; the model has to be fetched separately (§3 D6) |
| A GitHub Action redeploys the site every day (`.github/workflows/refresh-projects.yml`) | If the build downloads the model, a failed download must not fail the daily deploy |

## 3. Decisions

All adopted as A on 2026-11-06.

| # | Decision | Adopted (A) | Not adopted (B) |
| :--- | :--- | :--- | :--- |
| D1 | How the knife and the wand coexist in the home page's viewport and on the 404 page | One gesture vocabulary: the wand tip lights up and space starts dissolving the moment of the press; if the pointer moves more than 10 px within 250 ms, the light goes out and it becomes a knife stroke; if it stays still, it is the wand. No tool switch | A "knife / wand" toggle button |
| D2 | How one engine handles both "cut open in place" and "change page" | One engine, two kinds of target: in place, it sets `clip-path` on a real element; for a page change, view transitions plus Web Animations drive the `clip-path` of `::view-transition-new` | Page changes also cut in place, rendering the new page underneath first (two pages mounted at once, too heavy) |
| D3 | How the easter egg's engineering view is drawn | A stencil "portal" in the same WebGL canvas: the normal view outside the window; wireframes, normal shading, and each scene graph node's bounding box and local axes inside it | A second canvas (a second WebGL context) laid over it with a CSS `clip-path` |
| D4 | What the 404 page shows through the window | An iframe of the home page, with the language picked by the same rules as the root path `/`; after stepping through, a full page navigation | Cross-document view transitions (fewer browsers support them) |
| D5 | Where the gesture cursor works | Only inside the home page's 3D viewport: the camera picture maps to the viewport, not the whole screen; gestures cut the easter egg and can pinch the buttons inside the viewport | A cursor over the whole page that can pinch any link |
| D6 | How the gesture model and runtime get into the site | The runtime is an npm dependency pinned to 1.1.1, and the build copies its wasm to `public/mediapipe/`. The model is downloaded at build time, checked against a SHA-256 hash and kept in an uncommitted folder; if the download fails, the build still completes, hides the gesture switch and prints a warning | Commit the 7.8 MB model to the repo |
| D7 | Project card to detail page | Add a header image to the detail page, using the card's cover or line drawing; the card's cover grows into it | No header image; only the card's title grows into the detail page's heading |
| D8 | Keyboard | Follows each entrance's stop setting: at entrances that stop (camera AR, the easter egg), Enter opens a medium window and stops; at entrances that do not (the language switch, the 404 button), Enter cuts straight through. The home page's viewport becomes reachable with Tab, and Enter opens a window at its center | Every entrance stops first |
| D9 | Duration of click-triggered transitions | Draw the line 120 ms, pause 40 ms, open 200 ms, expand 480 ms: 840 ms in total (the prototype takes 1,040 ms; the requirements allow at most 1 s) | Keep the prototype's 1,040 ms |

## 4. Modules

| Module | Responsibility | Must not depend on | Phase |
| :--- | :--- | :--- | :--- |
| `src/cut/geometry.ts` | Pure functions: line fitting and checks, lens windows, the moving hole, how far to scale to cover the screen, the auto-cut line, point in polygon, polygon to `clip-path` | DOM, React | P1 |
| `src/cut/timeline.ts` | Cancellable tweens and easing curves; the clock and frame scheduler are passed in, for tests | DOM, React | P1 |
| `src/cut/gesture.ts` | Input state machine: mouse, touch, pen, hand and keyboard events become intents such as stroke, wand, click, inside and outside the window, including the D1 rule | DOM, React | P1 |
| `src/cut/dust.ts` | Dust particles: at most 1,500, canvas at no more than 2× pixel ratio | React | P1 |
| `src/cut/engine.ts` | The cut engine: moves between idle, drawing, dissolving, opening, at the window, stepping through and closing; draws the rim, ripples and dust; sets the window shape through the target's interface. Its core, `createCutController`, does not touch the DOM; `createCut` wires it to a real element | React | P1 |
| `src/cut/fxLayer.ts` | The DOM side of the effect layer: an SVG for the rim, ripples, knife stroke and wand tip, and a canvas for the dust. Colors are set in style, because SVG attributes cannot read CSS variables | React | P1 |
| `src/components/CutLayer.tsx` | React wrapper: mounts the effect layer and passes pointer events to the engine; it catches the pointer only while a cut is under way or where the knife or wand is on, and otherwise lets clicks through. Keyboard stays with each entrance, which calls the engine's methods | | P2 |
| `src/cut/pageCut.ts` | Page-change cuts: draws the line on the effect layer first, then wraps the navigation in `document.startViewTransition` and drives `::view-transition-new(root)` (P0-1 and P0-2 in §12) | React components | P2 |
| `Nav.tsx` | The language button: prefetches the other language's page on pointer enter or focus; on click, stops the default navigation and hands it to `pageCut` | | P2 |
| `HeroViewport.tsx`, `CameraAR.tsx` | Camera AR entrance: clicking the button cuts from it, and the window first shows "Opening the camera" (Q9) | | P2 |
| `global-not-found.tsx` and its client component | The 404 cut, with an iframe of the home page behind the window | | P3 |
| `heroScene.ts` | Turn on the stencil buffer; the easter egg's portal and the engineering-view pass | React | P3 |
| `src/cut/hint.ts` | Show the "hold" hint the first time and remember it in local storage (every read and write in try/catch) | React | P3 |
| `src/cut/hand/oneEuro.ts`, `pinch.ts`, `mapping.ts`, `handInput.ts` | Pure gesture functions: smoothing, the pinch check (with hysteresis), mapping picture coordinates to the viewport, and turning one hand into input events frame by frame | DOM | P4 |
| `src/cut/hand/tracker.ts` | Opens the camera, loads MediaPipe from the site, detects hands each frame; blocks MediaPipe's usage logs to Google | React | P4 |
| `src/components/HandMode.tsx` | Gesture mode's UI: the camera window and the cursor; passes the hand's events to the easter egg's cut engine and clicks buttons it pinches | | P4 |
| `scripts/fetch-mediapipe.mjs` | Before the build, copies the runtime and downloads and checks the model (D6) | | P4 |
| `src/data/profile.ts` | New copy in Chinese and English, including the camera line in the privacy page | | P2–P4 |
| Project detail page, `ProjectCard.tsx` | The detail page's header image and the shared-element transition (D7) | | P5 |

Dependency direction: the pure parts (`geometry`, `timeline`, `gesture`, `hand/*`) never touch the DOM; `engine` uses the DOM but not React; React components only wire them together.

## 5. Interface contracts

### 5.1 `src/cut/geometry.ts`

```ts
export type Pt = readonly [number, number];
export type Size = { width: number; height: number };
export type Line = { mid: Pt; dir: Pt; normal: Pt; halfLength: number; deviation: number };
export type InputSource = "mouse" | "touch" | "pen" | "hand" | "keyboard";

export function fitLine(points: readonly Pt[]): Line; // principal component analysis
export function checkStroke(line: Line, viewport: Size, source: InputSource): "ok" | "too-short" | "not-straight";
export function lensPoints(line: Line, scale: number, halfWidth: number, sharpness: number, n?: number): Pt[];
export function lensCoverScale(line: Line, halfWidth: number, viewport: Size): number;
export type Blob = { center: Pt; harmonics: readonly { k: number; amp: number; phase: number; speed: number }[] };
export function makeBlob(center: Pt, random: () => number): Blob;
export function blobPoints(blob: Blob, radius: number, wobble: number, timeSeconds: number, n?: number): Pt[];
export function blobCoverScale(blob: Blob, radius: number, viewport: Size): number;
export function autoCutLine(at: Pt, viewport: Size, random: () => number): Line;
export function inPolygon(p: Pt, polygon: readonly Pt[]): boolean;
export function toClipPath(polygon: readonly Pt[]): string; // "polygon(…px …px, …)"
```

All thresholds come from `src/cut/constants.ts` (§7). Randomness is passed in so tests can fix it.

### 5.2 `src/cut/engine.ts`

The engine owns the recognizer from `gesture.ts`: callers only normalize pointer, hand and keyboard events into `GestureEvent`s (coordinates in px of the effect layer's own box) and pass them to `input`.

```ts
export type Phase = "idle" | "drawing" | "growing" | "opening" | "peek" | "through" | "closing";
export type CutTarget = {
  setWindow(polygon: readonly Pt[] | null): void; // null: the window covers everything and the target is fully revealed; []: fully hidden
  setParallax?(dx: number, dy: number, scale: number, origin: Pt): void;
  setFade?(opacity: number): void; // reduce motion: the crossfade that replaces the cut
};
export type CutOptions = {
  stop: boolean; // whether to stop at the window
  tools: { knife: boolean; wand: boolean; click: boolean };
  reducedMotion: boolean;
  onPhase?(phase: Phase): void;
  onReject?(reason: "too-short" | "not-straight"): void; // for the hint line
  onThrough(): void;
  onClose(): void;
};
export type Cut = {
  input(event: GestureEvent): void; // down / move / up / cancel / key
  clickAt(p: Pt): void;             // click to cut
  openCentered(): void;             // keyboard: a medium window at the center, stopping there (D8)
  stepThrough(): void;
  close(): void;
  reset(): void;                    // drops whatever is in progress and hides the target, e.g. on resize
  isInsideWindow(p: Pt): boolean;   // lets the caller set the pointer cursor
  readonly phase: Phase;
  destroy(): void;
};
export function createCut(fx: HTMLElement, target: CutTarget, options: CutOptions): Cut;
// The DOM-free core: tests pass a fake clock and renderer (fxLayer.ts is the real renderer)
export function createCutController(renderer: CutRenderer, target: CutTarget, options: CutOptions, deps: { clock: Clock; random: () => number }): Cut;
```

### 5.3 `src/cut/pageCut.ts`

```ts
export const CUT_TYPE = "cut";       // the cut's view transition type
export const FADE_TYPE = "cut-fade"; // the reduce-motion crossfade (200 ms)
export const PAGE_CUT_MS = 680;      // the part inside the transition: the lens opens in 200 ms, then expands in 480 ms
export function pageCutWindow(line: Line, viewport: Size, ms: number): { polygon: Pt[]; rim: RimStyle }; // pure: the window and rim at a moment
export function pageCutKeyframes(line: Line, viewport: Size): Keyframe[]; // pure: that curve sampled at steady steps into keyframes
export function cutNavigate(options: {
  origin: Pt;           // center of the language button
  navigate(): void;     // router.push(target)
  arrived(): boolean;   // whether the new page is in, e.g. <html lang> is already the target language
  reducedMotion: boolean;
}): Promise<void>;      // without view transition support it only calls navigate(); if the new page takes over 3 s it goes on anyway
// pageCut creates the effect layer itself, on body, named cut-fx only during the transition.
// If React clears it when the root layout remounts, the update callback puts it back (P2: it was still there after every switch)
```

### 5.4 `src/cut/hand/*`

```ts
export function oneEuro(minCutoff: number, beta: number, dCutoff?: number): { filter(v: number, tMs: number): number; reset(): void };
export function pinchRatio(landmarks: readonly Landmark[], aspect: number): number; // fingertip gap over palm length, corrected for the picture's aspect
export function pinchState(prev: boolean, ratio: number): boolean; // pinched below 0.30, released above 0.45
export function handToViewport(landmarks: readonly Landmark[], region: Region, box: Size): Pt; // mirrored
// Turns one hand, frame by frame, into the same input events as a mouse (source "hand"): open is a move, a pinch is a press, opening or a hand missing for over 300 ms is a release
export function createHandInput(options?: { region?: Region; lostMs?: number }): {
  frame(landmarks: readonly Landmark[] | null, t: number, aspect: number, box: Size): { cursor: Pt | null; state: "none" | "open" | "pinched"; events: GestureEvent[] };
  release(t: number): GestureEvent[]; // switching off cancels a held pinch
  reset(): void;
};
// Opens the front camera, loads the runtime and model from the site's /mediapipe (GPU first, then CPU) and reports one hand's landmarks for every new video frame
export function startHandTracking(video: HTMLVideoElement, onFrame: (frame: HandFrame) => void, options?: { base?: string; signal?: AbortSignal; onStatus?(status: "camera" | "model" | "ready"): void }): Promise<{ stop(): void; setPaused(paused: boolean): void }>;
// Throws HandTrackingError with reason "unsupported" | "denied" | "no-camera" | "model" | "aborted"
export function blockUsageLogging(): void; // see §13, P4: keeps MediaPipe's usage logs from going to Google
```

## 6. Flow at each entrance

### 6.1 Language switch (click to cut, no stop)

1. When the pointer moves onto the language button or the button gets focus, `router.prefetch` the other language's page (P0-2).
2. On click (a left click without modifier keys, or Enter), `onClick` stops `Link`'s default navigation and calls `cutNavigate`. Ctrl- or Cmd-click and middle-click still open a new tab as before.
3. First the line is drawn on the live page: the effect layer draws the line from `autoCutLine` out of the button's center in 120 ms, then pauses 40 ms (D9), while the page data loads.
4. Then `document.startViewTransition({ update, types: ["cut"] })` is called. `update` runs `router.push` and uses a MutationObserver to resolve once `<html lang>` becomes the target language; it must not wait for `requestAnimationFrame` (§12.1).
5. Once the transition is ready, Web Animations plays `pageCutKeyframes` on the `clip-path` of `::view-transition-new(root)`: the lens opens in 200 ms, then expands to fill the screen in 480 ms. The whole page is cut, header included. The old page stays underneath thanks to `html:active-view-transition-type(cut)::view-transition-old(root) { animation: none }`.
6. The effect layer is live during the transition (confirmed in P0) and keeps drawing the cyan rim; its old snapshot is hidden with `display: none` and its group gets a `z-index`.
7. With reduce motion on, a 200 ms crossfade instead. Browsers without support switch directly.

### 6.2 Camera AR (click to cut, stops at the window)

1. Clicking "Try camera AR" makes `HeroViewport` remember the button's center and `pushState(?ar=…)` as today.
2. When `CameraAR` mounts, the overlay starts fully clipped (an empty window); the engine then cuts automatically from the button's center and stops at a medium window.
3. On phones, until the camera shows a picture, the middle of the window shows "Opening the camera" (the existing `cameraAR.starting` copy), and the view fades in when it arrives (Q9).
4. Click inside the window or press Enter: step through, and the overlay fills the screen as it does after opening today. Click outside or press Esc: the window closes and the existing `closeCameraAR` runs, so the Back button behaves as before.
5. Focus: while at the window, focus is on the overlay's close button (existing behavior); Enter then only steps through and does not press the close button.
6. While at the window, a hint line at the bottom of the screen says: click inside or press Enter to step in, click outside or press Esc to close.
7. If the window size changes while at the window, the overlay opens fully. Until the overlay covers the screen, the home page's 3D scene keeps running.

### 6.3 404 page (knife or wand, no stop)

1. A `CutLayer` covers the page, and the D1 gestures work anywhere on it (the 404 page does not scroll, which fits Q8).
2. When the page is idle (`requestIdleCallback`, or a 1 s timer where unsupported), a hidden iframe preloads the home page picked by the root path's rules (`/zh` or `/en`) as the world behind the window. It points straight at the language page, without the `/` redirect.
3. The window opens and expands without stopping; when it is done, `location.replace(home page)`. The iframe shows the same content as the real home page, so the navigation is only a brief reload.
4. The "Back to home" button becomes click to cut, and so does Enter on it.

### 6.4 Easter egg in the home page's 3D viewport (knife or wand, stops)

1. Pressing inside the viewport (not on a button) goes through the D1 rule to pick the knife or the wand. The camera stops following the pointer while drawing.
2. The engine's target is `heroScene`'s portal interface:
   - Each frame renders the normal pass first.
   - It then converts the window polygon to normalized device coordinates, draws it into the stencil buffer and fills it with the background color.
   - Finally it draws the engineering-view pass only where the stencil value is 1 (D3).
3. The window can stay open. Clicking inside it steps through, so the whole viewport becomes the engineering view; cutting again from there returns to the normal view.
4. The viewport can be focused with Tab (D8), and Enter opens a window at its center.

### 6.5 Gesture mode (Q11, Q13, D5)

1. A "Try it with your hand" switch next to the viewport, shown only on computers (no coarse pointer). The camera and the model load only after it is turned on.
2. The mapped area of the camera picture corresponds to the viewport, so the cursor stays inside it. A pinch is a press, and its events go to the viewport's `CutLayer` along the same path as the mouse. Pinching on a button clicks it.
3. Detection pauses when the viewport scrolls off screen; turning the switch off turns the camera off.
4. The small camera window sits in a corner of the viewport and shows the skeleton, the mapped area and the state.

### 6.6 Project card to detail page (D7)

The card's cover and the detail page's header image are both wrapped in `<ViewTransition name={"cover-" + slug} share="morph" default="none">`, and the header image sits outside any `Reveal`. Going back to the list plays it in reverse.

## 7. Parameters

All in `src/cut/constants.ts`. The values below are taken from the prototype, except the D9 durations.

| Parameter | Value |
| :--- | :--- |
| Knife: minimum length | 20% of the screen's short side, and at least 110 px |
| Knife: maximum deviation | 12% of the length; 16% for hand gestures |
| Knife: half-width when stopped at the window | 34% of the half length, between 26 px and 24% of the short side |
| Wand: start delay, longest hold, largest radius, smallest radius, settle after release | 120 ms, 1.6 s, 36% of the short side, 10% of the short side, 350 ms |
| Click to cut | Line 120 ms, pause 40 ms, open 200 ms, expand 480 ms (D9) |
| Step-through expansion | 780 ms |
| D1 rule | Moving more than 10 px within 250 ms is a stroke; 40 px for hand gestures |
| Dust | At most 1,500 particles, canvas at no more than 2× pixel ratio |
| Colors | Knife `--accent`; wand `--cat-engines` (`#fbbf6a`, Q10) |
| Gestures | Pinch at 0.30, release at 0.45; mapped area with 12% margins left, right and top and 18% at the bottom; a hand missing for 300 ms is a release; One Euro 1.2 / 0.012 |

## 8. Test strategy

- **Unit tests** (Vitest, `node` environment, in `tests/cut/`):
  - `geometry`: fitting, checks, window shapes, cover scales, point in polygon.
  - `timeline`: tweens and cancellation with a fake clock.
  - `engine`: every flow with a fake clock and renderer (knife, wand, D1, click-to-cut timing, inside and outside the window, keyboard, reduce motion, reset and destroy).
  - Architecture: the modules in `src/cut` depend only along §4, and the pure ones use no browser globals.
  - `gesture`: the D1 thresholds, every input source, release and cancel.
  - `pageCutKeyframes`: every keyframe has the same number of points, and the last one covers the screen.
  - `hand/*`: One Euro, pinch hysteresis, mirrored mapping.
  - The checksum function in `fetch-mediapipe`.
  - `hint`: no errors when local storage is unavailable.
- **Browser pane**:
  - Every entrance.
  - Reduce motion and keyboard use.
  - Unsupported view transitions: with `document.startViewTransition` deleted, pages should switch directly.
  - Gestures with simulated landmarks, as in the prototype.
- **Real devices and your camera**: iPhone Safari, Android Chrome, and desktop Chrome, Edge, Firefox and Safari; you try the gestures on your PC webcam.
- **Build checks**: `npm run lint`, `npx tsc --noEmit` and `npm run build` stay clean, and the home page's first-load JS does not grow, because all effect code loads on demand.

## 9. Phases and size estimate

| Phase | Contents | Lines changed (est.) | Site after this phase |
| :--- | :--- | :--- | :--- |
| P0 Spike | **Done 2026-11-06, results in §12.** On a branch that is never merged, check four things: whether Web Animations can drive the `clip-path` of `::view-transition-new` inside a view transition; whether `<ViewTransition>` fires `onEnter` on a language switch (the root layout's param changes, so the page should remount); whether a named effect layer is live during the transition; and the three.js stencil portal | ~150, thrown away | Unchanged |
| P1 Engine | **Done 2026-11-06, awaiting review.** `geometry`, `timeline`, `gesture`, `dust`, `engine`, `fxLayer`, `constants` and their tests | ~900 | Unchanged (the new modules are not used yet) |
| P2 Camera AR and language switch | **Done 2026-11-06, awaiting review, see §13.** `CutLayer`, `pageCut`, `Nav`, `HeroViewport`, `CameraAR`, copy | ~450 | F3, F8 and F9 usable |
| P3 404, easter egg, hint | **Done 2026-11-06, awaiting review, see §13.** The 404 client component, the portal and engineering view in `heroScene`, `hint` | ~600 | F1, F2, F4, F7, F10 and F11 usable |
| P4 Gesture mode | **Done 2026-11-06, awaiting review, see §13.** `hand/*`, `fetch-mediapipe`, the switch, the camera window, privacy copy | ~550 | F13 usable (computers only) |
| P5 Project cards | The detail page's header image and the shared-element transition | ~120 | F14 usable |

About 2,600 lines in total (excluding P0), not counting tests and docs. Each phase follows skeleton → tests (Red) → implementation (Green) → verification, then stops for review and updates the status in §5 of the requirements.

## 10. Risks

| Risk | Mitigation |
| :--- | :--- |
| Browsers differ in Web Animations support for view transition pseudo-elements, Safari in particular | P0 confirmed it works in Chromium; Safari and Firefox not tested, and browsers that cannot do it get a crossfade |
| The effect layer is not live during view transitions | P0 confirmed it is live in Chromium; in browsers where it is not, use only the window shape and drop the rim and dust |
| The first language switch has to wait for the new page's data, so the screen freezes for a few hundred milliseconds before the transition starts (P0 measured 326 ms in the static build) | P0-2 in §12.2: prefetch the other language's page, and on click draw the line on the live page before starting the transition |
| The stencil pass plus a second render is too slow on phones | Draw the second pass only while a window is open, with simple materials for the engineering view |
| MediaPipe's size and phone performance | Computers only at first (Q13); loaded on demand |
| The model download fails during the build | D6: the build still completes and the gesture switch is hidden |
| Drawing conflicts with the home page camera following the pointer | Pause the follow while drawing or dissolving |
| `Reveal`'s transforms affect `fixed` elements | Overlays and effect layers keep the existing approach and are portaled to `document.body` |

## 11. Resolved questions

All settled as recommended on 2026-11-06. OQ-2 changed the requirements and is recorded there as D6.

| # | Question | Resolution |
| :--- | :--- | :--- |
| OQ-1 | Are D1–D9 all fine as recommended (A)? | Yes |
| OQ-2 | D7 adds a header image to the project detail page, which changes an existing page's layout and conflicts with §8 of the requirements. May the requirements change to add it? | Yes: the header uses the card's image and sits above the title |
| OQ-3 | What the easter egg's engineering view shows | Wireframes, normal shading, and each scene graph node's bounding box and local axes; leave out the home camera's frustum for now |
| OQ-4 | How to get back to the normal view after stepping through in the easter egg | Cut again to switch back; Esc also returns directly |
| OQ-5 | What happens to the language switch if the P0 results are poor (Safari lacking support, say) | Unsupported browsers get a crossfade; supported ones cut as designed |

## 12. P0 results (2026-11-06)

Checked on the `spike/space-cut-p0` branch with throwaway pages `/[lang]/spike/{named,auto,stencil}`, once on the dev server and once on the static build (`out/`). The only browser was the Chromium 152 built into the Claude desktop app (Windows, pixel ratio 1.5); Safari, Firefox and phones were not tested. The throwaway code will not be merged.

| # | Check | Result | Evidence |
| :--- | :--- | :--- | :--- |
| 1 | Web Animations driving the `clip-path` of `::view-transition-new` | **Works** | Both `document.documentElement.animate(frames, { pseudoElement: "::view-transition-new(root)" })` and `instance.new.animate(frames)` on React's instance ran the full 840 ms, and `polygon()` values with the same number of points interpolate. The old page needs `animation: none` to stay; otherwise it fades out with the browser's default animation and everything outside the cut goes black |
| 2 | `<ViewTransition>` firing `onEnter` on a language switch | **Does not fire** | On a navigation within one language, `onEnter` and `onExit` both fire, with `cut` in `types`. On a language switch the page still remounts on the client, but React never calls `document.startViewTransition`, so none of the four callbacks fire; the dev server and the static build behave the same. The cause is somewhere inside React or Next; I did not pin it down |
| 2′ | Workaround: wrap the language navigation in `document.startViewTransition` ourselves | **Works** | The `update` callback triggers the navigation and resolves once `<html lang>` changes (a MutationObserver), then `::view-transition-new(root)` is animated. From click to transition ready: 54–74 ms on the dev server for pages already visited; 326 ms for the first switch in the static build, during which the screen stays frozen on the old page |
| 3 | A named effect layer is live during the transition | **Yes** | An SVG with `view-transition-name: cut-fx` changes a line's angle every frame; with the transition stretched to 6 s, two screenshots taken during it show the line at different angles. `requestAnimationFrame` keeps running during the transition (201 and 360 frames in two 6 s runs) |
| 4 | three.js stencil portal | **Works** | `WebGLRenderer({ stencil: true })` gets a stencil buffer. Inside the lens window: normal shading, wireframes, bounding boxes and local axes; outside it, the normal view; 60 fps. Only tried in a simple test scene, not in the home page's real scene |

### 12.1 Pitfalls (P1–P3 must follow these)

- The view transition's `update` callback must not wait for `requestAnimationFrame`: the browser does not render during it, so rAF never fires and the transition is abandoned after a 4 s timeout.
- Turn off the whole-page default crossfade only for transitions of type `cut`: set `animation: none` on `html:active-view-transition-type(cut)::view-transition-old(root)` and `…::view-transition-new(root)`, so other transitions are unaffected.
- The effect layer's group needs a `z-index`, or the new page's group, added later, covers it; hide its old snapshot with `display: none`.
- Stencil mask: with the orthographic camera at `z = 0`, a mask at `z = 0` sits exactly on the near plane and is clipped, so move the camera to `z = 0.5`; give the mask material `DoubleSide` so triangle winding does not matter.
- `@types/react` declares only `name` on `ViewTransitionInstance`, but at runtime it also has `group`, `imagePair`, `old` and `new`, each with `animate()`. Without a `name` prop React generates names like `_t_0_`, which `instance.name` returns.
- When testing: if the page produces no frames (for example while the Claude desktop app's browser pane is hidden), the transition stalls while capturing the old page, `update` is never called and nothing times out; it carries on as soon as a frame is produced. One P0 run stalled for 41 s this way. Users browsing normally will not hit this.

### 12.2 Changes (P0-1 and P0-2 adopted on 2026-11-06)

| # | Change | Effect |
| :--- | :--- | :--- |
| P0-1 | The language switch no longer relies on React's `onEnter`. The language button's `onClick` stops `Link`'s default navigation and `pageCut` calls `document.startViewTransition({ update, types: ["cut"] })` instead: `update` runs `router.push` and resolves once `<html lang>` becomes the target language; when ready, it animates `::view-transition-new(root)`. The whole page is cut, header included (its text changes language anyway), so step 4 of §6.1, "the header stays still", is dropped | Rewrites §5.3 and §6.1; `pageCut` gets simpler, and pages no longer need a `<ViewTransition>` around them. Browsers without view transitions navigate as usual |
| P0-2 | Hide the wait for the new page: prefetch the other language's page when the pointer moves onto the language button or the button gets focus; on click, first draw the line on the live page (120 ms, then a 40 ms pause) while the data loads, and only then start the view transition, in which the window opens and expands (200 + 480 ms). If the data arrives within 160 ms the total is about 0.9 s (including a 50–70 ms render wait); if not, the line stays on screen until it does | D9's timing is unchanged; only the first 160 ms move outside the transition. In the worst case the first switch is a few hundred milliseconds late |
| P0-3 | Safari, Firefox and phones were not tested. OQ-5's fallback stays (crossfade or a plain switch where unsupported); test on real devices after P2 | None |

## 13. Progress

### P2 (2026-11-06, awaiting review)

- On the site: the language switch and "Try camera AR" now cut space open. The code is in `src/cut/pageCut.ts` and `src/components/CutLayer.tsx`, with changes to `Nav.tsx`, `HeroViewport.tsx`, `CameraAR.tsx`, `globals.css` and `profile.ts`.
- While camera AR waits at the window, a hint line sits at the bottom of the screen (new copy `cameraAR.peekHint`); if the window size changes at that point, the overlay opens fully; the home page's 3D scene keeps running until the overlay covers the screen.
- Tests: new `tests/cut/pageCut.test.ts` (keyframes with the same points, starting as a line, fully open at 200 ms, covering the screen at the end, the D9 timing), and a `pageCut` rule in the architecture test.
- Tried in desktop Chromium (the browser built into the Claude desktop app):
  - Language switch: on the dev server and the static build, and from the phone-width menu. The old page stays outside the cut and the new one shows through the lens.
  - In the static build, hovering first to prefetch and then clicking: 43 ms from starting the transition to ready (326 ms without prefetch in P0). With the browser pane hidden, frames are throttled and the line phase measured 311 ms against the designed 160 ms, so it needs another look in a visible browser.
  - Reduce motion (the system setting simulated by script): the language switch crossfades instead.
  - Camera AR (the board view on a desktop): a click and Enter both cut from the button and stop; clicking inside or Enter steps through; clicking outside or Esc closes it and the overlay, the URL goes back and focus returns to the button.
- Not tried: phones (including "Opening the camera" in the middle of the window and the view fading in), Safari, Firefox.
- Seen, for review: on a desktop the window opens at the button, which falls on the board view's black margin, so the window shows only black.
- When testing: after switching Git branches the dev server may stop noticing changes to `globals.css` and keep serving the old styles; restarting it fixes that.

### P3 (2026-11-06, awaiting review)

- On the site: the easter egg in the home page's 3D viewport and the 404 page can now be cut. New: `src/cut/hint.ts` and `src/components/NotFoundCut.tsx`; changed: `heroScene.ts` (the stencil portal and the engineering view), `HeroViewport.tsx`, `CutLayer.tsx`, `global-not-found.tsx` and `profile.ts`.
- Easter egg: draw a line or hold the wand in the viewport and the window shows the engineering view (a dark blueprint background and grid, normal shading, wireframes, and an amber bounding box and local axes on every part). Clicking inside or Enter steps through, the two views swap and the HUD says "Engineering view"; cutting again swaps back, and Esc returns straight to the normal view. The viewport takes Tab focus, and Enter or Space opens a window at its center. The camera stops following the pointer while drawing or dissolving; at the window it follows as usual, turning both views together in place of parallax. The HUD's bottom row no longer catches the pointer, only its buttons do, so a stroke can start next to them.
- 404 page: the layer that catches the pointer sits under the card, so the card's buttons still work; the effect layer is attached to body, above everything. Behind the window is the home page in an iframe preloaded when the page is idle (with the same language rules as the root path `/`); "回到首页" or "Back to home" cuts from the button's center, and the home page's language follows the button. Once the cut fills the screen, `location.replace` goes home.
- Hints: the first time the mouse is over a place where the wand works (the viewport, the 404 page's blank areas), a "hold" hint appears next to the pointer, leaves on the first press or after 4.5 s, and is remembered in local storage; on touch-only devices it appears at the bottom once the layer is 60% on screen. Strokes too short or not straight get a hint at the bottom, and so does waiting at the window.
- Tests: new `tests/cut/hint.test.ts` (no errors without local storage or when reads and writes are refused), and a `hint` rule in the architecture test.
- First-load code: the easter egg's cut layer downloads once the 3D scene is ready, so the home page's first-load scripts contain no cut code; they are about 1.3 KB larger than in P2 (the viewport's keyboard handling and the new copy).
- Tried in desktop Chromium: the easter egg's hold hint, a knife cut opening the window, clicking inside to step through, Esc to return, Enter to open a window and Esc to close it with a scar; on the 404 page (static build), a stroke starting in a blank area and crossing the card, and "Back to home", both cut open and went home.
- Not tried: the wand in these two places (the browser tool here cannot hold a press; the wand was tried on P1's test page), the hint on touch, phones, Safari and Firefox. The dev server cannot show the 404 page with `output: "export"` (as before), so it has to be tested on the static build.
- For review: on phones the 404 card fills most of the screen, leaving little blank space to start a stroke (one can start at the edge and cross the card).

### P4 (2026-11-06, awaiting review)

- On the site: a "Try it with your hand" switch in the bottom right of the home page's 3D viewport, shown only on computers, where the browser can open a camera and this build has the model (Q11, Q13, D6). Only turning it on asks for the camera and loads the model. A small window in the top right shows the mirrored picture, the hand skeleton, a dashed box for the mapped region and the state (opening the camera, loading the model, no hand, open, pinched); a cursor follows the hand and shrinks to a solid gold dot when pinched, and a hint says how to use it for a few seconds. A pinch acts like a mouse press and goes to the easter egg's cut engine along the mouse's path: pinch and draw a straight line for the knife, pinch and hold for the wand, and at a window pinch inside to step through or outside to close. Pinching on a button inside the viewport clicks it (D5). Recognition pauses when the viewport scrolls off screen; turning the switch off, or opening camera AR, turns the camera off. Without a camera, without permission or when the model fails, the switch turns back off and says why.
- New modules: `src/cut/hand/oneEuro.ts`, `pinch.ts`, `mapping.ts`, `handInput.ts` (frames to input events, pure) and `tracker.ts`; `src/components/HandMode.tsx`; `scripts/fetch-mediapipe.mjs`. New dependency: `@mediapipe/tasks-vision` 1.1.1 (exact version).
- Build (D6): `predev` and `prebuild` run `fetch-mediapipe` first. It copies the two runtimes (with and without SIMD, about 13 MB and 12.6 MB) to `public/mediapipe/wasm/` and downloads the model (7,819,105 bytes), checking its SHA-256 and skipping the download when a good copy is there. None of this is committed. With the network cut (simulated), the script still exits normally, marks gesture mode unavailable and removes the partial file, so the home page hides the switch. ESLint skips the copied runtime.
- Found: MediaPipe 1.1.1 creates a usage logger for every task, which posts to `https://odml.pa.googleapis.com/v1/log` every minute, with no option to turn it off (4 requests seen on P4's test page). That breaks Q12, "visitors do not connect to Google". Fix: before MediaPipe loads, `fetch` is wrapped so that this one address gets a local 403; the logger treats logging as failed and stops, and every other request goes through as before. With it, no external request was seen and recognition still worked.
- The privacy page gains two points: the camera is used only when camera AR or "Try it with your hand" is opened, the picture is processed only in the browser and never uploaded or stored, and the model and runtime come from this site; the "hold" hint leaves a flag in local storage.
- Tests: new `tests/cut/hand/hand.test.ts` (One Euro, the pinch check and its hysteresis, the mirrored mapping, frames to events, a release only after 300 ms without a hand, cancelling on switch-off), `fetchMediapipe.test.ts` (the SHA-256 check, the pinned version and hash, the runtime files present) and `tracker.test.ts` (the logging address answered locally, other requests passed through), plus rules for every module in `src/cut/hand` in the architecture test.
- First-load code: gesture mode and MediaPipe download only when the switch is turned on, so the home page's first-load scripts contain neither; they are about 1.1 KB larger than in P3 (the switch and copy).
- Tried in desktop Chromium: the switch appears; the browser built into the Claude desktop app does not let pages use the camera, so it only got as far as "camera access was blocked", turning the switch back off with the reason. On an uncommitted test page, the runtime and model loaded from this site and both GPU and CPU created a landmarker and ran one detection (about 0.2–0.8 s).
- Not tried: actually using a camera and a hand (to be done in your own browser), phones (left out for now per Q13), Safari and Firefox.

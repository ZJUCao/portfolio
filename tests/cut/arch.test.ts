// Static architecture test of src/cut: the dependency directions of docs/design_space_cut.md §4.
// The pure parts never touch the DOM; dust and the engine may, but only in their DOM entry points;
// nothing in src/cut loads React, three.js or src/components.

import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { type ModuleScan, SRC_DIR, scanDirectory } from "../ar/helpers/sourceScan";

const CUT_DIR = join(SRC_DIR, "cut");

const BROWSER_GLOBALS = [
  "window",
  "document",
  "navigator",
  "requestAnimationFrame",
  "cancelAnimationFrame",
  "performance",
  "matchMedia",
  "localStorage",
  "devicePixelRatio",
  "ResizeObserver",
] as const;

interface Rule {
  readonly runtime: readonly string[];
  readonly globals: readonly string[];
  /** When set, the top-level declarations the globals may appear in. */
  readonly globalScopes?: RegExp;
}

const PURE: Rule = { runtime: [], globals: [] };
const RULES: Readonly<Record<string, Rule>> = {
  constants: PURE,
  timeline: PURE,
  geometry: { runtime: ["cut/constants"], globals: [] },
  gesture: { runtime: ["cut/constants", "cut/geometry"], globals: [] },
  dust: { runtime: ["cut/constants", "cut/geometry"], globals: ["document", "devicePixelRatio"], globalScopes: /^createDustCanvas$/ },
  fxLayer: { runtime: ["cut/constants", "cut/dust"], globals: ["document", "devicePixelRatio", "ResizeObserver"], globalScopes: /^createFxLayer$/ },
  engine: {
    runtime: ["cut/constants", "cut/geometry", "cut/gesture", "cut/timeline", "cut/dust", "cut/fxLayer"],
    globals: ["performance", "requestAnimationFrame", "cancelAnimationFrame"],
    globalScopes: /^createCut$/,
  },
  // P3: the hint flag reaches storage through globalThis only, inside guarded functions
  hint: PURE,
  // P2: the keyframes are pure; only the navigation wrapper and the effect layer touch the page
  pageCut: {
    runtime: ["cut/constants", "cut/fxLayer", "cut/geometry", "cut/timeline"],
    globals: ["document", "window", "performance", "requestAnimationFrame", "cancelAnimationFrame"],
    globalScopes: /^(ensureLayer|arrival|cutNavigate)$/,
  },
  // P5: the names of the card-to-detail morph; the <ViewTransition>s that use them live in src/components
  coverMorph: PURE,
  // Back and Forward for the morph: the path being left and the arrival flag; src/instrumentation-client.ts adds the type
  coverHistory: { runtime: ["cut/coverMorph"], globals: [] },
  // P4: the hand modules in src/cut/hand. All pure but the tracker, which opens the camera and
  // loads MediaPipe from the site's own files
  oneEuro: PURE,
  mapping: PURE,
  pinch: { runtime: ["cut/constants"], globals: [] },
  handInput: { runtime: ["cut/constants", "cut/hand/mapping", "cut/hand/oneEuro", "cut/hand/pinch"], globals: [] },
  tracker: {
    runtime: ['package "@mediapipe/tasks-vision"'],
    globals: ["navigator", "performance", "requestAnimationFrame", "cancelAnimationFrame"],
    globalScopes: /^startHandTracking$/,
  },
};

const scans = (): ModuleScan[] => scanDirectory(CUT_DIR, BROWSER_GLOBALS);
const where = (scan: ModuleScan, line: number) => `src/cut/${scan.name}.ts:${line}`;

describe("architecture of src/cut (§4)", () => {
  it("every P1 module exists and imports only along §4 at runtime", () => {
    const modules = scans();
    const problems: string[] = [];
    for (const name of Object.keys(RULES)) if (!modules.some((scan) => scan.name === name)) problems.push(`src/cut/${name}.ts is missing`);
    for (const scan of modules) {
      const rule = RULES[scan.name];
      if (!rule) continue; // later phases add modules with their own rules
      for (const edge of scan.imports) {
        if (edge.typeOnly) continue;
        const target = edge.target ?? `package "${edge.specifier}"`;
        if (!rule.runtime.includes(target)) problems.push(`${where(scan, edge.line)} imports ${target}`);
      }
    }
    expect(problems).toEqual([]);
  });

  it("no module loads React, three.js or src/components, and browser globals stay in the DOM entry points", () => {
    const problems: string[] = [];
    for (const scan of scans()) {
      for (const edge of scan.imports) {
        const forbidden = /^react(-dom)?(\/|$)/.test(edge.specifier) || edge.specifier === "three" || edge.specifier.startsWith("three/") || (edge.target ?? "").startsWith("components/");
        if (forbidden && !edge.typeOnly) problems.push(`${where(scan, edge.line)} imports ${edge.specifier}`);
      }
      const rule = RULES[scan.name];
      if (!rule) continue;
      for (const use of scan.globals) {
        if (!rule.globals.includes(use.name)) problems.push(`${where(scan, use.line)} uses the global ${use.name}`);
        else if (rule.globalScopes && !rule.globalScopes.test(use.scope ?? "")) problems.push(`${where(scan, use.line)} uses ${use.name} outside its DOM entry point (in ${use.scope ?? "the top level"})`);
      }
    }
    expect(problems).toEqual([]);
  });
});

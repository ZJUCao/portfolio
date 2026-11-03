// P2 static architecture tests: the dependency directions and the DOM rules of
// docs/design_camera_ar.md §4, checked by scanning the sources in src/ar (OQ-03) with the scope of
// OQ-73; test plan §4.10. tracker.ts arrives in P3 and is checked once it exists.

import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { type ModuleScan, SRC_DIR, scanDirectory } from "./helpers/sourceScan";

const AR_DIR = join(SRC_DIR, "ar");

/** Browser and worker globals that DOM-free modules must not use as values. */
const BROWSER_GLOBALS = ["window", "document", "navigator", "self", "postMessage", "requestAnimationFrame", "cancelAnimationFrame"] as const;

interface Rule {
  /** Targets the module may import at runtime. */
  readonly runtime: readonly string[];
  /** Further targets it may import with `import type` only; "any" allows every type-only import. */
  readonly typeOnly: readonly string[] | "any";
  /** Browser globals it may use. */
  readonly globals: readonly string[];
  /** Whether the module must exist in this phase. */
  readonly required: boolean;
}

// §4: chessboard → board; pipeline → chessboard, pose, board; tracker.worker → pipeline;
// tracker → pipeline (types only); pose knows no other module at runtime. tracker.ts is the only
// main-thread module (camera, frame capture, scheduling); the worker entry is the only one with
// `self` and `postMessage`. Modules that §4 does not list fail, and tracker.ts may use its globals
// anywhere until P3 limits them to its default dependencies (OQ-73).
const RULES: Readonly<Record<string, Rule>> = {
  board: { runtime: [], typeOnly: [], globals: [], required: true },
  chessboard: { runtime: ["ar/board"], typeOnly: [], globals: [], required: true },
  pose: { runtime: [], typeOnly: "any", globals: [], required: true },
  pipeline: { runtime: ["ar/chessboard", "ar/pose", "ar/board"], typeOnly: [], globals: [], required: true },
  "tracker.worker": { runtime: ["ar/pipeline"], typeOnly: [], globals: ["self", "postMessage"], required: true },
  tracker: { runtime: [], typeOnly: ["ar/pipeline", "ar/pose"], globals: ["window", "document", "navigator", "requestAnimationFrame", "cancelAnimationFrame"], required: false },
};

const scans = (): ModuleScan[] => scanDirectory(AR_DIR, BROWSER_GLOBALS);
const where = (scan: ModuleScan, line: number): string => `src/ar/${scan.name}.ts:${line}`;

describe("architecture of src/ar (§4, OQ-03)", () => {
  it("P2-ARCH-01 every module imports only along the §4 dependency directions (OQ-73)", () => {
    const modules = scans();
    const names = modules.map((scan) => scan.name);
    const problems: string[] = [];
    for (const [name, rule] of Object.entries(RULES)) {
      if (rule.required && !names.includes(name)) problems.push(`src/ar/${name}.ts is missing`);
    }
    for (const scan of modules) {
      const rule = RULES[scan.name];
      if (!rule) {
        problems.push(`src/ar/${scan.name} is not a module of §4`);
        continue;
      }
      for (const edge of scan.imports) {
        const target = edge.target ?? `package "${edge.specifier}"`;
        const allowed = edge.typeOnly ? rule.typeOnly === "any" || rule.runtime.includes(target) || rule.typeOnly.includes(target) : rule.runtime.includes(target);
        if (!allowed) problems.push(`${where(scan, edge.line)} imports ${edge.typeOnly ? "the types of " : ""}${target}`);
      }
    }
    expect(problems).toEqual([]);
  });

  it("P2-ARCH-02 no module loads three.js, React or src/components at runtime, and only tracker and the worker entry use browser globals (OQ-73)", () => {
    const problems: string[] = [];
    for (const scan of scans()) {
      for (const edge of scan.imports) {
        if (edge.typeOnly) continue;
        const { specifier, target } = edge;
        const forbidden = specifier === "three" || specifier.startsWith("three/") || /^react(-dom)?(\/|$)/.test(specifier) || (target ?? "").startsWith("components/");
        if (forbidden) problems.push(`${where(scan, edge.line)} imports ${specifier} at runtime`);
      }
      const allowed = RULES[scan.name]?.globals ?? [];
      for (const use of scan.globals) {
        if (!allowed.includes(use.name)) problems.push(`${where(scan, use.line)} uses the global ${use.name}`);
      }
    }
    expect(problems).toEqual([]);
  });
});

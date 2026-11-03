// Real-photo fixtures (decision D12, docs/test_plan_camera_ar.md §7): JPEG photos of the printed
// board, scaled to a 640 px long side with macOS `sips`, listed in tests/fixtures/board/manifest.json
// and decoded with jpeg-js. The grey conversion here is the BT.601 formula, written independently
// of rgbaToGray so the photo tests only exercise the detector.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import jpeg from "jpeg-js";
import type { TestImage } from "./render";

export const FIXTURE_DIR = fileURLToPath(new URL("../../fixtures/board/", import.meta.url));

export type Expectation = "found" | "null" | "either";
export type AnnotatedCorner = "0" | "8" | "45" | "53";

export interface FixtureEntry {
  readonly file: string;
  readonly expect: Expectation;
  readonly device?: string;
  readonly board?: "paper" | "screen";
  readonly conditions?: readonly string[];
  /** Approximate pixel positions in the decoded image (jpeg-js ignores EXIF orientation). */
  readonly corners?: Partial<Record<AnnotatedCorner, readonly [number, number]>>;
  readonly notes?: string;
}

/** The manifest's entries; the file must be a JSON array (empty until photos are added). */
export function loadManifest(): unknown[] {
  const raw: unknown = JSON.parse(readFileSync(`${FIXTURE_DIR}manifest.json`, "utf8"));
  if (!Array.isArray(raw)) throw new Error("tests/fixtures/board/manifest.json must be a JSON array");
  return raw;
}

const isPoint = (value: unknown): boolean =>
  Array.isArray(value) && value.length === 2 && value.every((v) => typeof v === "number" && Number.isFinite(v));

/** Schema problems of one manifest entry, or an empty list. */
export function entryProblems(entry: unknown): string[] {
  if (typeof entry !== "object" || entry === null || Array.isArray(entry)) return ["entry is not an object"];
  const e = entry as Record<string, unknown>;
  const problems: string[] = [];
  if (typeof e.file !== "string" || !/\.jpe?g$/i.test(e.file)) problems.push("file must name a .jpg file");
  if (e.expect !== "found" && e.expect !== "null" && e.expect !== "either") problems.push('expect must be "found", "null" or "either"');
  if (e.board !== undefined && e.board !== "paper" && e.board !== "screen") problems.push('board must be "paper" or "screen"');
  if (e.conditions !== undefined && !(Array.isArray(e.conditions) && e.conditions.every((c) => typeof c === "string"))) problems.push("conditions must be strings");
  if (e.corners !== undefined) {
    if (typeof e.corners !== "object" || e.corners === null) problems.push("corners must be an object");
    else {
      for (const [key, value] of Object.entries(e.corners)) {
        if (!["0", "8", "45", "53"].includes(key)) problems.push(`corners.${key}: only corners 0, 8, 45 and 53 are annotated`);
        if (!isPoint(value)) problems.push(`corners.${key} must be [x, y]`);
      }
    }
  }
  return problems;
}

/** Decodes a fixture photo and converts it to BT.601 grey. */
export function loadPhoto(file: string): TestImage {
  const decoded = jpeg.decode(readFileSync(`${FIXTURE_DIR}${file}`), { useTArray: true, formatAsRGBA: true });
  const { width, height } = decoded;
  const data = new Uint8ClampedArray(width * height);
  for (let i = 0; i < width * height; i++) {
    data[i] = 0.299 * decoded.data[4 * i] + 0.587 * decoded.data[4 * i + 1] + 0.114 * decoded.data[4 * i + 2];
  }
  return { width, height, data };
}

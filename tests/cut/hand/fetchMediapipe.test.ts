// The checks in scripts/fetch-mediapipe.mjs (docs/design_space_cut.md §3 D6, §8).

import { existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { MODEL_SHA256, MODEL_URL, matchesHash, sha256, WASM_FILES } from "../../../scripts/fetch-mediapipe.mjs";

describe("fetch-mediapipe", () => {
  it("hashes with SHA-256", () => {
    expect(sha256(Buffer.from("abc"))).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  });

  it("accepts only the expected hash, in either case", () => {
    const bytes = Buffer.from("hand model");
    const hash = sha256(bytes);
    expect(matchesHash(bytes, hash)).toBe(true);
    expect(matchesHash(bytes, hash.toUpperCase())).toBe(true);
    expect(matchesHash(Buffer.from("tampered"), hash)).toBe(false);
  });

  it("pins the model's version and hash", () => {
    expect(MODEL_URL).toContain("/float16/1/");
    expect(MODEL_SHA256).toMatch(/^[0-9a-f]{64}$/);
  });

  it("copies runtime files that the installed package has", () => {
    const runtime = join(process.cwd(), "node_modules/@mediapipe/tasks-vision/wasm");
    for (const file of WASM_FILES) expect(existsSync(join(runtime, file)), file).toBe(true);
  });
});

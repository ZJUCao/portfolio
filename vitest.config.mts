import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// Unit tests for the camera AR modules run in Node (docs/design_camera_ar.md §9)
export default defineConfig({
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
  },
});

import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Claude Code 会把会话的 worktree 建在 .claude/worktrees 里，那是另一份仓库副本和它的构建产物
    ".claude/**",
    // 构建前从 node_modules 复制过来的 MediaPipe 运行文件（scripts/fetch-mediapipe.mjs），是第三方代码
    "public/mediapipe/**",
  ]),
]);

export default eslintConfig;

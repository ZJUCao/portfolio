// 构建前准备手势模式要用的文件（docs/design_space_cut.md §3 D6、需求 Q12）：
// - MediaPipe Tasks Vision 的运行文件（wasm）从 node_modules 复制到 public/mediapipe/wasm/；
// - 手部关键点模型从 Google 的存储下载到 public/mediapipe/，按固定的 SHA-256 校验，已经有且校验通过就不再下载。
// 这些文件都不提交（.gitignore），访客只从本站加载它们，不连 jsDelivr 或 Google。
// 下载或校验失败时构建照常完成：打印一条警告，并在 src/data/gesture.generated.json 里记下不可用，
// 首页就不显示"用手试试"的开关。每天自动重新部署时，一次下载失败不会让部署失败。

import { createHash } from "node:crypto";
import { copyFile, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const RUNTIME = join(ROOT, "node_modules/@mediapipe/tasks-vision/wasm");
const OUT = join(ROOT, "public/mediapipe");
const FLAG = join(ROOT, "src/data/gesture.generated.json");

/** float16 第 1 版，路径里带版本号，内容不会变 */
export const MODEL_URL = "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task";
/** 2026-11-06 下载的模型：7,819,105 字节 */
export const MODEL_SHA256 = "fbc2a30080c3c557093b5ddfc334698132eb341044ccee322ccf8bcf3607cde1";
export const MODEL_FILE = "hand_landmarker.task";
/** FilesetResolver.forVisionTasks 按浏览器是否支持 SIMD 二选一加载 */
export const WASM_FILES = ["vision_wasm_internal.js", "vision_wasm_internal.wasm", "vision_wasm_nosimd_internal.js", "vision_wasm_nosimd_internal.wasm"];
const DOWNLOAD_TIMEOUT_MS = 60_000;

/** 十六进制的 SHA-256 */
export const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

/** 内容和期望的哈希是否一致（大小写不敏感） */
export const matchesHash = (bytes, expected) => sha256(bytes) === String(expected).toLowerCase();

async function readIfPresent(path) {
  try {
    return await readFile(path);
  } catch {
    return null;
  }
}

async function ensureModel() {
  const target = join(OUT, MODEL_FILE);
  const existing = await readIfPresent(target);
  if (existing && matchesHash(existing, MODEL_SHA256)) return "cached";
  const response = await fetch(MODEL_URL, { signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS) });
  if (!response.ok) throw new Error(`download failed: HTTP ${response.status}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  if (!matchesHash(bytes, MODEL_SHA256)) throw new Error(`checksum mismatch: got ${sha256(bytes)}`);
  await writeFile(target, bytes);
  return "downloaded";
}

async function main() {
  let available = false;
  try {
    await mkdir(join(OUT, "wasm"), { recursive: true });
    await Promise.all(WASM_FILES.map((file) => copyFile(join(RUNTIME, file), join(OUT, "wasm", file))));
    const model = await ensureModel();
    available = true;
    console.log(`[fetch-mediapipe] runtime copied, model ${model}`);
  } catch (error) {
    await rm(join(OUT, MODEL_FILE), { force: true }).catch(() => {});
    console.warn(`[fetch-mediapipe] gesture mode is off for this build: ${error instanceof Error ? error.message : error}`);
  }
  await mkdir(dirname(FLAG), { recursive: true });
  await writeFile(FLAG, `${JSON.stringify({ available }, null, 2)}\n`);
}

// 被测试 import 时不运行
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();

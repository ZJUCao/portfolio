// Opens the front camera, loads MediaPipe's hand landmarker from the site's own files and reports
// one hand's landmarks for every new video frame (docs/design_space_cut.md §5.4, §3 D6). The runtime
// and model are fetched only when this runs, i.e. after a visitor turns gesture mode on. The picture
// never leaves the browser. No React.

import type { Landmark } from "./mapping";

export type HandFrame = { landmarks: readonly Landmark[] | null; t: number; aspect: number };
export type HandTrackingReason = "unsupported" | "denied" | "no-camera" | "model" | "aborted";
export type HandTrackingStatus = "camera" | "model" | "ready";

export class HandTrackingError extends Error {
  constructor(readonly reason: HandTrackingReason) {
    super(reason);
  }
}

// MediaPipe Tasks 1.1.1 creates a usage logger for every task and posts to this address every
// minute, with no option to turn it off. Visitors must not connect to Google (requirements Q12), so
// requests to it are answered locally with a 403; the logger then treats logging as failed and stops.
const USAGE_LOG = "https://odml.pa.googleapis.com/";
let loggingBlocked = false;

export function blockUsageLogging(): void {
  if (loggingBlocked || typeof globalThis.fetch !== "function") return;
  loggingBlocked = true;
  const fetch = globalThis.fetch.bind(globalThis);
  globalThis.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    return url.startsWith(USAGE_LOG) ? Promise.resolve(new Response(null, { status: 403 })) : fetch(input, init);
  };
}

type Options = {
  /** Where scripts/fetch-mediapipe.mjs put the runtime and model. */
  base?: string;
  signal?: AbortSignal;
  onStatus?(status: HandTrackingStatus): void;
};

export async function startHandTracking(
  video: HTMLVideoElement,
  onFrame: (frame: HandFrame) => void,
  { base = "/mediapipe", signal, onStatus }: Options = {},
): Promise<{ stop(): void; setPaused(paused: boolean): void }> {
  const aborted = () => {
    if (signal?.aborted) throw new HandTrackingError("aborted");
  };
  if (typeof navigator.mediaDevices?.getUserMedia !== "function") throw new HandTrackingError("unsupported");

  onStatus?.("camera");
  let stream: MediaStream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "user", width: { ideal: 640 }, height: { ideal: 480 } }, audio: false });
  } catch (error) {
    const name = (error as { name?: string } | null)?.name;
    throw new HandTrackingError(name === "NotAllowedError" || name === "SecurityError" ? "denied" : "no-camera");
  }
  const closeCamera = () => {
    for (const track of stream.getTracks()) track.stop();
    video.srcObject = null;
  };
  try {
    aborted();
    video.muted = true;
    video.playsInline = true;
    video.srcObject = stream;
    await video.play().catch(() => {});
    aborted();
  } catch (error) {
    closeCamera();
    throw error;
  }

  onStatus?.("model");
  type Landmarker = { detectForVideo(video: HTMLVideoElement, t: number): { landmarks?: Landmark[][] }; close(): void };
  let landmarker: Landmarker;
  try {
    blockUsageLogging();
    const { FilesetResolver, HandLandmarker } = await import("@mediapipe/tasks-vision");
    const fileset = await FilesetResolver.forVisionTasks(`${base}/wasm`);
    const options = (delegate: "GPU" | "CPU") => ({
      baseOptions: { modelAssetPath: `${base}/hand_landmarker.task`, delegate },
      runningMode: "VIDEO" as const,
      numHands: 1,
      minHandDetectionConfidence: 0.6,
      minHandPresenceConfidence: 0.6,
      minTrackingConfidence: 0.5,
    });
    // The GPU path is faster; some machines cannot create it, so fall back to the CPU
    landmarker = await HandLandmarker.createFromOptions(fileset, options("GPU")).catch(() => HandLandmarker.createFromOptions(fileset, options("CPU")));
  } catch {
    closeCamera();
    throw new HandTrackingError(signal?.aborted ? "aborted" : "model");
  }
  if (signal?.aborted) {
    landmarker.close();
    closeCamera();
    throw new HandTrackingError("aborted");
  }

  let stopped = false;
  let paused = false;
  let frame = 0;
  let lastTime = -1;
  const loop = () => {
    if (stopped) return;
    frame = requestAnimationFrame(loop);
    if (paused || video.readyState < 2 || video.currentTime === lastTime) return;
    lastTime = video.currentTime;
    const t = performance.now();
    let landmarks: readonly Landmark[] | null = null;
    try {
      landmarks = landmarker.detectForVideo(video, t).landmarks?.[0] ?? null;
    } catch {
      return; // a dropped frame
    }
    onFrame({ landmarks, t, aspect: video.videoWidth / video.videoHeight || 4 / 3 });
  };
  onStatus?.("ready");
  frame = requestAnimationFrame(loop);

  return {
    stop() {
      if (stopped) return;
      stopped = true;
      cancelAnimationFrame(frame);
      landmarker.close();
      closeCamera();
    },
    setPaused(value: boolean) {
      paused = value;
    },
  };
}

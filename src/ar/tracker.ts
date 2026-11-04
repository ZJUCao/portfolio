// Main-thread side of camera AR: the camera stream, frame capture, the tracking worker with one
// frame in flight, the status machine and the fps count.
// Contract: docs/design_camera_ar.md §5.5 and the resolved details in §14.
//
// Everything outside this module reaches the browser through `deps`, and a default dependency is
// resolved only when `deps` lacks it (OQ-02), so the tests run in Node with fakes.

import type { WorkerRequest, WorkerResponse } from "./pipeline";
import type { Intrinsics, Pose, Size } from "./pose";

/** Why the camera could not be used. */
export type CameraError = "insecure" | "unsupported" | "denied" | "no-camera" | "failed";

export type TrackingStatus = "starting" | "searching" | "tracking" | "error";

/** One state of the tracker, passed to {@link CameraAROptions.onUpdate}. */
export interface TrackingUpdate {
  readonly status: TrackingStatus;
  /** Non-null only when status is "error". */
  readonly error: CameraError | null;
  /** Non-null only when status is "tracking". */
  readonly pose: Pose | null;
  /** The intrinsics the pose refers to; null until the first worker reply (OQ-37). */
  readonly intrinsics: Intrinsics | null;
  /** The analysis frame size that pose and intrinsics refer to; null until the first reply. */
  readonly frame: Size | null;
  /** Worker replies received in the last 1000 ms. */
  readonly fps: number;
}

/** The part of a `Worker` the tracker uses. */
export interface WorkerLike {
  postMessage(message: WorkerRequest, transfer?: Transferable[]): void;
  onmessage: ((event: { data: WorkerResponse }) => void) | null;
  onerror: ((event: unknown) => void) | null;
  terminate(): void;
}

/** The part of an `HTMLVideoElement` the tracker uses. */
export interface VideoLike {
  srcObject: MediaStream | null;
  readonly videoWidth: number;
  readonly videoHeight: number;
  play(): Promise<void>;
}

/** Everything the tracker needs from the browser. */
export interface CameraARDeps {
  readonly isSecureContext: boolean;
  readonly mediaDevices: { getUserMedia(constraints: MediaStreamConstraints): Promise<MediaStream> } | undefined;
  createWorker(): WorkerLike;
  /** Draws the current video frame scaled to width × height into `out` (RGBA). */
  captureFrame(video: VideoLike, width: number, height: number, out: Uint8ClampedArray): void;
  /** Calls back once on the next video frame; returns a cancel function. */
  requestFrame(video: VideoLike, callback: () => void): () => void;
  now(): number;
}

export interface CameraAROptions {
  onUpdate(update: TrackingUpdate): void;
  /** Which camera to ask for; default "environment", the rear camera (D4). */
  readonly facingMode?: "environment" | "user";
  /** Long side of the analysis frames in pixels; default 640. */
  readonly analysisLongSide?: number;
  /** How long the last pose is kept after the board is lost, in milliseconds; default 500 (D3). */
  readonly holdMs?: number;
}

/**
 * Opens the camera, plays it in `video` and tracks the board in a worker until `stop()`.
 *
 * The first update, `starting`, is emitted before this returns (B1). Then: `error` / `insecure`
 * without a secure context and `error` / `unsupported` without `getUserMedia`, one microtask later
 * (B2, OQ-40); otherwise one `getUserMedia` call (B3), the stream attached and played, `searching`
 * (B5) and frames analysed one at a time in the worker (B6), with one update per reply (B7). Errors
 * are terminal and release everything (B4). `stop()` releases everything and silences all later
 * updates; it is idempotent (B9).
 *
 * @throws RangeError if analysisLongSide is not a positive integer or holdMs is negative (OQ-32).
 */
export function startCameraAR(video: VideoLike, options: CameraAROptions, deps: Partial<CameraARDeps> = {}): { stop(): void } {
  const { onUpdate, facingMode = "environment", analysisLongSide = 640, holdMs = 500 } = options;
  if (!(Number.isInteger(analysisLongSide) && analysisLongSide > 0)) throw new RangeError("startCameraAR: analysisLongSide must be a positive integer");
  if (!(holdMs >= 0)) throw new RangeError("startCameraAR: holdMs must not be negative");

  // A default is resolved only when deps lacks the key, so `mediaDevices: undefined` means none (OQ-02)
  const has = <K extends keyof CameraARDeps>(key: K): boolean => key in deps;
  const createWorker = (): WorkerLike => (has("createWorker") ? deps.createWorker!() : defaultCreateWorker());
  const captureFrame = has("captureFrame") ? deps.captureFrame! : defaultCaptureFrame();
  const requestFrame = has("requestFrame") ? deps.requestFrame! : defaultRequestFrame;
  const now = has("now") ? deps.now! : defaultNow;

  let done = false; // stopped or failed: no more updates
  let stream: MediaStream | null = null;
  let attached = false;
  let worker: WorkerLike | null = null;
  let cancelFrame: (() => void) | null = null;

  let nextId = 1;
  let inFlight: { id: number; width: number; height: number } | null = null;
  let spare: ArrayBuffer | null = null; // the buffer returned with the last reply
  const replyTimes: number[] = [];
  let latest: { intrinsics: Intrinsics; frame: Size } | null = null;
  let lastFound: { pose: Pose; intrinsics: Intrinsics; frame: Size; time: number } | null = null;

  const fpsAt = (time: number): number => {
    while (replyTimes.length > 0 && time - replyTimes[0] >= 1000) replyTimes.shift();
    return replyTimes.length;
  };

  const emit = (status: TrackingStatus, fields: Partial<TrackingUpdate> = {}): void => {
    onUpdate({ status, error: null, pose: null, intrinsics: latest?.intrinsics ?? null, frame: latest?.frame ?? null, fps: 0, ...fields });
  };

  const release = (): void => {
    cancelFrame?.();
    cancelFrame = null;
    for (const track of stream?.getTracks() ?? []) track.stop();
    stream = null;
    if (attached) video.srcObject = null;
    attached = false;
    worker?.terminate();
    worker = null;
  };

  const fail = (error: CameraError): void => {
    if (done) return;
    done = true;
    release();
    let fps = 0;
    try {
      fps = fpsAt(now());
    } catch {
      // the clock itself failed; report no rate
    }
    emit("error", { error, fps });
  };

  // Runs a step of the loop; a dependency that throws ends the session as failed (OQ-42)
  const guarded =
    <A extends unknown[]>(step: (...args: A) => void) =>
    (...args: A): void => {
      if (done) return;
      try {
        step(...args);
      } catch {
        fail("failed");
      }
    };

  const schedule = (): void => {
    cancelFrame = requestFrame(video, onVideoFrame);
  };

  const onVideoFrame = guarded(() => {
    cancelFrame = null;
    const { videoWidth, videoHeight } = video;
    if (!videoWidth || !videoHeight) {
      schedule();
      return;
    }
    const long = Math.max(videoWidth, videoHeight);
    const side = Math.min(analysisLongSide, long);
    const scaled = (length: number): number => (length === long ? side : Math.max(1, Math.round((length * side) / long)));
    const width = scaled(videoWidth);
    const height = scaled(videoHeight);
    const bytes = 4 * width * height;
    const buffer = spare !== null && spare.byteLength === bytes ? spare : new ArrayBuffer(bytes);
    spare = null;
    const time = now();
    captureFrame(video, width, height, new Uint8ClampedArray(buffer));
    const id = nextId++;
    inFlight = { id, width, height };
    worker!.postMessage({ type: "frame", id, width, height, buffer, time }, [buffer]);
  });

  const onReply = guarded((reply: WorkerResponse) => {
    if (typeof reply !== "object" || reply === null || inFlight === null || reply.id !== inFlight.id) return; // OQ-45
    if (reply.type === "error") {
      fail("failed");
      return;
    }
    if (reply.type !== "result") return;
    const frame = { width: inFlight.width, height: inFlight.height };
    inFlight = null;
    spare = reply.buffer;
    const time = now();
    replyTimes.push(time);
    const fps = fpsAt(time);
    latest = { intrinsics: reply.intrinsics, frame };
    if (reply.found && reply.pose) {
      const pose = { R: Float64Array.from(reply.pose.R), t: Float64Array.from(reply.pose.t), rms: reply.pose.rms };
      lastFound = { pose, intrinsics: reply.intrinsics, frame, time };
      emit("tracking", { pose, fps });
    } else if (lastFound !== null && time - lastFound.time <= holdMs) {
      emit("tracking", { pose: lastFound.pose, intrinsics: lastFound.intrinsics, frame: lastFound.frame, fps }); // D3, OQ-38
    } else {
      emit("searching", { fps });
    }
    if (!done) schedule();
  });

  const onPlaying = guarded(() => {
    emit("searching");
    if (!done) schedule();
  });

  const onStream = guarded((media: MediaStream) => {
    stream = media;
    worker = createWorker();
    worker.onmessage = (event) => onReply(event.data);
    worker.onerror = () => fail("failed");
    video.srcObject = media;
    attached = true;
    let playing: Promise<void>;
    try {
      playing = Promise.resolve(video.play());
    } catch (error) {
      playing = Promise.reject(error);
    }
    playing.then(onPlaying, () => fail("failed")); // OQ-41
  });

  emit("starting");

  const secure = has("isSecureContext") ? deps.isSecureContext : defaultIsSecureContext();
  const mediaDevices = secure ? (has("mediaDevices") ? deps.mediaDevices : defaultMediaDevices()) : undefined;
  if (!secure || typeof mediaDevices?.getUserMedia !== "function") {
    const error = secure ? "unsupported" : "insecure";
    queueMicrotask(() => fail(error));
  } else {
    let request: Promise<MediaStream>;
    try {
      request = mediaDevices.getUserMedia({
        audio: false,
        video: { facingMode: { ideal: facingMode }, width: { ideal: 1280 }, height: { ideal: 720 } },
      });
    } catch (error) {
      request = Promise.reject(error);
    }
    Promise.resolve(request).then(
      (media) => {
        // A stream that arrives after stop() is closed again at once (B9, OQ-43)
        if (done) for (const track of media.getTracks()) track.stop();
        else onStream(media);
      },
      (error: unknown) => fail(errorKind(error)),
    );
  }

  return {
    stop(): void {
      if (done) return;
      done = true;
      release();
    },
  };
}

/** B4: getUserMedia rejections by name. */
function errorKind(error: unknown): CameraError {
  const name = typeof error === "object" && error !== null && "name" in error ? (error as { name: unknown }).name : null;
  if (name === "NotAllowedError" || name === "SecurityError") return "denied";
  if (name === "NotFoundError" || name === "OverconstrainedError") return "no-camera";
  return "failed";
}

// Default dependencies in the browser. They are the only place this module touches browser globals
// (checked by P2-ARCH-02), and each one is used only when deps lacks it (OQ-02).

function defaultIsSecureContext(): boolean {
  return typeof window !== "undefined" && window.isSecureContext;
}

function defaultMediaDevices(): CameraARDeps["mediaDevices"] {
  return typeof navigator === "undefined" ? undefined : navigator.mediaDevices;
}

function defaultCreateWorker(): WorkerLike {
  return new Worker(new URL("./tracker.worker.ts", import.meta.url), { type: "module" }) as unknown as WorkerLike;
}

/** Draws video frames into one reused canvas and copies the pixels out. */
function defaultCaptureFrame(): CameraARDeps["captureFrame"] {
  let context: CanvasRenderingContext2D | null = null;
  return (video, width, height, out) => {
    if (context === null) {
      context = document.createElement("canvas").getContext("2d", { willReadFrequently: true });
      if (context === null) throw new Error("no 2D canvas context");
    }
    const canvas = context.canvas;
    if (canvas.width !== width) canvas.width = width;
    if (canvas.height !== height) canvas.height = height;
    context.drawImage(video as unknown as HTMLVideoElement, 0, 0, width, height);
    out.set(context.getImageData(0, 0, width, height).data);
  };
}

/** The next video frame where requestVideoFrameCallback exists, else the next animation frame. */
function defaultRequestFrame(video: VideoLike, callback: () => void): () => void {
  const element = video as unknown as HTMLVideoElement;
  if (typeof element.requestVideoFrameCallback === "function") {
    const handle = element.requestVideoFrameCallback(() => callback());
    return () => element.cancelVideoFrameCallback(handle);
  }
  const handle = requestAnimationFrame(() => callback());
  return () => cancelAnimationFrame(handle);
}

function defaultNow(): number {
  return performance.now();
}

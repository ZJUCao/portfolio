// Fakes for startCameraAR (docs/test_plan_camera_ar.md §2.6): settable promises, media tracks and
// streams, a video element, a worker that really detaches transferred buffers, frame capture, a
// manual frame scheduler and clock, and an update recorder that checks the invariants of P3-TRK-36.
// `rig()` puts one of each together with every dependency supplied (OQ-02).

import { vi } from "vitest";
import type { WorkerRequest, WorkerResponse } from "@/ar/pipeline";
import type { CameraARDeps, TrackingUpdate, VideoLike, WorkerLike } from "@/ar/tracker";

export type FrameRequest = Extract<WorkerRequest, { type: "frame" }>;
export type ResultReply = Extract<WorkerResponse, { type: "result" }>;

export interface Deferred<T> {
  readonly promise: Promise<T>;
  resolve(value: T): void;
  reject(reason: unknown): void;
}

/** A promise to settle at a moment the test chooses. */
export function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  // A rejection nobody awaits must not fail the run
  promise.catch(() => {});
  return { promise, resolve, reject };
}

/** Awaits one macrotask, so pending promise chains settle. */
export const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

export class FakeTrack {
  readyState: "live" | "ended" = "live";
  stops = 0;
  constructor(readonly kind: "video" | "audio" = "video") {}
  stop(): void {
    this.stops++;
    this.readyState = "ended";
  }
}

export class FakeStream {
  readonly tracks: FakeTrack[];
  constructor(tracks: FakeTrack[] = [new FakeTrack("video")]) {
    this.tracks = tracks;
  }
  getTracks(): FakeTrack[] {
    return [...this.tracks];
  }
  getVideoTracks(): FakeTrack[] {
    return this.tracks.filter((track) => track.kind === "video");
  }
  getAudioTracks(): FakeTrack[] {
    return this.tracks.filter((track) => track.kind === "audio");
  }
  /** This stream where a `MediaStream` is expected. */
  get media(): MediaStream {
    return this as unknown as MediaStream;
  }
}

/** A `getUserMedia` spy that records its constraints and returns one deferred stream. */
export function fakeMediaDevices() {
  const request = deferred<MediaStream>();
  const getUserMedia = vi.fn((constraints: MediaStreamConstraints) => {
    void constraints;
    return request.promise;
  });
  return { mediaDevices: { getUserMedia }, getUserMedia, request };
}

export class FakeVideo implements VideoLike {
  videoWidth: number;
  videoHeight: number;
  /** Every value assigned to `srcObject`, in order. */
  readonly assignments: (MediaStream | null)[] = [];
  /** `srcObject` at the time of each `play()` call. */
  readonly playCalls: (MediaStream | null)[] = [];
  readonly playResult = deferred<void>();
  #srcObject: MediaStream | null = null;

  constructor(width = 1280, height = 720) {
    this.videoWidth = width;
    this.videoHeight = height;
  }
  get srcObject(): MediaStream | null {
    return this.#srcObject;
  }
  set srcObject(value: MediaStream | null) {
    this.assignments.push(value);
    this.#srcObject = value;
  }
  play(): Promise<void> {
    this.playCalls.push(this.#srcObject);
    return this.playResult.promise;
  }
}

/** A message as the tracker sent it and as the worker received it. */
export interface Posted {
  /** The message object the tracker passed; its buffer is detached once transferred. */
  readonly sent: WorkerRequest;
  readonly transfer: Transferable[];
  /** The structured clone the worker side received. */
  readonly received: WorkerRequest;
}

export class FakeWorker implements WorkerLike {
  readonly posted: Posted[] = [];
  /** Buffers handed to the tracker with replies, in order. */
  readonly deliveredBuffers: ArrayBuffer[] = [];
  terminated = 0;
  #onmessage: WorkerLike["onmessage"] = null;
  #onerror: WorkerLike["onerror"] = null;
  // The last non-null handlers, kept so that a test can simulate an event after terminate()
  #keptMessage: WorkerLike["onmessage"] = null;
  #keptError: WorkerLike["onerror"] = null;
  #unanswered: FrameRequest[] = [];

  get onmessage(): WorkerLike["onmessage"] {
    return this.#onmessage;
  }
  set onmessage(handler: WorkerLike["onmessage"]) {
    this.#onmessage = handler;
    if (handler) this.#keptMessage = handler;
  }
  get onerror(): WorkerLike["onerror"] {
    return this.#onerror;
  }
  set onerror(handler: WorkerLike["onerror"]) {
    this.#onerror = handler;
    if (handler) this.#keptError = handler;
  }

  postMessage(message: WorkerRequest, transfer: Transferable[] = []): void {
    // structuredClone with a transfer list detaches the buffers, as postMessage does in a browser
    const received = structuredClone(message, { transfer: transfer as Transferable[] }) as WorkerRequest;
    this.posted.push({ sent: message, transfer, received });
    if (received.type === "frame") this.#unanswered.push(received);
  }

  /** The frames received so far, as the worker saw them. */
  get frames(): FrameRequest[] {
    return this.posted.map((p) => p.received).filter((m): m is FrameRequest => m.type === "frame");
  }

  /** Frames received and not answered yet. */
  get unanswered(): number {
    return this.#unanswered.length;
  }

  /**
   * Answers the oldest unanswered frame with a `result` around its own buffer, overridden by
   * `fields`. The reply reaches the tracker through another transferring structured clone, so the
   * tracker gets a new `ArrayBuffer` object, as from a real worker.
   */
  respond(fields: Partial<Omit<ResultReply, "type">> = {}): ResultReply {
    const frame = this.#unanswered.shift();
    if (!frame) throw new Error("FakeWorker.respond: no frame to answer");
    const reply: ResultReply = {
      type: "result",
      id: frame.id,
      found: false,
      corners: null,
      pose: null,
      intrinsics: intrinsicsFor(frame.id, frame.width, frame.height),
      ms: 2,
      buffer: frame.buffer,
      ...fields,
    };
    this.deliver(reply);
    return reply;
  }

  /** Answers the oldest unanswered frame with an `error` reply. */
  respondError(message = "worker failed"): void {
    const frame = this.#unanswered.shift();
    this.deliver({ type: "error", id: frame?.id ?? 0, message });
  }

  /** Delivers any reply through the last handler the tracker set, even after terminate(). */
  deliver(reply: WorkerResponse): void {
    const transfer: Transferable[] = [];
    if (reply.type === "result") {
      transfer.push(reply.buffer);
      if (reply.corners && reply.corners.buffer !== reply.buffer) transfer.push(reply.corners.buffer as ArrayBuffer);
    }
    const data = structuredClone(reply, { transfer }) as WorkerResponse;
    if (data.type === "result") this.deliveredBuffers.push(data.buffer);
    this.#keptMessage?.({ data });
  }

  /** Fires `onerror` through the last handler the tracker set. */
  crash(event: unknown = new Error("worker crashed")): void {
    this.#keptError?.(event);
  }

  terminate(): void {
    this.terminated++;
  }
}

/** Recognisable intrinsics for the reply to frame `id`, so replies can be told apart. */
export const intrinsicsFor = (id: number, width: number, height: number) => ({
  fx: 400 + id,
  fy: 400 + id,
  cx: (width - 1) / 2,
  cy: (height - 1) / 2,
});

/** A reply pose: a rotation about the optical axis by `deg` and the board `z` units ahead. */
export function replyPose(deg = 0, z = 5): NonNullable<ResultReply["pose"]> {
  const a = (deg * Math.PI) / 180;
  const c = Math.cos(a);
  const s = Math.sin(a);
  return { R: [c, -s, 0, s, c, 0, 0, 0, 1], t: [0.1, -0.2, z], rms: 0.05 + deg / 1000 };
}

/** Callbacks run only on `tick()`: the ones pending at that moment, first in, first out. */
export class ManualScheduler {
  #queue: { callback: () => void; cancelled: boolean }[] = [];
  requests = 0;

  request(callback: () => void): () => void {
    this.requests++;
    const entry = { callback, cancelled: false };
    this.#queue.push(entry);
    return () => {
      entry.cancelled = true;
    };
  }

  /** Runs the callbacks pending now; callbacks requested meanwhile wait for the next tick. */
  tick(): void {
    const due = this.#queue;
    this.#queue = [];
    for (const entry of due) if (!entry.cancelled) entry.callback();
  }

  /** Callbacks requested and neither run nor cancelled. */
  get pending(): number {
    return this.#queue.filter((entry) => !entry.cancelled).length;
  }
}

export class ManualClock {
  now = 0;
  set(ms: number): void {
    this.now = ms;
  }
  advance(ms: number): void {
    this.now += ms;
  }
}

/** One captureFrame call: its arguments, the shape of `out` at call time and a copy of the bytes it wrote. */
export interface Capture {
  readonly video: VideoLike;
  readonly width: number;
  readonly height: number;
  /** The view passed; its buffer is detached once the frame is posted. */
  readonly out: Uint8ClampedArray;
  readonly length: number;
  readonly byteOffset: number;
  readonly bytes: Uint8ClampedArray;
}

/** Byte k of capture n (counted from 1). */
export const captureByte = (n: number, k: number): number => (k * 7 + n * 31) % 256;

export interface Recorder {
  readonly updates: TrackingUpdate[];
  readonly violations: string[];
  onUpdate(update: TrackingUpdate): void;
}

const recorders: Recorder[] = [];

/** An `onUpdate` that stores every update and checks the invariants of P3-TRK-36 on it. */
export function recorder(): Recorder {
  const updates: TrackingUpdate[] = [];
  const violations: string[] = [];
  const rec: Recorder = {
    updates,
    violations,
    onUpdate(update) {
      const n = updates.length;
      if ((update.error !== null) !== (update.status === "error")) violations.push(`update ${n}: error ${update.error} with status ${update.status}`);
      if ((update.pose !== null) !== (update.status === "tracking")) violations.push(`update ${n}: pose ${update.pose ? "set" : "null"} with status ${update.status}`);
      if (!Number.isInteger(update.fps) || update.fps < 0) violations.push(`update ${n}: fps ${update.fps}`);
      updates.push(update);
    },
  };
  recorders.push(rec);
  return rec;
}

/** Violations recorded by every recorder since the last call, which forgets them. */
export function takeViolations(): string[] {
  const out = recorders.flatMap((rec) => rec.violations);
  recorders.length = 0;
  return out;
}

export interface RigOptions {
  readonly secure?: boolean;
  /** The video's size once it plays; default 1280 × 720. */
  readonly width?: number;
  readonly height?: number;
  /** Tracks in the camera stream: a video track, then audio tracks; default 1. */
  readonly tracks?: number;
}

/** One of each fake, with every dependency of startCameraAR supplied. */
export function rig({ secure = true, width = 1280, height = 720, tracks = 1 }: RigOptions = {}) {
  const clock = new ManualClock();
  const scheduler = new ManualScheduler();
  const media = fakeMediaDevices();
  const video = new FakeVideo(width, height);
  const stream = new FakeStream(Array.from({ length: tracks }, (_, k) => new FakeTrack(k === 0 ? "video" : "audio")));
  const workers: FakeWorker[] = [];
  const captures: Capture[] = [];
  const problems: string[] = [];
  const rec = recorder();
  const deps: CameraARDeps = {
    isSecureContext: secure,
    mediaDevices: media.mediaDevices,
    createWorker: vi.fn(() => {
      const worker = new FakeWorker();
      workers.push(worker);
      return worker;
    }),
    captureFrame: vi.fn((v: VideoLike, w: number, h: number, out: Uint8ClampedArray) => {
      if (out.length !== 4 * w * h) problems.push(`capture ${captures.length + 1}: out has ${out.length} bytes for ${w}×${h}`);
      if (out.buffer.byteLength === 0) problems.push(`capture ${captures.length + 1}: out is detached`);
      const n = captures.length + 1;
      for (let k = 0; k < out.length; k++) out[k] = captureByte(n, k);
      captures.push({ video: v, width: w, height: h, out, length: out.length, byteOffset: out.byteOffset, bytes: out.slice() });
    }),
    requestFrame: vi.fn((v: VideoLike, callback: () => void) => {
      void v;
      return scheduler.request(callback);
    }),
    now: vi.fn(() => clock.now),
  };
  return {
    clock,
    scheduler,
    media,
    video,
    stream,
    workers,
    captures,
    problems,
    rec,
    deps,
    /** The first worker created. */
    get worker(): FakeWorker {
      if (!workers[0]) throw new Error("no worker was created");
      return workers[0];
    },
    get updates(): TrackingUpdate[] {
      return rec.updates;
    },
    get statuses(): string[] {
      return rec.updates.map((u) => (u.status === "error" ? `error/${u.error}` : u.status));
    },
  };
}

export type Rig = ReturnType<typeof rig>;

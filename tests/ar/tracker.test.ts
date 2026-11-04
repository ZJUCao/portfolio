// P3 contract tests for startCameraAR in src/ar/tracker.ts: docs/design_camera_ar.md §5.5 (B1–B9)
// and §14 (OQ-02, OQ-32, OQ-37–OQ-45, OQ-48, OQ-49); test plan §5.1. Every case supplies every
// dependency through the fakes of test plan §2.6, so nothing here touches a browser global.

import { afterEach, describe, expect, it, vi } from "vitest";
import { type CameraAROptions, type CameraARDeps, type CameraError, type TrackingUpdate, startCameraAR } from "@/ar/tracker";
import {
  type FrameRequest,
  type Rig,
  type RigOptions,
  flush,
  intrinsicsFor,
  replyPose,
  rig,
  takeViolations,
} from "./helpers/cameraFakes";

const rigs: Rig[] = [];

afterEach(() => {
  // P3-TRK-36 is checked on every update of every case, and captureFrame on every call
  expect(takeViolations(), "TrackingUpdate invariants").toEqual([]);
  expect(rigs.flatMap((r) => r.problems), "captureFrame arguments").toEqual([]);
  rigs.length = 0;
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

type Options = Partial<Omit<CameraAROptions, "onUpdate">>;

function make(options?: RigOptions): Rig {
  const r = rig(options);
  rigs.push(r);
  return r;
}

const start = (r: Rig, options: Options = {}, deps: Partial<CameraARDeps> = r.deps) =>
  startCameraAR(r.video, { onUpdate: r.rec.onUpdate, ...options }, deps);

/** Starts the tracker and lets the camera open and play: status searching, one frame callback pending. */
async function running(r: Rig, options: Options = {}, deps: Partial<CameraARDeps> = r.deps) {
  const handle = start(r, options, deps);
  r.media.request.resolve(r.stream.media);
  await flush();
  r.video.playResult.resolve();
  await flush();
  return handle;
}

const last = (r: Rig): TrackingUpdate => r.updates[r.updates.length - 1];
const posts = (r: Rig): number => r.workers.reduce((n, w) => n + w.frames.length, 0);
const sentFrame = (r: Rig, n: number): FrameRequest => r.worker.posted[n].sent as FrameRequest;
const found = (deg = 0) => ({ found: true, pose: replyPose(deg) });

/** Ticks so the pending frame is captured and posted at `time`, then answers it at `replyTime`. */
function frameAt(r: Rig, time: number, fields: Parameters<Rig["worker"]["respond"]>[0] = {}, replyTime = time) {
  r.clock.set(time);
  r.scheduler.tick();
  r.clock.set(replyTime);
  return r.worker.respond(fields);
}

/** Every resource released: tracks stopped once when the stream was obtained, workers terminated once, no frame callback pending. */
function expectReleased(r: Rig, streamObtained: boolean) {
  for (const track of r.stream.tracks) expect(track.stops, `${track.kind} track stops`).toBe(streamObtained ? 1 : 0);
  for (const worker of r.workers) expect(worker.terminated, "terminate() calls").toBe(1);
  expect(r.scheduler.pending, "pending frame callbacks").toBe(0);
}

/** Settles and fires everything a fake can still do. */
async function poke(r: Rig) {
  r.media.request.resolve(r.stream.media);
  r.video.playResult.resolve();
  for (const worker of r.workers) {
    if (worker.unanswered > 0) worker.respond(found());
    worker.deliver({ type: "result", id: 1, found: true, corners: null, pose: replyPose(), intrinsics: intrinsicsFor(1, 640, 360), ms: 1, buffer: new ArrayBuffer(4) });
    worker.deliver({ type: "error", id: 1, message: "late" });
    worker.crash();
  }
  r.scheduler.tick();
  r.clock.advance(2000);
  await flush();
  r.scheduler.tick();
  await flush();
}

const DEFAULT_CONSTRAINTS = {
  audio: false,
  video: { facingMode: { ideal: "environment" }, width: { ideal: 1280 }, height: { ideal: 720 } },
};

describe("startCameraAR (§5.5)", () => {
  it("P3-TRK-01 B1 emits exactly one update, starting, before it returns (OQ-37)", () => {
    const r = make();
    start(r);
    expect(r.updates).toStrictEqual([{ status: "starting", error: null, pose: null, intrinsics: null, frame: null, fps: 0 }]);
  });

  it("P3-TRK-02 B2 without a secure context ends in error/insecure and never calls getUserMedia", async () => {
    const r = make({ secure: false });
    start(r);
    await flush();
    expect(r.statuses).toEqual(["starting", "error/insecure"]);
    expect(r.updates[1]).toMatchObject({ pose: null, intrinsics: null, frame: null, fps: 0 });
    await poke(r);
    expect(r.updates).toHaveLength(2);
    expect(r.media.getUserMedia).not.toHaveBeenCalled();
  });

  it("P3-TRK-03 B2 without mediaDevices.getUserMedia ends in error/unsupported", async () => {
    const inputs: [string, unknown][] = [
      ["mediaDevices undefined", undefined],
      ["mediaDevices without getUserMedia", {}],
    ];
    for (const [label, mediaDevices] of inputs) {
      const r = make();
      start(r, {}, { ...r.deps, mediaDevices: mediaDevices as CameraARDeps["mediaDevices"] });
      await flush();
      expect(r.statuses, label).toEqual(["starting", "error/unsupported"]);
      await poke(r);
      expect(r.updates, label).toHaveLength(2);
    }
  });

  it("P3-TRK-04 B2 an insecure context wins over missing mediaDevices", async () => {
    const r = make({ secure: false });
    start(r, {}, { ...r.deps, mediaDevices: undefined });
    await flush();
    expect(r.statuses).toEqual(["starting", "error/insecure"]);
  });

  it("P3-TRK-05 B3 asks once for the rear camera at 1280 × 720 without audio", async () => {
    const r = make();
    start(r);
    await flush();
    expect(r.media.getUserMedia).toHaveBeenCalledTimes(1);
    expect(r.media.getUserMedia.mock.calls[0][0]).toStrictEqual(DEFAULT_CONSTRAINTS);
  });

  it("P3-TRK-06 B3 facingMode user changes only the facing mode", async () => {
    const r = make();
    start(r, { facingMode: "user" });
    await flush();
    expect(r.media.getUserMedia).toHaveBeenCalledTimes(1);
    expect(r.media.getUserMedia.mock.calls[0][0]).toStrictEqual({
      ...DEFAULT_CONSTRAINTS,
      video: { ...DEFAULT_CONSTRAINTS.video, facingMode: { ideal: "user" } },
    });
  });

  it("P3-TRK-07 B4 maps getUserMedia rejections by name", async () => {
    const cases: [string, unknown, CameraError][] = [
      ["DOMException NotAllowedError", new DOMException("no", "NotAllowedError"), "denied"],
      ["{ name: NotAllowedError }", { name: "NotAllowedError" }, "denied"],
      ["DOMException SecurityError", new DOMException("no", "SecurityError"), "denied"],
      ["{ name: SecurityError }", { name: "SecurityError" }, "denied"],
      ["DOMException NotFoundError", new DOMException("none", "NotFoundError"), "no-camera"],
      ["{ name: NotFoundError }", { name: "NotFoundError" }, "no-camera"],
      ["DOMException OverconstrainedError", new DOMException("none", "OverconstrainedError"), "no-camera"],
      ["{ name: OverconstrainedError }", { name: "OverconstrainedError", constraint: "facingMode" }, "no-camera"],
      ["DOMException AbortError", new DOMException("abort", "AbortError"), "failed"],
      ["DOMException NotReadableError", new DOMException("busy", "NotReadableError"), "failed"],
      ["TypeError", new TypeError("bad constraints"), "failed"],
      ["{}", {}, "failed"],
      ["a string", "NotAllowedError", "failed"],
      ["undefined", undefined, "failed"],
    ];
    for (const [label, reason, error] of cases) {
      const r = make();
      start(r);
      r.media.request.reject(reason);
      await flush();
      expect(r.statuses, label).toEqual(["starting", `error/${error}`]);
    }
  });

  it("P3-TRK-08 B4 every error is terminal and releases everything", async () => {
    const stages: [string, (r: Rig) => Promise<void>, boolean][] = [
      ["insecure", async (r) => void start(r, {}, { ...r.deps, isSecureContext: false }), false],
      ["unsupported", async (r) => void start(r, {}, { ...r.deps, mediaDevices: undefined }), false],
      ["denied", async (r) => {
        start(r);
        r.media.request.reject(new DOMException("no", "NotAllowedError"));
      }, false],
      ["play() rejected", async (r) => {
        start(r);
        r.media.request.resolve(r.stream.media);
        await flush();
        r.video.playResult.reject(new Error("no autoplay"));
      }, true],
      ["worker error reply", async (r) => {
        await running(r);
        frameAt(r, 0, found());
        r.scheduler.tick();
        r.worker.respondError("boom");
      }, true],
      ["worker onerror", async (r) => {
        await running(r);
        r.scheduler.tick();
        r.worker.crash();
      }, true],
    ];
    for (const [label, drive, streamObtained] of stages) {
      const r = make({ tracks: 2 });
      await drive(r);
      await flush();
      expect(last(r).status, label).toBe("error");
      const count = r.updates.length;
      await poke(r);
      expect(r.updates.length, `${label}: updates after the error`).toBe(count);
      expectReleased(r, streamObtained);
    }
  });

  it("P3-TRK-09 B4 a rejected play() is always failed (OQ-41)", async () => {
    for (const reason of [new Error("no autoplay"), new DOMException("blocked", "NotAllowedError")]) {
      const r = make({ tracks: 2 });
      start(r);
      r.media.request.resolve(r.stream.media);
      await flush();
      r.video.playResult.reject(reason);
      await flush();
      expect(r.statuses, String(reason)).toEqual(["starting", "error/failed"]);
      expectReleased(r, true);
    }
  });

  it("P3-TRK-10 B4 a worker error reply ends in error/failed", async () => {
    const r = make();
    await running(r);
    r.scheduler.tick();
    r.worker.respondError("process failed");
    expect(r.statuses).toEqual(["starting", "searching", "error/failed"]);
    await poke(r);
    expect(r.updates).toHaveLength(3);
    expectReleased(r, true);
  });

  it("P3-TRK-11 B4 a worker onerror event ends in error/failed", async () => {
    const r = make();
    await running(r);
    r.scheduler.tick();
    r.worker.crash(new Event("error"));
    expect(r.statuses).toEqual(["starting", "searching", "error/failed"]);
    await poke(r);
    expect(r.updates).toHaveLength(3);
    expectReleased(r, true);
  });

  it("P3-TRK-12 B4 a dependency that throws ends in error/failed (OQ-42)", async () => {
    const boom = () => {
      throw new Error("dependency failed");
    };
    const overrides: [string, Partial<CameraARDeps>][] = [
      ["createWorker", { createWorker: boom }],
      ["captureFrame", { captureFrame: boom }],
      ["requestFrame", { requestFrame: boom }],
    ];
    for (const [label, override] of overrides) {
      const r = make({ tracks: 2 });
      await running(r, {}, { ...r.deps, ...override });
      r.scheduler.tick();
      await flush();
      expect(last(r).status, label).toBe("error");
      expect(last(r).error, label).toBe("failed");
      const count = r.updates.length;
      await poke(r);
      expect(r.updates.length, `${label}: updates after the error`).toBe(count);
      expectReleased(r, true);
    }
  });

  it("P3-TRK-13 B5 searching follows play(), which follows attaching the stream", async () => {
    const r = make();
    start(r);
    await flush();
    expect(r.video.playCalls).toHaveLength(0);
    r.media.request.resolve(r.stream.media);
    await flush();
    expect(r.video.playCalls).toHaveLength(1);
    expect(r.video.playCalls[0]).toBe(r.stream.media);
    expect(r.statuses).toEqual(["starting"]);
    expect(r.deps.requestFrame).not.toHaveBeenCalled();
    r.video.playResult.resolve();
    await flush();
    expect(r.statuses).toEqual(["starting", "searching"]);
    expect(r.updates[1]).toMatchObject({ error: null, pose: null });
    expect(r.deps.requestFrame).toHaveBeenCalled();
  });

  it("P3-TRK-14 B6 keeps one frame in flight", async () => {
    const r = make();
    await running(r);
    r.scheduler.tick();
    expect(posts(r)).toBe(1);
    for (let k = 0; k < 10; k++) r.scheduler.tick();
    expect(posts(r), "no post while a frame is in flight").toBe(1);
    r.worker.respond();
    expect(posts(r)).toBe(1);
    r.scheduler.tick();
    expect(posts(r), "posted on the tick after the reply").toBe(2);

    let replies = 1;
    for (let k = 0; k < 50; k++) {
      for (let t = 0; t < k % 4; t++) {
        r.scheduler.tick();
        expect(posts(r)).toBeLessThanOrEqual(replies + 1);
      }
      r.worker.respond(k % 2 ? found(k) : {});
      replies++;
      expect(posts(r)).toBeLessThanOrEqual(replies + 1);
      r.scheduler.tick();
      expect(posts(r), `frame ${k}`).toBe(replies + 1);
    }
  });

  it("P3-TRK-15 B6 posts { type, id, width, height, buffer, time } and transfers the buffer (OQ-49)", async () => {
    const r = make();
    await running(r);
    r.clock.set(1234.5);
    r.scheduler.tick();
    const { sent, transfer, received } = r.worker.posted[0];
    const frame = received as FrameRequest;
    expect(Object.keys(frame).sort()).toEqual(["buffer", "height", "id", "time", "type", "width"]);
    expect(frame).toMatchObject({ type: "frame", width: 640, height: 360, time: 1234.5 });
    expect(Number.isInteger(frame.id)).toBe(true);
    expect(frame.buffer.byteLength).toBe(4 * 640 * 360);
    expect(transfer).toContain((sent as FrameRequest).buffer);
    expect((sent as FrameRequest).buffer.byteLength, "the posted buffer is detached").toBe(0);
  });

  it("P3-TRK-16 B6 captures into a view over the posted buffer", async () => {
    const r = make();
    await running(r);
    r.scheduler.tick();
    expect(r.captures).toHaveLength(1);
    const capture = r.captures[0];
    expect(capture.video).toBe(r.video);
    expect([capture.width, capture.height]).toEqual([640, 360]);
    expect(capture.out).toBeInstanceOf(Uint8ClampedArray);
    expect(capture.length).toBe(4 * 640 * 360);
    expect(capture.byteOffset).toBe(0);
    expect(capture.out.buffer).toBe(sentFrame(r, 0).buffer);
    const received = r.worker.frames[0];
    expect(Buffer.from(received.buffer).equals(Buffer.from(capture.bytes.buffer)), "posted bytes are the captured ones").toBe(true);
  });

  it("P3-TRK-17 B6 analysis size: long side min(analysisLongSide, video), aspect kept, rounded (OQ-48)", async () => {
    const cases: [number, number, number, number, Options][] = [
      [1280, 720, 640, 360, {}],
      [720, 1280, 360, 640, {}],
      [1920, 1080, 640, 360, {}],
      [640, 480, 640, 480, {}],
      [320, 240, 320, 240, {}],
      [1366, 768, 640, 360, {}],
      [1000, 563, 640, 360, {}],
      [720, 720, 640, 640, {}],
      [2000, 1, 640, 1, {}],
      [1280, 720, 480, 270, { analysisLongSide: 480 }],
    ];
    for (const [vw, vh, w, h, options] of cases) {
      const r = make({ width: vw, height: vh });
      await running(r, options);
      r.scheduler.tick();
      const frame = r.worker.frames[0];
      expect([frame.width, frame.height], `${vw}×${vh} ${JSON.stringify(options)}`).toEqual([w, h]);
    }
  });

  it("P3-TRK-18 B6 skips frames while the video has no size", async () => {
    for (const [vw, vh] of [[0, 720], [1280, 0], [0, 0]]) {
      const r = make({ width: vw, height: vh });
      await running(r);
      for (let k = 0; k < 3; k++) {
        r.scheduler.tick();
        expect(r.captures, `${vw}×${vh}`).toHaveLength(0);
        expect(posts(r)).toBe(0);
        expect(r.scheduler.pending, "a frame callback stays requested").toBe(1);
      }
      r.video.videoWidth = 1280;
      r.video.videoHeight = 720;
      r.scheduler.tick();
      expect(posts(r), `${vw}×${vh} then 1280×720`).toBe(1);
      expect(r.worker.frames[0].width).toBe(640);
    }
  });

  it("P3-TRK-19 B6 reuses the buffer returned with a reply for the next frame of the same size", async () => {
    const r = make();
    await running(r);
    r.scheduler.tick();
    r.worker.respond();
    r.scheduler.tick();
    expect(sentFrame(r, 1).buffer).toBe(r.worker.deliveredBuffers[0]);
    r.worker.respond(found());
    r.scheduler.tick();
    expect(sentFrame(r, 2).buffer).toBe(r.worker.deliveredBuffers[1]);
    r.worker.respond();
    r.video.videoWidth = 640;
    r.video.videoHeight = 480;
    r.scheduler.tick();
    expect(sentFrame(r, 3).buffer).not.toBe(r.worker.deliveredBuffers[2]);
    const frame = r.worker.frames[3];
    expect([frame.width, frame.height]).toEqual([640, 480]);
    expect(frame.buffer.byteLength).toBe(4 * 640 * 480);
  });

  it("P3-TRK-20 B6/B7 frame ids strictly increase and replies with other ids are ignored (OQ-45)", async () => {
    const r = make();
    await running(r);
    for (let k = 0; k < 5; k++) frameAt(r, k * 33, k % 2 ? found() : {});
    r.scheduler.tick();
    const ids = r.worker.frames.map((f) => f.id);
    for (let k = 1; k < ids.length; k++) expect(ids[k]).toBeGreaterThan(ids[k - 1]);
    const count = r.updates.length;
    const stray = (id: number) =>
      r.worker.deliver({ type: "result", id, found: true, corners: null, pose: replyPose(), intrinsics: intrinsicsFor(id, 640, 360), ms: 1, buffer: new ArrayBuffer(4 * 640 * 360) });
    stray(ids[ids.length - 1] + 100);
    stray(ids[0]);
    r.worker.deliver({ type: "error", id: ids[ids.length - 1] + 100, message: "stray" });
    expect(r.updates.length, "stray replies produce no update").toBe(count);
    r.scheduler.tick();
    expect(r.worker.frames, "the frame is still in flight").toHaveLength(6);
    r.worker.respond();
    expect(r.updates.length).toBe(count + 1);
  });

  it("P3-TRK-21 B7 every reply produces exactly one update and ticks alone produce none", async () => {
    const r = make();
    await running(r);
    const base = r.updates.length;
    for (let k = 0; k < 7; k++) {
      r.scheduler.tick();
      r.scheduler.tick();
      r.scheduler.tick();
      r.worker.respond(k % 3 ? {} : found(k));
    }
    expect(r.updates.length - base).toBe(7);
    for (let k = 0; k < 5; k++) r.scheduler.tick();
    expect(r.updates.length - base).toBe(7);
  });

  it("P3-TRK-22 B7 a found reply gives tracking with its pose, intrinsics and frame size", async () => {
    const r = make();
    await running(r);
    const pose = replyPose(30, 4);
    const reply = frameAt(r, 0, { found: true, pose });
    const u = last(r);
    expect(u.status).toBe("tracking");
    expect(u.pose?.R).toBeInstanceOf(Float64Array);
    expect(u.pose?.t).toBeInstanceOf(Float64Array);
    expect(Array.from(u.pose!.R)).toEqual(pose.R);
    expect(Array.from(u.pose!.t)).toEqual(pose.t);
    expect(u.pose?.rms).toBe(pose.rms);
    expect(u.intrinsics).toEqual(reply.intrinsics);
    expect(u.frame).toEqual({ width: 640, height: 360 });

    // The video changes size while the frame is in flight: the update keeps the frame's own size
    r.scheduler.tick();
    r.video.videoWidth = 640;
    r.video.videoHeight = 480;
    const second = r.worker.respond({ found: true, pose: replyPose(10) });
    expect(last(r).frame).toEqual({ width: 640, height: 360 });
    expect(last(r).intrinsics).toEqual(second.intrinsics);
  });

  it("P3-TRK-23 B7 keeps the last pose for holdMs after the board is lost (D3)", async () => {
    const run = async (options: Options, steps: [number, boolean][]) => {
      const r = make();
      await running(r, options);
      for (const [t, isFound] of steps) frameAt(r, 1000 + t, isFound ? found(t + 1) : {});
      return r.updates.slice(2);
    };
    const held = await run({}, [[0, true], [200, false], [600, false]]);
    expect(held.map((u) => u.status)).toEqual(["tracking", "tracking", "searching"]);
    expect(Array.from(held[1].pose!.R)).toEqual(replyPose(1).R);
    expect(held[2].pose).toBeNull();

    const short = await run({ holdMs: 200 }, [[0, true], [150, false], [250, false]]);
    expect(short.map((u) => u.status)).toEqual(["tracking", "tracking", "searching"]);

    const none = await run({ holdMs: 0 }, [[0, true], [1, false]]);
    expect(none.map((u) => u.status)).toEqual(["tracking", "searching"]);
  });

  it("P3-TRK-24 B7 the hold runs between reply arrivals, not capture times", async () => {
    const r = make();
    await running(r);
    frameAt(r, 0, found(), 100);
    frameAt(r, 130, {}, 650);
    expect(r.updates.slice(2).map((u) => u.status)).toEqual(["tracking", "searching"]);
  });

  it("P3-TRK-25 B7 a board found again is tracked and held with its new pose", async () => {
    const r = make();
    await running(r);
    frameAt(r, 0, found(5));
    frameAt(r, 600, {});
    frameAt(r, 700, found(25));
    frameAt(r, 1000, {});
    const updates = r.updates.slice(2);
    expect(updates.map((u) => u.status)).toEqual(["tracking", "searching", "tracking", "tracking"]);
    expect(Array.from(updates[2].pose!.R)).toEqual(replyPose(25).R);
    expect(Array.from(updates[3].pose!.R)).toEqual(replyPose(25).R);
  });

  it("P3-TRK-26 B7 a miss exactly holdMs later is still held, with the found reply's intrinsics and frame (OQ-38)", async () => {
    const r = make();
    await running(r);
    const hit = frameAt(r, 0, found(7));
    r.video.videoWidth = 640;
    r.video.videoHeight = 480;
    const miss = frameAt(r, 500, {});
    expect(miss.intrinsics).not.toEqual(hit.intrinsics);
    const u = last(r);
    expect(u.status).toBe("tracking");
    expect(Array.from(u.pose!.R)).toEqual(replyPose(7).R);
    expect(u.intrinsics).toEqual(hit.intrinsics);
    expect(u.frame).toEqual({ width: 640, height: 360 });
  });

  it("P3-TRK-27 B8 fps counts the replies of the last 1000 ms, found or not", async () => {
    const r = make();
    // No hold, so that the misses show as searching and both kinds are visibly counted
    await running(r, { holdMs: 0 });
    let t = 0;
    for (let k = 0; t <= 2000; k++, t = k * 34) frameAt(r, t, k % 3 === 0 ? found(k) : {});
    const updates = r.updates.slice(2);
    expect(updates[0].fps, "the first reply").toBe(1);
    for (let k = 29; k < updates.length; k++) expect(updates[k].fps, `reply ${k}`).toBe(30);
    expect(new Set(updates.map((u) => u.status))).toEqual(new Set(["tracking", "searching"]));
    frameAt(r, t + 1500, found());
    expect(last(r).fps, "after a 1.5 s gap").toBe(1);
  });

  it("P3-TRK-28 B8 a reply exactly 1000 ms old is not counted (OQ-39)", async () => {
    const r = make();
    await running(r);
    frameAt(r, 0, {});
    frameAt(r, 1000, {});
    expect(last(r).fps).toBe(1);
    const s = make();
    await running(s);
    frameAt(s, 0, {});
    frameAt(s, 999, {});
    expect(last(s).fps).toBe(2);
  });

  it("P3-TRK-29 B9 stop() while tracking releases everything and silences later events", async () => {
    const r = make({ tracks: 2 });
    const handle = await running(r);
    frameAt(r, 0, found());
    expect(r.scheduler.pending).toBe(1);
    const count = r.updates.length;
    handle.stop();
    expect(r.updates.length, "stop() emits nothing").toBe(count);
    expectReleased(r, true);
    r.worker.deliver({ type: "result", id: 2, found: true, corners: null, pose: replyPose(), intrinsics: intrinsicsFor(2, 640, 360), ms: 1, buffer: new ArrayBuffer(4) });
    r.worker.crash();
    r.scheduler.tick();
    r.clock.advance(5000);
    await flush();
    expect(r.updates.length).toBe(count);
    expect(posts(r)).toBe(1);
  });

  it("P3-TRK-30 B9 stop() is idempotent (OQ-44)", async () => {
    const r = make({ tracks: 2 });
    const handle = await running(r);
    frameAt(r, 0, found());
    const count = r.updates.length;
    handle.stop();
    expect(() => handle.stop()).not.toThrow();
    expect(r.updates.length).toBe(count);
    expectReleased(r, true);
  });

  it("P3-TRK-31 B9 a stream arriving after stop() is stopped and never attached (OQ-43)", async () => {
    const r = make({ tracks: 2 });
    const handle = start(r);
    handle.stop();
    r.media.request.resolve(r.stream.media);
    await flush();
    expect(r.statuses).toEqual(["starting"]);
    for (const track of r.stream.tracks) expect(track.stops).toBe(1);
    expect(r.video.assignments).toEqual([]);
    expect(r.video.playCalls).toEqual([]);
  });

  it("P3-TRK-32 B9 a getUserMedia rejection after stop() is silent", async () => {
    const r = make();
    const handle = start(r);
    handle.stop();
    r.media.request.reject(new DOMException("no", "NotAllowedError"));
    await flush();
    expect(r.statuses).toEqual(["starting"]);
  });

  it("P3-TRK-33 B9 stop() while play() is pending: no searching, no frames, tracks stopped", async () => {
    const r = make({ tracks: 2 });
    const handle = start(r);
    r.media.request.resolve(r.stream.media);
    await flush();
    handle.stop();
    r.video.playResult.resolve();
    await flush();
    expect(r.statuses).toEqual(["starting"]);
    expect(r.deps.requestFrame).not.toHaveBeenCalled();
    expectReleased(r, true);
  });

  it("P3-TRK-34 B9 stop() with a frame in flight ignores the late reply", async () => {
    const r = make();
    const handle = await running(r);
    r.scheduler.tick();
    const count = r.updates.length;
    handle.stop();
    r.worker.respond(found());
    r.scheduler.tick();
    await flush();
    expect(r.updates.length).toBe(count);
    expect(r.worker.terminated).toBe(1);
    expect(posts(r)).toBe(1);
  });

  it("P3-TRK-35 B9 stop() after an error does nothing", async () => {
    const r = make();
    const handle = start(r);
    r.media.request.reject(new DOMException("no", "NotAllowedError"));
    await flush();
    expect(r.statuses).toEqual(["starting", "error/denied"]);
    expect(() => handle.stop()).not.toThrow();
    expect(r.updates).toHaveLength(2);
  });

  it("P3-TRK-36 TrackingUpdate invariants hold through every status", async () => {
    const r = make();
    await running(r);
    frameAt(r, 0, {});
    frameAt(r, 100, found());
    frameAt(r, 300, {});
    frameAt(r, 900, {});
    r.scheduler.tick();
    r.worker.crash();
    expect(new Set(r.statuses)).toEqual(new Set(["starting", "searching", "tracking", "error/failed"]));
    expect(takeViolations()).toEqual([]);
  });

  it("P3-TRK-37 intrinsics and frame are null until the first reply, then the latest reply's (OQ-37)", async () => {
    const r = make();
    await running(r);
    for (const u of r.updates) expect([u.status, u.intrinsics, u.frame]).toEqual([u.status, null, null]);
    const first = frameAt(r, 0, {});
    expect(last(r)).toMatchObject({ status: "searching", intrinsics: first.intrinsics, frame: { width: 640, height: 360 } });
    r.video.videoWidth = 640;
    r.video.videoHeight = 480;
    const second = frameAt(r, 33, {});
    expect(last(r)).toMatchObject({ status: "searching", intrinsics: second.intrinsics, frame: { width: 640, height: 480 } });
    r.scheduler.tick();
    r.worker.respondError();
    expect(last(r)).toMatchObject({ status: "error", intrinsics: second.intrinsics, frame: { width: 640, height: 480 } });
  });

  it("P3-TRK-38 B2 insecure and unsupported arrive after startCameraAR returns (OQ-40)", async () => {
    for (const deps of [{ isSecureContext: false }, { mediaDevices: undefined }] as Partial<CameraARDeps>[]) {
      const r = make();
      start(r, {}, { ...r.deps, ...deps });
      expect(r.statuses, JSON.stringify(deps)).toEqual(["starting"]);
      await Promise.resolve();
      expect(r.updates, JSON.stringify(deps)).toHaveLength(2);
    }
  });

  it("P3-TRK-39 with every dependency supplied it never touches window, navigator or document (OQ-02)", async () => {
    const touched: string[] = [];
    const trap = (name: string) =>
      new Proxy({}, {
        get(_, key) {
          touched.push(`${name}.${String(key)}`);
          throw new Error(`touched ${name}`);
        },
        has(_, key) {
          touched.push(`${String(key)} in ${name}`);
          return false;
        },
      });
    for (const name of ["window", "navigator", "document"]) vi.stubGlobal(name, trap(name));

    const r = make({ tracks: 2 });
    const handle = await running(r);
    frameAt(r, 0, found());
    frameAt(r, 33, {});
    handle.stop();
    const insecure = make({ secure: false });
    start(insecure);
    await flush();
    vi.unstubAllGlobals();

    expect(touched).toEqual([]);
    expect(r.statuses).toEqual(["starting", "searching", "tracking", "tracking"]);
    expect(insecure.statuses).toEqual(["starting", "error/insecure"]);
  });

  it("P3-TRK-40 invalid options throw RangeError (OQ-32)", () => {
    for (const options of [{ analysisLongSide: 0 }, { analysisLongSide: -1 }, { holdMs: -1 }]) {
      const r = make();
      expect(() => start(r, options), JSON.stringify(options)).toThrow(RangeError);
      expect(r.media.getUserMedia, JSON.stringify(options)).not.toHaveBeenCalled();
    }
  });
});

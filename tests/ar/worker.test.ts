// P2 contract tests for handleWorkerMessage and the worker entry src/ar/tracker.worker.ts:
// docs/design_camera_ar.md §5.4 and §14 (OQ-36); test plan §4.8.

import { afterEach, describe, expect, it, vi } from "vitest";
import { type FrameInput, type FrameOutput, type WorkerRequest, type WorkerResponse, createPipeline, handleWorkerMessage } from "@/ar/pipeline";
import { blankFrame, movingBoard } from "./helpers/frames";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

type Pipeline = ReturnType<typeof createPipeline>;
type FrameRequest = Extract<WorkerRequest, { type: "frame" }>;
type ResultReply = Extract<WorkerResponse, { type: "result" }>;
type ErrorReply = Extract<WorkerResponse, { type: "error" }>;

/** A found output with recognisable values; a new one per call, since replies get transferred. */
function foundOutput(): FrameOutput {
  return {
    found: true,
    corners: Float32Array.from({ length: 108 }, (_, k) => 100 + k / 4),
    pose: {
      R: Float64Array.of(0.8, -0.6, 0, 0.6, 0.8, 0, 0, 0, 1),
      t: Float64Array.of(0.1, -0.2, 5),
      rms: 0.125,
    },
    intrinsics: { fx: 500, fy: 500, cx: 159.5, cy: 89.5 },
    ms: 3.5,
  };
}

const lostOutput = (): FrameOutput => ({ found: false, corners: null, pose: null, intrinsics: { fx: 277, fy: 277, cx: 159.5, cy: 89.5 }, ms: 1.25 });

function fakePipeline(process: (frame: FrameInput) => FrameOutput) {
  const spies = { process: vi.fn(process), reset: vi.fn() };
  return { pipeline: spies as Pipeline, ...spies };
}

/** A frame message over a buffer filled with a byte pattern. */
function frameMessage(id: number, width = 320, height = 180, bytes = 4 * width * height): FrameRequest {
  const buffer = new ArrayBuffer(bytes);
  new Uint8Array(buffer).forEach((_, k, array) => (array[k] = k % 251));
  return { type: "frame", id, width, height, buffer, time: 1234.5 };
}

/** A frame message carrying the bytes of a test frame. */
function messageFor(id: number, frame: { width: number; height: number; rgba: Uint8ClampedArray }): FrameRequest {
  return { type: "frame", id, width: frame.width, height: frame.height, buffer: frame.rgba.slice().buffer, time: 0 };
}

function handled(pipeline: Pipeline, message: unknown): { reply: WorkerResponse; transfer: Transferable[] } {
  const out = handleWorkerMessage(pipeline, message as WorkerRequest);
  expect(out, "a reply").not.toBeNull();
  return out as { reply: WorkerResponse; transfer: Transferable[] };
}

function asResult(reply: WorkerResponse): ResultReply {
  expect(reply.type).toBe("result");
  return reply as ResultReply;
}

function asError(reply: WorkerResponse): ErrorReply {
  expect(reply.type).toBe("error");
  return reply as ErrorReply;
}

describe("handleWorkerMessage (§5.4)", () => {
  it("P2-WRK-01 a frame becomes a result with the output's fields, the pose as plain arrays and the same buffer", () => {
    const output = foundOutput();
    const { pipeline } = fakePipeline(() => output);
    const message = frameMessage(7);
    const reply = asResult(handled(pipeline, message).reply);
    expect(reply.id).toBe(7);
    expect(reply.found).toBe(true);
    expect(reply.corners).toEqual(output.corners);
    expect(reply.intrinsics).toEqual(output.intrinsics);
    expect(reply.ms).toBe(3.5);
    expect(Array.isArray(reply.pose?.R), "R is a plain array").toBe(true);
    expect(Array.isArray(reply.pose?.t), "t is a plain array").toBe(true);
    expect(reply.pose?.R).toEqual(Array.from(output.pose?.R ?? []));
    expect(reply.pose?.t).toEqual(Array.from(output.pose?.t ?? []));
    expect(reply.pose?.rms).toBe(0.125);
    expect(reply.buffer).toBe(message.buffer);
  });

  it("P2-WRK-02 the buffer is passed to process as RGBA over all of it, with width, height and time", () => {
    const { pipeline, process } = fakePipeline(() => lostOutput());
    const message = frameMessage(3);
    handled(pipeline, message);
    expect(process).toHaveBeenCalledTimes(1);
    const frame = process.mock.calls[0][0];
    expect([frame.width, frame.height, frame.time]).toEqual([320, 180, 1234.5]);
    expect(frame.rgba).toBeInstanceOf(Uint8ClampedArray);
    expect(frame.rgba.buffer).toBe(message.buffer);
    expect(frame.rgba.byteOffset).toBe(0);
    expect(frame.rgba.length).toBe(message.buffer.byteLength);
  });

  it("P2-WRK-03 the transfer list is exactly the frame buffer and the corners' buffer, or the frame buffer alone", () => {
    const found = frameMessage(1);
    const { reply, transfer } = handled(fakePipeline(() => foundOutput()).pipeline, found);
    const corners = asResult(reply).corners as Float32Array;
    expect(transfer.length, "found: two buffers").toBe(2);
    expect(new Set(transfer).size, "found: no duplicates").toBe(2);
    expect(transfer).toContain(found.buffer);
    expect(transfer).toContain(corners.buffer);
    const lost = frameMessage(2);
    const result = handled(fakePipeline(() => lostOutput()).pipeline, lost);
    expect(result.transfer.length, "not found: one buffer").toBe(1);
    expect(result.transfer[0]).toBe(lost.buffer);
  });

  it("P2-WRK-04 the reply can be transferred: both buffers are detached and the copy keeps the data", () => {
    const output = foundOutput();
    const expectedCorners = Array.from(output.corners ?? []);
    const message = frameMessage(5);
    const expectedBytes = Array.from(new Uint8Array(message.buffer));
    const { reply, transfer } = handled(fakePipeline(() => output).pipeline, message);
    const corners = asResult(reply).corners as Float32Array;
    const copy = structuredClone(reply, { transfer }) as ResultReply;
    expect(message.buffer.byteLength, "frame buffer detached").toBe(0);
    expect(corners.byteLength, "corners' buffer detached").toBe(0);
    expect(Array.from(copy.corners ?? [])).toEqual(expectedCorners);
    expect(Array.from(new Uint8Array(copy.buffer))).toEqual(expectedBytes);
  });

  it("P2-WRK-05 a reset message calls pipeline.reset() once and returns null", () => {
    const { pipeline, process, reset } = fakePipeline(() => lostOutput());
    expect(handleWorkerMessage(pipeline, { type: "reset" })).toBeNull();
    expect(reset).toHaveBeenCalledTimes(1);
    expect(process).not.toHaveBeenCalled();
  });

  it("P2-WRK-06 a message of another type returns null without touching the pipeline", () => {
    const { pipeline, process, reset } = fakePipeline(() => lostOutput());
    expect(handleWorkerMessage(pipeline, { type: "bogus" } as unknown as WorkerRequest)).toBeNull();
    expect(process).not.toHaveBeenCalled();
    expect(reset).not.toHaveBeenCalled();
  });

  it("P2-WRK-07 an Error thrown by process becomes an error reply with its message and an empty transfer list", () => {
    const { pipeline } = fakePipeline(() => {
      throw new Error("boom");
    });
    const { reply, transfer } = handled(pipeline, frameMessage(9));
    expect(asError(reply)).toEqual({ type: "error", id: 9, message: "boom" });
    expect(transfer).toEqual([]);
  });

  it("P2-WRK-08 other thrown values give String(value); non-object messages return null without throwing (OQ-36)", () => {
    const custom = { toString: () => "custom text" };
    for (const [thrown, text] of [
      ["a string", "a string"],
      [42, "42"],
      [{ code: 7 }, "[object Object]"],
      [custom, "custom text"],
      [null, "null"],
      [undefined, "undefined"],
    ] as const) {
      const { pipeline } = fakePipeline(() => {
        throw thrown;
      });
      const { reply, transfer } = handled(pipeline, frameMessage(11));
      expect(asError(reply), `thrown ${String(thrown)}`).toEqual({ type: "error", id: 11, message: text });
      expect(transfer).toEqual([]);
    }
    const { pipeline, process, reset } = fakePipeline(() => lostOutput());
    for (const message of [null, undefined, 7, "frame"]) {
      expect(handleWorkerMessage(pipeline, message as unknown as WorkerRequest), `message ${String(message)}`).toBeNull();
    }
    expect(process).not.toHaveBeenCalled();
    expect(reset).not.toHaveBeenCalled();
  });

  it("P2-WRK-09 with the real pipeline a board frame gives a pose and 108 corners, a blank frame neither", { timeout: 60_000 }, () => {
    const pipeline = createPipeline();
    const board = asResult(handled(pipeline, messageFor(1, movingBoard()[0])).reply);
    expect(board.found).toBe(true);
    expect(board.pose).not.toBeNull();
    expect(board.pose?.R.length).toBe(9);
    expect(board.pose?.t.length).toBe(3);
    expect(board.corners?.length).toBe(108);
    const message = messageFor(2, blankFrame(320, 180));
    const { reply, transfer } = handled(pipeline, message);
    const blank = asResult(reply);
    expect(blank.found).toBe(false);
    expect(blank.pose).toBeNull();
    expect(blank.corners).toBeNull();
    expect(transfer).toEqual([message.buffer]);
  });

  it("P2-WRK-10 with the real pipeline a buffer 4 bytes too short gives an error reply with the same id", () => {
    const { reply, transfer } = handled(createPipeline(), frameMessage(12, 320, 180, 4 * 320 * 180 - 4));
    const error = asError(reply);
    expect(error.id).toBe(12);
    expect(typeof error.message).toBe("string");
    expect(transfer).toEqual([]);
  });
});

describe("tracker.worker.ts (§5.4)", () => {
  interface FakeScope {
    onmessage: ((event: { data: unknown }) => unknown) | null;
    postMessage: ReturnType<typeof vi.fn>;
  }

  /** Imports a fresh copy of the worker entry with a fake worker scope as `self`. */
  async function startWorker(): Promise<FakeScope> {
    const scope: FakeScope = { onmessage: null, postMessage: vi.fn() };
    vi.stubGlobal("self", scope);
    vi.resetModules();
    await import("@/ar/tracker.worker");
    return scope;
  }

  /** Dispatches a message event and lets any pending promise settle. */
  async function dispatch(scope: FakeScope, data: unknown): Promise<void> {
    expect(typeof scope.onmessage, "self.onmessage is set").toBe("function");
    await scope.onmessage?.({ data });
    await new Promise((resolve) => setTimeout(resolve, 0));
  }

  /** The transfer list of a postMessage call, from postMessage(m, transfer) or postMessage(m, { transfer }). */
  function transferOf(args: unknown[]): unknown[] | undefined {
    const second = args[1];
    if (second === undefined) return undefined;
    return Array.isArray(second) ? second : ((second as { transfer?: unknown[] }).transfer ?? []);
  }

  it("P2-WKE-01 a frame event is handled and its result posted once, with the frame buffer in the transfer list", { timeout: 60_000 }, async () => {
    const scope = await startWorker();
    const message = messageFor(3, blankFrame(320, 180));
    await dispatch(scope, message);
    expect(scope.postMessage).toHaveBeenCalledTimes(1);
    const args = scope.postMessage.mock.calls[0];
    const reply = args[0] as WorkerResponse;
    expect(reply.type).toBe("result");
    expect(reply.id).toBe(3);
    expect(transferOf(args), "transfer list").toContain(message.buffer);
  });

  it("P2-WKE-02 reset and unknown messages post nothing", async () => {
    const scope = await startWorker();
    await dispatch(scope, { type: "reset" });
    await dispatch(scope, { type: "bogus" });
    expect(scope.postMessage).not.toHaveBeenCalled();
  });

  it("P2-WKE-03 a malformed frame posts an error reply with an empty transfer list", async () => {
    const scope = await startWorker();
    await dispatch(scope, frameMessage(4, 320, 180, 4 * 320 * 180 - 4));
    expect(scope.postMessage).toHaveBeenCalledTimes(1);
    const args = scope.postMessage.mock.calls[0];
    const reply = args[0] as WorkerResponse;
    expect(reply.type).toBe("error");
    expect(reply.id).toBe(4);
    expect(transferOf(args) ?? [], "transfer list").toEqual([]);
  });
});

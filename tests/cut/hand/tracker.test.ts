// MediaPipe's usage logging never reaches Google (requirements Q12; design doc §13, P4).

import { afterAll, describe, expect, it, vi } from "vitest";
import { blockUsageLogging } from "@/cut/hand/tracker";

describe("blockUsageLogging", () => {
  const original = globalThis.fetch;
  afterAll(() => {
    globalThis.fetch = original;
  });

  it("answers the usage-log address locally with a 403 and passes everything else through", async () => {
    const network = vi.fn(async () => new Response("ok", { status: 200 }));
    globalThis.fetch = network as typeof fetch;
    blockUsageLogging();
    const blocked = await fetch("https://odml.pa.googleapis.com/v1/log", { method: "POST", body: "x" });
    expect(blocked.status).toBe(403);
    expect(network).not.toHaveBeenCalled();
    const passed = await fetch(new URL("http://localhost/mediapipe/hand_landmarker.task"));
    expect(passed.status).toBe(200);
    expect(network).toHaveBeenCalledTimes(1);
  });

  it("wraps fetch only once", () => {
    const wrapped = globalThis.fetch;
    blockUsageLogging();
    expect(globalThis.fetch).toBe(wrapped);
  });
});

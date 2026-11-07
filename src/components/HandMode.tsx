"use client";

// 手势模式（docs/design_space_cut.md §6.5、需求 §3.5）：打开开关以后才打开摄像头、加载手势模型。
// 摄像头画面中间的一块映射到 3D 取景框，光标跟着拇指和食指指尖的中点走；捏住是按下，松开是抬起，
// 和鼠标走同一条路交给取景框的切口引擎（D5）。捏在取景框里的按钮上就是点它。
// 取景框滚出屏幕时停止识别；右上角的小窗显示画面、手的骨架、映射区域和状态。画面只在浏览器里处理，不上传
import { type RefObject, useEffect, useRef, useState } from "react";
import { GESTURE, HAND } from "@/cut/constants";
import type { Cut, Phase } from "@/cut/engine";
import type { GestureEvent } from "@/cut/gesture";
import { createHandInput, type HandState, type Landmark } from "@/cut/hand/handInput";
import { type HandTrackingReason, type HandTrackingStatus, startHandTracking } from "@/cut/hand/tracker";

export type HandLabels = {
  on: string;
  off: string;
  camera: string;
  model: string;
  none: string;
  open: string;
  pinched: string;
  preview: string;
  /** 刚打开时说一下怎么用，几秒后消失 */
  hint: string;
  errors: Record<Exclude<HandTrackingReason, "aborted">, string>;
};

type Props = {
  viewport: HTMLElement;
  cutRef: RefObject<Cut | null>;
  labels: HandLabels;
  /** 打不开摄像头或加载不了模型时：关掉开关，并说明原因 */
  onError(message: string): void;
};

const HINT_MS = 8000;

// 光标的样子。捏住以后、还没定是刀还是魔杖时（引擎还空闲），一圈金色在 450 ms 里转满，转满就是魔杖；
// 这之前划出去就是刀。定下来以后：魔杖是金色实心点，刀是青色实心点
type CursorLook = HandState | "waiting" | "wand" | "knife";
function cursorLook(state: HandState, phase: Phase | undefined, fresh: boolean): CursorLook {
  if (state !== "pinched" || !fresh) return state;
  if (phase === "idle") return "waiting";
  if (phase === "growing") return "wand";
  if (phase === "drawing") return "knife";
  return state;
}

// 手的 21 个关键点之间的骨头
const BONES = [[0, 1], [1, 2], [2, 3], [3, 4], [0, 5], [5, 6], [6, 7], [7, 8], [5, 9], [9, 10], [10, 11], [11, 12], [9, 13], [13, 14], [14, 15], [15, 16], [13, 17], [17, 18], [18, 19], [19, 20], [0, 17]] as const;

// 小窗里画映射区域（虚线框）、骨架和两个指尖。画面是镜像的，x 要翻过来
function drawPreview(canvas: HTMLCanvasElement, landmarks: readonly Landmark[] | null, pinched: boolean) {
  const ratio = Math.min(devicePixelRatio || 1, 2);
  const w = Math.round(canvas.clientWidth * ratio);
  const h = Math.round(canvas.clientHeight * ratio);
  if (canvas.width !== w || canvas.height !== h) {
    canvas.width = w;
    canvas.height = h;
  }
  const g = canvas.getContext("2d");
  if (!g) return;
  g.clearRect(0, 0, w, h);
  const { x0, x1, y0, y1 } = HAND.region;
  g.setLineDash([4 * ratio, 4 * ratio]);
  g.strokeStyle = "rgba(255,255,255,0.4)";
  g.lineWidth = ratio;
  g.strokeRect((1 - x1) * w, y0 * h, (x1 - x0) * w, (y1 - y0) * h);
  g.setLineDash([]);
  if (!landmarks) return;
  const at = (i: number) => [(1 - landmarks[i].x) * w, landmarks[i].y * h] as const;
  g.strokeStyle = "rgba(95,227,255,0.85)";
  g.lineWidth = 1.5 * ratio;
  g.beginPath();
  for (const [a, b] of BONES) {
    const [ax, ay] = at(a);
    const [bx, by] = at(b);
    g.moveTo(ax, ay);
    g.lineTo(bx, by);
  }
  g.stroke();
  g.fillStyle = pinched ? "#fbbf6a" : "#5fe3ff";
  for (const i of [4, 8]) {
    const [x, y] = at(i);
    g.beginPath();
    g.arc(x, y, 3.5 * ratio, 0, Math.PI * 2);
    g.fill();
  }
}

export function HandMode({ viewport, cutRef, labels, onError }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const cursorRef = useRef<HTMLSpanElement>(null);
  const [status, setStatus] = useState<HandTrackingStatus>("camera");
  const [hand, setHand] = useState<HandState>("none");
  const latest = useRef({ labels, onError });
  useEffect(() => {
    latest.current = { labels, onError };
  });

  useEffect(() => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    const cursor = cursorRef.current;
    if (!video || !canvas || !cursor) return;
    const controller = new AbortController();
    const input = createHandInput();
    let tracker: Awaited<ReturnType<typeof startHandTracking>> | null = null;
    let shown: HandState = "none";
    // 捏在按钮上：先记住这个按钮，松开时还在它上面就点它，不交给切口引擎
    let pressed: HTMLElement | null = null;
    // 这一捏是不是在切口空闲时开始的（窗口开着时的一捏是穿过去或合上，不会变成刀或魔杖）
    let fresh = false;

    const targetAt = (x: number, y: number) => {
      const box = viewport.getBoundingClientRect();
      const element = document.elementFromPoint(box.left + x, box.top + y)?.closest<HTMLElement>("button, a");
      return element && viewport.contains(element) ? element : null;
    };
    const route = (event: GestureEvent) => {
      if (event.type === "down") {
        pressed = targetAt(event.x, event.y);
        fresh = !pressed && cutRef.current?.phase === "idle";
        if (pressed) return;
      }
      if (pressed) {
        if (event.type === "up" && targetAt(event.x, event.y) === pressed) pressed.click();
        if (event.type === "up" || event.type === "cancel") pressed = null;
        return;
      }
      cutRef.current?.input(event);
    };

    startHandTracking(
      video,
      (frame) => {
        const result = input.frame(frame.landmarks, frame.t, frame.aspect, { width: viewport.clientWidth, height: viewport.clientHeight });
        drawPreview(canvas, frame.landmarks, result.state === "pinched");
        if (result.cursor) cursor.style.transform = `translate(${result.cursor[0].toFixed(1)}px, ${result.cursor[1].toFixed(1)}px)`;
        if (result.state !== shown) {
          shown = result.state;
          setHand(result.state);
        }
        for (const event of result.events) route(event);
        cursor.dataset.state = cursorLook(result.state, cutRef.current?.phase, fresh);
      },
      { signal: controller.signal, onStatus: setStatus },
    )
      .then((started) => {
        tracker = started;
      })
      .catch((error: { reason?: HandTrackingReason }) => {
        const reason = error.reason ?? "model";
        if (reason !== "aborted") latest.current.onError(latest.current.labels.errors[reason]);
      });

    // 取景框滚出屏幕时停止识别
    const visible = new IntersectionObserver(([entry]) => tracker?.setPaused(!entry?.isIntersecting));
    visible.observe(viewport);

    return () => {
      controller.abort();
      visible.disconnect();
      tracker?.stop();
      for (const event of input.release(performance.now())) route(event);
    };
  }, [viewport, cutRef]);

  // 识别开始以后，怎么用的提示留几秒
  const [hintVisible, setHintVisible] = useState(true);
  useEffect(() => {
    if (status !== "ready") return;
    const timer = setTimeout(() => setHintVisible(false), HINT_MS);
    return () => clearTimeout(timer);
  }, [status]);

  const state = status !== "ready" ? labels[status] : labels[hand];
  return (
    <>
      {status === "ready" && hintVisible && (
        <p className="pointer-events-none absolute inset-x-4 bottom-16 flex justify-center text-center text-xs">
          <span className="rounded-full bg-black/70 px-3 py-2 backdrop-blur">{labels.hint}</span>
        </p>
      )}
      {/* 右上角的小窗：镜像的摄像头画面、骨架和映射区域，下面一行是状态 */}
      <figure className="pointer-events-none absolute right-6 top-12 w-36 overflow-hidden rounded-lg border border-line bg-black/70 sm:right-8 sm:w-44">
        <div className="relative aspect-[4/3]">
          <video ref={videoRef} aria-label={labels.preview} className="absolute inset-0 h-full w-full -scale-x-100 object-cover opacity-70" />
          <canvas ref={canvasRef} aria-hidden className="absolute inset-0 h-full w-full" />
        </div>
        <figcaption role="status" className="px-2 py-1 text-[11px] text-muted">
          {state}
        </figcaption>
      </figure>
      {/* 跟着手走的光标：张开时是一个圈；捏住后先转一圈金色（cursorLook），定下来以后缩成实心点 */}
      <span
        ref={cursorRef}
        aria-hidden
        data-state="none"
        className="group pointer-events-none absolute left-0 top-0 z-10 -ml-3 -mt-3 size-6 rounded-full border-2 border-accent transition-[width,height,margin,background-color,border-color,opacity] duration-150 data-[state=none]:opacity-30 data-[state=waiting]:border-accent/35 data-[state=pinched]:-ml-1.5 data-[state=pinched]:-mt-1.5 data-[state=pinched]:size-3 data-[state=pinched]:border-(--cat-engines) data-[state=pinched]:bg-(--cat-engines) data-[state=wand]:-ml-1.5 data-[state=wand]:-mt-1.5 data-[state=wand]:size-3 data-[state=wand]:border-(--cat-engines) data-[state=wand]:bg-(--cat-engines) data-[state=knife]:-ml-1.5 data-[state=knife]:-mt-1.5 data-[state=knife]:size-3 data-[state=knife]:bg-accent"
      >
        <svg viewBox="0 0 24 24" className="absolute -inset-0.5 hidden size-6 -rotate-90 group-data-[state=waiting]:block">
          <circle
            cx="12"
            cy="12"
            r="11"
            pathLength={1}
            fill="none"
            stroke="var(--cat-engines)"
            strokeWidth="2"
            strokeDasharray="1"
            className="animate-[hand-wait_linear_forwards]"
            style={{ animationDuration: `${GESTURE.wandDelayMsHand}ms` }}
          />
        </svg>
      </span>
    </>
  );
}

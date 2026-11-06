"use client";

// 空间切口在页面上的那一层（docs/design_space_cut.md §4）：盖在要切开的东西上面，接住指针事件交给引擎，
// 里面挂着画切口边缘、涟漪和尘埃的效果层。只在切口进行中、或者入口开着刀和魔杖时才接指针，
// 其余时候让点击穿到下面去。键盘由各入口自己处理，再调用引擎的方法。
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { type Cut, createCut, type CutTarget, type Phase } from "@/cut/engine";
import type { InputSource } from "@/cut/geometry";
import type { Tools } from "@/cut/gesture";

type Props = {
  /** 要切开的东西；整个生命周期里要是同一个对象 */
  target: CutTarget;
  stop: boolean;
  tools: Tools;
  /** 引擎建好后调用一次，比如从按钮处自动切开 */
  onReady?(cut: Cut): void;
  /** 窗口尺寸变了；不传时把进行到一半的切口作废、藏起目标 */
  onResize?(cut: Cut): void;
  onPhase?(phase: Phase): void;
  onThrough(): void;
  onClose(): void;
  className?: string;
};

const sourceOf = (event: PointerEvent): InputSource => (event.pointerType === "touch" ? "touch" : event.pointerType === "pen" ? "pen" : "mouse");

export function CutLayer({ target, stop, tools, onReady, onResize, onPhase, onThrough, onClose, className = "" }: Props) {
  const surfaceRef = useRef<HTMLDivElement>(null);
  const fxRef = useRef<HTMLDivElement>(null);
  const [phase, setPhase] = useState<Phase>("idle");
  // 回调每次渲染都可能是新函数，引擎只在挂载时建一次，所以从这里读最新的
  const handlers = useRef({ onReady, onResize, onPhase, onThrough, onClose });
  useLayoutEffect(() => {
    handlers.current = { onReady, onResize, onPhase, onThrough, onClose };
  });
  const { knife, wand, click } = tools;

  useEffect(() => {
    const surface = surfaceRef.current;
    const fx = fxRef.current;
    if (!surface || !fx) return;
    const cut = createCut(fx, target, {
      stop,
      tools: { knife, wand, click },
      reducedMotion: matchMedia("(prefers-reduced-motion: reduce)").matches,
      onPhase: (next) => {
        setPhase(next);
        handlers.current.onPhase?.(next);
      },
      onThrough: () => handlers.current.onThrough(),
      onClose: () => handlers.current.onClose(),
    });

    const local = (event: PointerEvent) => {
      const box = surface.getBoundingClientRect();
      return [event.clientX - box.left, event.clientY - box.top] as const;
    };
    const send = (type: "down" | "move" | "up", event: PointerEvent) => {
      const [x, y] = local(event);
      cut.input({ type, x, y, t: event.timeStamp, source: sourceOf(event), id: event.pointerId });
    };
    const down = (event: PointerEvent) => {
      if (event.pointerType === "mouse" && event.button !== 0) return;
      event.preventDefault();
      surface.setPointerCapture(event.pointerId);
      send("down", event);
    };
    const move = (event: PointerEvent) => {
      const coalesced = event.getCoalescedEvents?.() ?? [];
      for (const each of coalesced.length ? coalesced : [event]) send("move", each);
      // 停在窗口时，指针在窗里显示成可以点的样子
      surface.style.cursor = cut.phase === "peek" && cut.isInsideWindow(local(event)) ? "pointer" : "";
    };
    const up = (event: PointerEvent) => send("up", event);
    const cancel = (event: PointerEvent) => cut.input({ type: "cancel", t: event.timeStamp, source: sourceOf(event), id: event.pointerId });
    // 手机上长按会弹出系统菜单，长按留给魔杖
    const noMenu = (event: Event) => event.preventDefault();
    surface.addEventListener("pointerdown", down);
    surface.addEventListener("pointermove", move);
    surface.addEventListener("pointerup", up);
    surface.addEventListener("pointercancel", cancel);
    surface.addEventListener("contextmenu", noMenu);
    // 尺寸变了，进行到一半的切口作废，或者交给入口决定
    const resized = () => (handlers.current.onResize ? handlers.current.onResize(cut) : cut.reset());
    window.addEventListener("resize", resized);
    handlers.current.onReady?.(cut);
    return () => {
      surface.removeEventListener("pointerdown", down);
      surface.removeEventListener("pointermove", move);
      surface.removeEventListener("pointerup", up);
      surface.removeEventListener("pointercancel", cancel);
      surface.removeEventListener("contextmenu", noMenu);
      window.removeEventListener("resize", resized);
      cut.destroy();
    };
  }, [target, stop, knife, wand, click]);

  const catching = phase !== "idle" || knife || wand || click;
  return (
    <div
      ref={surfaceRef}
      className={`absolute inset-0 touch-none select-none ${className}`}
      style={{ pointerEvents: catching ? "auto" : "none", WebkitTouchCallout: "none" }}
    >
      <div ref={fxRef} aria-hidden className="pointer-events-none absolute inset-0" />
    </div>
  );
}

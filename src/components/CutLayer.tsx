"use client";

// 空间切口在页面上的那一层（docs/design_space_cut.md §4）：盖在要切开的东西上面，接住指针事件交给引擎，
// 上面是画切口边缘、涟漪和尘埃的效果层，以及几行提示。只在切口进行中、或者入口开着刀和魔杖时才接指针，
// 其余时候让点击穿到下面去。键盘由各入口自己处理，再调用引擎的方法。
import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { type Cut, createCut, type CutTarget, type Phase } from "@/cut/engine";
import type { InputSource, Pt } from "@/cut/geometry";
import type { Tools } from "@/cut/gesture";
import { holdHintSeen, markHoldHintSeen } from "@/cut/hint";

export type CutHints = {
  /** 第一次把指针移到能用魔杖的地方时，提示"按住"（Q5），看过就不再出现 */
  hold?: string;
  /** 划得太短、不够直时的提示（需求 §3.1） */
  tooShort?: string;
  notStraight?: string;
  /** 停在窗口时的提示 */
  peek?: string;
};

type Props = {
  /** 要切开的东西；整个生命周期里要是同一个对象 */
  target: CutTarget;
  stop: boolean;
  tools: Tools;
  hints?: CutHints;
  /**
   * 整页用（404 页）：接指针的这一层固定铺满视口，效果层和提示挂到 body 上、盖在所有东西上面。
   * 这样接指针的这一层可以垫在页面内容下面，内容里的链接照常能点
   */
  fixed?: boolean;
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
const HOLD_HINT_MS = 4500;
const TOAST_MS = 1900;
const noSubscription = () => () => {};

export function CutLayer({ target, stop, tools, hints, fixed = false, onReady, onResize, onPhase, onThrough, onClose, className = "" }: Props) {
  const surfaceRef = useRef<HTMLDivElement>(null);
  // 效果层挂到 body 上时，第一次渲染（服务端和水合）还没有它，所以用回调 ref 记下来，挂好了再建引擎
  const [fx, setFx] = useState<HTMLDivElement | null>(null);
  const inBrowser = useSyncExternalStore(noSubscription, () => true, () => false);
  const [phase, setPhase] = useState<Phase>("idle");
  const [toast, setToast] = useState<string | null>(null);
  const [holdAt, setHoldAt] = useState<Pt | "bottom" | null>(null);
  // 回调和提示文字每次渲染都可能是新对象，引擎只在挂载时建一次，所以从这里读最新的
  const latest = useRef({ onReady, onResize, onPhase, onThrough, onClose, hints });
  useLayoutEffect(() => {
    latest.current = { onReady, onResize, onPhase, onThrough, onClose, hints };
  });
  const { knife, wand, click } = tools;

  useEffect(() => {
    const surface = surfaceRef.current;
    if (!surface || !fx) return;
    const cut = createCut(fx, target, {
      stop,
      tools: { knife, wand, click },
      reducedMotion: matchMedia("(prefers-reduced-motion: reduce)").matches,
      onPhase: (next) => {
        setPhase(next);
        latest.current.onPhase?.(next);
      },
      onReject: (reason) => {
        const text = reason === "too-short" ? latest.current.hints?.tooShort : latest.current.hints?.notStraight;
        if (text) setToast(text);
      },
      onThrough: () => latest.current.onThrough(),
      onClose: () => latest.current.onClose(),
    });

    const local = (event: PointerEvent): Pt => {
      const box = surface.getBoundingClientRect();
      return [event.clientX - box.left, event.clientY - box.top];
    };
    const send = (type: "down" | "move" | "up", event: PointerEvent) => {
      const [x, y] = local(event);
      cut.input({ type, x, y, t: event.timeStamp, source: sourceOf(event), id: event.pointerId });
    };
    const down = (event: PointerEvent) => {
      if (event.pointerType === "mouse" && event.button !== 0) return;
      event.preventDefault();
      surface.setPointerCapture(event.pointerId);
      setToast(null);
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
    const resized = () => (latest.current.onResize ? latest.current.onResize(cut) : cut.reset());
    window.addEventListener("resize", resized);
    latest.current.onReady?.(cut);
    return () => {
      surface.removeEventListener("pointerdown", down);
      surface.removeEventListener("pointermove", move);
      surface.removeEventListener("pointerup", up);
      surface.removeEventListener("pointercancel", cancel);
      surface.removeEventListener("contextmenu", noMenu);
      window.removeEventListener("resize", resized);
      cut.destroy();
    };
  }, [fx, target, stop, knife, wand, click]);

  // 第一次的"按住"提示：鼠标移进来时出现在指针旁边并跟着走；只有触屏的设备上，这一层露出六成以上时
  // 出现在底部。按下去、或者过了几秒就收起，记住已经看过
  const holdText = wand ? hints?.hold : undefined;
  useEffect(() => {
    const surface = surfaceRef.current;
    if (!surface || !holdText || holdHintSeen()) return;
    let shown = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const local = (event: PointerEvent): Pt => {
      const box = surface.getBoundingClientRect();
      return [event.clientX - box.left, event.clientY - box.top];
    };
    const finish = () => {
      if (!shown) return;
      shown = false;
      clearTimeout(timer);
      setHoldAt(null);
      markHoldHintSeen();
      detach();
    };
    const show = (at: Pt | "bottom") => {
      setHoldAt(at);
      if (shown) return;
      shown = true;
      timer = setTimeout(finish, HOLD_HINT_MS);
    };
    const enter = (event: PointerEvent) => {
      if (event.pointerType !== "touch") show(local(event));
    };
    const move = (event: PointerEvent) => {
      if (shown && event.pointerType !== "touch") setHoldAt(local(event));
    };
    const touchOnly = matchMedia("(any-pointer: coarse)").matches && !matchMedia("(any-pointer: fine)").matches;
    const seen = touchOnly
      ? new IntersectionObserver(([entry]) => entry && entry.intersectionRatio >= 0.6 && show("bottom"), { threshold: [0.6] })
      : null;
    seen?.observe(surface);
    surface.addEventListener("pointerenter", enter);
    surface.addEventListener("pointermove", move);
    surface.addEventListener("pointerdown", finish);
    function detach() {
      seen?.disconnect();
      surface?.removeEventListener("pointerenter", enter);
      surface?.removeEventListener("pointermove", move);
      surface?.removeEventListener("pointerdown", finish);
    }
    return () => {
      clearTimeout(timer);
      detach();
    };
  }, [holdText]);

  // 划失败的提示过一会儿自己消失
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), TOAST_MS);
    return () => clearTimeout(timer);
  }, [toast]);

  const line = phase === "peek" ? (hints?.peek ?? null) : toast;
  const overlay = (
    <div className={`pointer-events-none inset-0 ${fixed ? "fixed z-[60]" : "absolute"}`}>
      <div ref={setFx} aria-hidden className="absolute inset-0" />
      {holdText && holdAt && (
        <span
          aria-hidden
          className="absolute flex items-center gap-2 whitespace-nowrap rounded-full bg-black/70 px-3 py-1.5 text-xs backdrop-blur"
          style={holdAt === "bottom" ? { left: "50%", bottom: 64, transform: "translateX(-50%)" } : { left: holdAt[0] + 16, top: holdAt[1] + 16 }}
        >
          <span className="size-1.5 rounded-full bg-(--cat-engines) motion-safe:animate-pulse" />
          {holdText}
        </span>
      )}
      <p role="status" className="absolute inset-x-4 bottom-6 flex justify-center text-center text-sm">
        {line && <span className="rounded-full bg-black/70 px-3 py-2 backdrop-blur">{line}</span>}
      </p>
    </div>
  );

  const catching = phase !== "idle" || knife || wand || click;
  return (
    <>
      <div
        ref={surfaceRef}
        className={`${fixed ? "fixed" : "absolute"} inset-0 touch-none select-none ${className}`}
        style={{ pointerEvents: catching ? "auto" : "none", WebkitTouchCallout: "none" }}
      >
        {!fixed && overlay}
      </div>
      {fixed && inBrowser && createPortal(overlay, document.body)}
    </>
  );
}

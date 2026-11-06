"use client";

import dynamic from "next/dynamic";
import { type KeyboardEvent, type MouseEvent, useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import type { ARView, CameraARLabels } from "@/components/CameraAR";
import { floorPath } from "@/components/CoverArt";
import type { CutHints } from "@/components/CutLayer";
import { HudCorners } from "@/components/HudCorners";
import type { createHeroScene, XRMode } from "@/components/heroScene";
import type { Cut, CutTarget, Phase } from "@/cut/engine";
import type { Pt } from "@/cut/geometry";

export type HudLabels = {
  scene: string;
  tracking: string;
  board: string;
  hint: string;
  ar: string;
  vr: string;
  camera: string;
  cameraAR: CameraARLabels;
  // 彩蛋：在取景框里切开空间，看场景的工程视角（docs/design_space_cut.md §6.4）
  cut: Required<CutHints> & { engineering: string; aria: string };
};

// 摄像头 AR 的叠层连同追踪、位姿的代码，打开时才下载
const CameraAR = dynamic(() => import("@/components/CameraAR"), { ssr: false });
// 彩蛋的切口层连同切口引擎，3D 画面准备好以后才下载，不进首页首屏的代码
const CutLayer = dynamic(() => import("@/components/CutLayer").then((m) => m.CutLayer), { ssr: false });
const EGG_TOOLS = { knife: true, wand: true, click: false };

// 叠层开着没有、开的是哪个画面，记在网址的 ?ar=camera 或 ?ar=board 里：按返回键能关掉，
// 带这个参数的链接打开就直接进去（D6），其他取值不理会（OQ-58）。
// 自己 pushState / replaceState 不会触发 popstate，所以改了网址要手动通知
const arListeners = new Set<() => void>();
function subscribeAr(listener: () => void) {
  arListeners.add(listener);
  window.addEventListener("popstate", listener);
  return () => {
    arListeners.delete(listener);
    window.removeEventListener("popstate", listener);
  };
}
const arViewInUrl = (): ARView | null => {
  const value = new URLSearchParams(window.location.search).get("ar");
  return value === "camera" || value === "board" ? value : null;
};
function setArInUrl(view: ARView | null, push: boolean) {
  const url = new URL(window.location.href);
  if (view) url.searchParams.set("ar", view);
  else url.searchParams.delete("ar");
  if (push) window.history.pushState(null, "", url);
  else window.history.replaceState(null, "", url);
  arListeners.forEach((listener) => listener());
}

// 只在安全上下文里、浏览器能打开摄像头时才显示摄像头 AR 的按钮（D10）
const noSubscription = () => () => {};
const cameraAvailable = () => window.isSecureContext && typeof navigator.mediaDevices?.getUserMedia === "function";

// 首页的 3D 取景框。画面由 heroScene.ts 用 three.js 画，这里负责四周的 HUD、进入摄像头 AR 和 AR / VR 的按钮。
// three.js 等组件挂载后才加载；加载完之前、或者浏览器不支持 WebGL 时，显示一块静态的透视网格（和卡片线稿同一张）
export function HeroViewport({ labels }: { labels: HudLabels }) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const mountRef = useRef<HTMLDivElement>(null);
  const fpsRef = useRef<HTMLSpanElement>(null);
  const poseRef = useRef<HTMLSpanElement>(null);
  const cameraButtonRef = useRef<HTMLButtonElement>(null);
  const enterXR = useRef<(mode: XRMode) => Promise<void>>(null);
  const setPaused = useRef<(paused: boolean) => void>(null);
  // 这次打开是不是按钮 push 的：是的话关闭时退回上一条记录，否则（直接打开的链接）只把参数去掉
  const pushedAR = useRef(false);
  const closing = useRef(false);
  const wasOpen = useRef(false);
  const [ready, setReady] = useState(false);
  const [xrModes, setXrModes] = useState<XRMode[]>([]);
  const arView = useSyncExternalStore(subscribeAr, arViewInUrl, () => null);
  const arOpen = arView !== null;
  const canUseCamera = useSyncExternalStore(noSubscription, cameraAvailable, () => false);
  // 叠层从按钮中心切开（docs/design_space_cut.md §6.2）；直接打开带 ?ar= 的链接时没有切口
  const [cutFrom, setCutFrom] = useState<Pt | null>(null);
  // 叠层盖满屏幕之前首页还看得见，3D 画面照常转
  const [covered, setCovered] = useState(false);
  // 彩蛋：3D 场景的接口、切口引擎，以及现在窗外是不是工程视角（穿过去以后两种画面对调）
  const sceneRef = useRef<ReturnType<typeof createHeroScene> | null>(null);
  const cutRef = useRef<Cut | null>(null);
  const [engineering, setEngineering] = useState(false);
  const portal = useMemo<CutTarget>(() => ({ setWindow: (polygon) => sceneRef.current?.setPortal(polygon) }), []);

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;
    let cancelled = false;
    let dispose = () => {};
    import("@/components/heroScene")
      .then(({ createHeroScene }) => {
        if (cancelled) return;
        const scene = createHeroScene(mount, {
          reducedMotion: matchMedia("(prefers-reduced-motion: reduce)").matches,
          // 切口层盖在画布上面，镜头跟随的指针事件从整个取景框上听
          pointerTarget: viewportRef.current ?? mount,
          // 每秒几次，直接改文字，不经过 React 重新渲染
          onStats: ({ fps, x, y, z, yaw }) => {
            if (fpsRef.current) fpsRef.current.textContent = fps ? `${fps} FPS` : "— FPS";
            if (poseRef.current) {
              poseRef.current.textContent = `x ${x.toFixed(2)}  y ${y.toFixed(2)}  z ${z.toFixed(2)} m · ${yaw.toFixed(0)}°`;
            }
          },
        });
        sceneRef.current = scene;
        dispose = () => {
          sceneRef.current = null;
          scene.dispose();
        };
        enterXR.current = scene.enterXR;
        setPaused.current = scene.setPaused;
        // 带着 ?ar= 打开页面时，叠层比首页画面先出现
        scene.setPaused(arViewInUrl() !== null);
        setReady(true);
      })
      .catch((error) => console.warn("Could not start the 3D scene, keeping the static backdrop:", error));

    // 只在支持 WebXR 的设备上（如 Quest 浏览器、Vision Pro 的 Safari）显示进入 AR / VR 的按钮
    const xr = navigator.xr;
    if (xr) {
      const modes: XRMode[] = ["immersive-ar", "immersive-vr"];
      Promise.all(modes.map((mode) => xr.isSessionSupported(mode).catch(() => false))).then((supported) => {
        if (!cancelled) setXrModes(modes.filter((_, i) => supported[i]));
      });
    }

    return () => {
      cancelled = true;
      setPaused.current = null;
      dispose();
    };
  }, []);

  // 叠层盖满首页时首页画面停下来
  useEffect(() => {
    setPaused.current?.(arOpen && covered);
  }, [arOpen, covered]);

  // 关掉后焦点回到入口按钮，没有按钮时回到取景框
  useEffect(() => {
    if (!arOpen) closing.current = false;
    if (wasOpen.current && !arOpen) (cameraButtonRef.current ?? viewportRef.current)?.focus();
    wasOpen.current = arOpen;
  }, [arOpen]);

  const start = (mode: XRMode) =>
    enterXR.current?.(mode).catch((error) => console.warn("Could not start the XR session:", error));

  // 桌面端（没有触屏）先显示标定板和二维码，让人用手机扫；手机和平板直接打开摄像头（D5）
  const openCameraAR = (event: MouseEvent<HTMLButtonElement>) => {
    const box = event.currentTarget.getBoundingClientRect();
    setCutFrom([box.left + box.width / 2, box.top + box.height / 2]);
    pushedAR.current = true;
    setArInUrl(matchMedia("(any-pointer: coarse)").matches ? "camera" : "board", true);
  };

  // 在叠层里换画面只替换网址参数，按返回键仍然一次就关掉叠层（U12）
  const switchView = useCallback((view: ARView) => setArInUrl(view, false), []);

  // history.back() 要等 popstate 才生效，期间再按 Esc（比如按住不放）不能再改一次网址
  const closeCameraAR = useCallback(() => {
    if (arViewInUrl() === null || closing.current) return;
    if (pushedAR.current) {
      pushedAR.current = false;
      closing.current = true;
      window.history.back();
    } else {
      setArInUrl(null, false);
    }
  }, []);

  // 彩蛋的键盘操作（D8）：取景框有焦点时，Enter 或空格在中间开窗并停住，再按 Enter 穿过去，Esc 合上；
  // 已经在工程视角里时，Esc 直接回到普通画面（OQ-4）。焦点在里面的按钮上（或叠层里）时不管
  const onViewportKey = (event: KeyboardEvent<HTMLDivElement>) => {
    const cut = cutRef.current;
    if (event.target !== event.currentTarget || !cut || !["Enter", " ", "Escape"].includes(event.key)) return;
    if (event.key === "Escape" && cut.phase === "idle") {
      const scene = sceneRef.current;
      if (!scene?.isEngineering()) return;
      event.preventDefault();
      scene.swapViews();
      setEngineering(false);
      return;
    }
    event.preventDefault();
    cut.input({ type: "key", key: event.key, t: event.timeStamp });
  };

  // 划线、化开、张开、穿过去和合上的时候镜头不跟指针；停在窗口时照常跟，窗里窗外一起转
  const onCutPhase = useCallback((phase: Phase) => sceneRef.current?.setFollow(phase === "idle" || phase === "peek"), []);
  // 穿过去：窗外换成刚才窗里的画面；再切一次就换回来
  const onCutThrough = useCallback(() => {
    const scene = sceneRef.current;
    if (!scene) return;
    scene.swapViews();
    setEngineering(scene.isEngineering());
  }, []);
  const onCutReady = useCallback((cut: Cut) => {
    cutRef.current = cut;
  }, []);
  const noop = useCallback(() => {}, []);

  const buttonClass =
    "rounded-full border border-accent/60 bg-background px-3 py-2 text-sm font-semibold text-accent transition-colors hover:bg-surface active:scale-[0.98]";

  return (
    <div
      ref={viewportRef}
      tabIndex={0}
      role="group"
      aria-label={labels.cut.aria}
      onKeyDown={onViewportKey}
      className="panel relative aspect-[4/3] overflow-hidden rounded-3xl bg-background outline-none focus-visible:ring-2 focus-visible:ring-accent sm:aspect-[16/10] lg:aspect-auto lg:h-[500px]"
    >
      <svg
        aria-hidden
        viewBox="0 0 320 200"
        preserveAspectRatio="xMidYMax slice"
        className="absolute inset-0 h-full w-full [&_*]:[vector-effect:non-scaling-stroke]"
        fill="none"
        stroke="var(--accent)"
      >
        <path d={floorPath} opacity="0.25" />
      </svg>
      <div
        ref={mountRef}
        role="img"
        aria-label={labels.scene}
        className={`absolute inset-0 transition-opacity duration-700 ${ready ? "opacity-100" : "opacity-0"}`}
      />
      {/* 彩蛋：在画布上划一刀或按住魔杖，切开看场景的工程视角；HUD 和按钮在它上面，照常能点 */}
      {ready && (
        <CutLayer
          target={portal}
          stop
          tools={EGG_TOOLS}
          hints={labels.cut}
          onReady={onCutReady}
          onPhase={onCutPhase}
          onThrough={onCutThrough}
          onClose={noop}
        />
      )}
      <HudCorners className="inset-4" />

      <div className="pointer-events-none absolute inset-x-6 top-4 flex items-center justify-between gap-4 text-xs text-muted sm:inset-x-8 sm:top-6">
        <span className="flex items-center gap-2">
          <span aria-hidden className="size-2 rounded-full bg-(--cat-perception) motion-safe:animate-pulse" />
          {labels.tracking}
          <span className="hidden sm:inline">· {labels.board}</span>
          {engineering && <span className="text-(--cat-engines)">· {labels.cut.engineering}</span>}
        </span>
        {/* 帧率和位姿是一直在跳的数字，用等宽字体免得来回抖 */}
        <span ref={fpsRef} className="font-mono tabular-nums">
          — FPS
        </span>
      </div>

      <div className="pointer-events-none absolute inset-x-6 bottom-4 flex items-end justify-between gap-4 text-xs text-muted sm:inset-x-8 sm:bottom-6">
        <span ref={poseRef} className="font-mono tabular-nums" />
        {/* 右下角依次是摄像头 AR 和 WebXR 的按钮（D14、D9）；一个按钮都没有时才显示移动鼠标的提示 */}
        {canUseCamera || xrModes.length > 0 ? (
          <span className="pointer-events-auto flex shrink-0 flex-wrap justify-end gap-2">
            {canUseCamera && (
              <button ref={cameraButtonRef} type="button" onClick={openCameraAR} className={buttonClass}>
                {labels.camera}
              </button>
            )}
            {xrModes.map((mode) => (
              <button key={mode} type="button" onClick={() => start(mode)} className={buttonClass}>
                {mode === "immersive-ar" ? labels.ar : labels.vr}
              </button>
            ))}
          </span>
        ) : (
          <span className="hidden shrink-0 pointer-fine:motion-safe:inline">{labels.hint}</span>
        )}
      </div>

      {arView && (
        <CameraAR
          view={arView}
          labels={labels.cameraAR}
          canUseCamera={canUseCamera}
          onClose={closeCameraAR}
          onView={switchView}
          cutFrom={cutFrom}
          onCover={setCovered}
        />
      )}
    </div>
  );
}

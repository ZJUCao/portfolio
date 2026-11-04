"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import type { CameraARLabels } from "@/components/CameraAR";
import { floorPath } from "@/components/CoverArt";
import { HudCorners } from "@/components/HudCorners";
import type { XRMode } from "@/components/heroScene";

export type HudLabels = {
  scene: string;
  tracking: string;
  board: string;
  hint: string;
  ar: string;
  vr: string;
  camera: string;
  cameraAR: CameraARLabels;
};

// 摄像头 AR 的叠层连同追踪、位姿的代码，打开时才下载
const CameraAR = dynamic(() => import("@/components/CameraAR"), { ssr: false });

// 叠层开着没有，记在网址的 ?ar=camera 里：按返回键能关掉，带这个参数的链接打开就直接进摄像头（D6）。
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
const arInUrl = () => new URLSearchParams(window.location.search).get("ar") === "camera";
function setArInUrl(open: boolean, push: boolean) {
  const url = new URL(window.location.href);
  if (open) url.searchParams.set("ar", "camera");
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
  const arOpen = useSyncExternalStore(subscribeAr, arInUrl, () => false);
  const canUseCamera = useSyncExternalStore(noSubscription, cameraAvailable, () => false);

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
          // 每秒几次，直接改文字，不经过 React 重新渲染
          onStats: ({ fps, x, y, z, yaw }) => {
            if (fpsRef.current) fpsRef.current.textContent = fps ? `${fps} FPS` : "— FPS";
            if (poseRef.current) {
              poseRef.current.textContent = `x ${x.toFixed(2)}  y ${y.toFixed(2)}  z ${z.toFixed(2)} m · ${yaw.toFixed(0)}°`;
            }
          },
        });
        dispose = scene.dispose;
        enterXR.current = scene.enterXR;
        setPaused.current = scene.setPaused;
        // 带着 ?ar=camera 打开页面时，叠层比首页画面先出现
        scene.setPaused(arInUrl());
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

  // 叠层盖住首页时首页画面停下来；关掉后焦点回到入口按钮，没有按钮时回到取景框
  useEffect(() => {
    setPaused.current?.(arOpen);
    if (!arOpen) closing.current = false;
    if (wasOpen.current && !arOpen) (cameraButtonRef.current ?? viewportRef.current)?.focus();
    wasOpen.current = arOpen;
  }, [arOpen]);

  const start = (mode: XRMode) =>
    enterXR.current?.(mode).catch((error) => console.warn("Could not start the XR session:", error));

  const openCameraAR = () => {
    pushedAR.current = true;
    setArInUrl(true, true);
  };

  // history.back() 要等 popstate 才生效，期间再按 Esc（比如按住不放）不能再改一次网址
  const closeCameraAR = useCallback(() => {
    if (!arInUrl() || closing.current) return;
    if (pushedAR.current) {
      pushedAR.current = false;
      closing.current = true;
      window.history.back();
    } else {
      setArInUrl(false, false);
    }
  }, []);

  const buttonClass =
    "rounded-full border border-accent/60 bg-background px-3 py-2 text-sm font-semibold text-accent transition-colors hover:bg-surface active:scale-[0.98]";

  return (
    <div
      ref={viewportRef}
      tabIndex={-1}
      className="panel relative aspect-[4/3] overflow-hidden rounded-3xl bg-background outline-none sm:aspect-[16/10] lg:aspect-auto lg:h-[500px]"
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
      <HudCorners className="inset-4" />

      <div className="pointer-events-none absolute inset-x-6 top-4 flex items-center justify-between gap-4 text-xs text-muted sm:inset-x-8 sm:top-6">
        <span className="flex items-center gap-2">
          <span aria-hidden className="size-2 rounded-full bg-(--cat-perception) motion-safe:animate-pulse" />
          {labels.tracking}
          <span className="hidden sm:inline">· {labels.board}</span>
        </span>
        {/* 帧率和位姿是一直在跳的数字，用等宽字体免得来回抖 */}
        <span ref={fpsRef} className="font-mono tabular-nums">
          — FPS
        </span>
      </div>

      <div className="absolute inset-x-6 bottom-4 flex items-end justify-between gap-4 text-xs text-muted sm:inset-x-8 sm:bottom-6">
        <span ref={poseRef} className="pointer-events-none font-mono tabular-nums" />
        {/* 右下角依次是摄像头 AR 和 WebXR 的按钮（D14、D9）；一个按钮都没有时才显示移动鼠标的提示 */}
        {canUseCamera || xrModes.length > 0 ? (
          <span className="flex shrink-0 flex-wrap justify-end gap-2">
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
          <span className="pointer-events-none hidden shrink-0 pointer-fine:motion-safe:inline">{labels.hint}</span>
        )}
      </div>

      {arOpen && <CameraAR labels={labels.cameraAR} onClose={closeCameraAR} />}
    </div>
  );
}

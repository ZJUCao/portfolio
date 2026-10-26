"use client";

import { useEffect, useRef, useState } from "react";
import { floorPath } from "@/components/CoverArt";
import { HudCorners } from "@/components/HudCorners";
import type { XRMode } from "@/components/heroScene";

export type HudLabels = { scene: string; tracking: string; board: string; hint: string; ar: string; vr: string };

// 首页的 3D 取景框。画面由 heroScene.ts 用 three.js 画，这里负责四周的 HUD 和进入 AR / VR 的按钮。
// three.js 等组件挂载后才加载；加载完之前、或者浏览器不支持 WebGL 时，显示一块静态的透视网格（和卡片线稿同一张）
export function HeroViewport({ labels }: { labels: HudLabels }) {
  const mountRef = useRef<HTMLDivElement>(null);
  const fpsRef = useRef<HTMLSpanElement>(null);
  const poseRef = useRef<HTMLSpanElement>(null);
  const enterXR = useRef<(mode: XRMode) => Promise<void>>(null);
  const [ready, setReady] = useState(false);
  const [xrModes, setXrModes] = useState<XRMode[]>([]);

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
      dispose();
    };
  }, []);

  const start = (mode: XRMode) =>
    enterXR.current?.(mode).catch((error) => console.warn("Could not start the XR session:", error));

  return (
    <div className="panel relative aspect-[4/3] overflow-hidden rounded-3xl bg-background sm:aspect-[16/10] lg:aspect-auto lg:h-[500px]">
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
        {xrModes.length > 0 ? (
          <span className="flex shrink-0 gap-2">
            {xrModes.map((mode) => (
              <button
                key={mode}
                type="button"
                onClick={() => start(mode)}
                className="rounded-full border border-accent/60 bg-background px-3 py-2 text-sm font-semibold text-accent transition-colors hover:bg-surface active:scale-[0.98]"
              >
                {mode === "immersive-ar" ? labels.ar : labels.vr}
              </button>
            ))}
          </span>
        ) : (
          <span className="pointer-events-none hidden shrink-0 pointer-fine:motion-safe:inline">{labels.hint}</span>
        )}
      </div>
    </div>
  );
}

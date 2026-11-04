"use client";

import { X } from "@phosphor-icons/react/ssr";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { BOARD } from "@/ar/board";
import { cameraPosition, projectionMatrix, viewMatrix } from "@/ar/pose";
import { type CameraError, type TrackingStatus, type VideoLike, startCameraAR } from "@/ar/tracker";
import { HudCorners } from "@/components/HudCorners";
import { createCameraScene } from "@/components/heroScene";

export type CameraARLabels = {
  title: string;
  close: string;
  starting: string;
  searching: string;
  tracking: string;
  // 位姿读数旁的说明：按每格 25 毫米换算成米（D7）
  note: string;
  errors: Record<CameraError, string>;
};

// 场景单位（一格 0.24）的近远裁剪面：手机离板子几厘米到几米都画得出来
const NEAR = 0.05;
const FAR = 100;
const METERS_PER_UNIT = BOARD.squareMeters / BOARD.squareSize;

// 状态行前的圆点：追踪到是绿色，在找是琥珀色，打开中是灰色，都在闪
const dotColor: Record<Exclude<TrackingStatus, "error">, string> = {
  starting: "bg-muted",
  searching: "bg-(--cat-engines)",
  tracking: "bg-(--cat-perception)",
};

// 摄像头 AR 的全屏叠层（docs/design_camera_ar.md §5.7 U5–U8）：下面是摄像头画面，上面是透明的 3D 画布，
// 城堡和 OpenCV 风格的角点、坐标轴按真实标定板的位姿画上去；四周是和首页一样的 HUD。
// 由 HeroViewport 在打开时才加载，所以追踪、位姿和 three.js 都不进首页的代码。
// Reveal 会给首页内容加 transform，fixed 定位会相对它，所以叠层用 portal 挂到 body 上
export default function CameraAR({ labels, onClose }: { labels: CameraARLabels; onClose: () => void }) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const sceneRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const fpsRef = useRef<HTMLSpanElement>(null);
  const poseRef = useRef<HTMLSpanElement>(null);
  const [status, setStatus] = useState<TrackingStatus>("starting");
  const [error, setError] = useState<CameraError | null>(null);

  // 打开时焦点落在关闭按钮上，页面不能滚动
  useEffect(() => {
    closeRef.current?.focus();
    const root = document.documentElement;
    const overflow = root.style.overflow;
    root.style.overflow = "hidden";
    return () => {
      root.style.overflow = overflow;
    };
  }, []);

  // Esc 关闭；Tab 只在叠层里转
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
      } else if (event.key === "Tab") {
        const items = Array.from(dialogRef.current?.querySelectorAll<HTMLElement>("button, [href]") ?? []);
        if (items.length === 0) return;
        const index = items.indexOf(document.activeElement as HTMLElement);
        const next = event.shiftKey ? (index <= 0 ? items.length - 1 : index - 1) : (index + 1) % items.length;
        event.preventDefault();
        items[next].focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  useEffect(() => {
    const video = videoRef.current;
    const container = sceneRef.current;
    if (!video || !container) return;
    let scene: ReturnType<typeof createCameraScene> | null = null;
    try {
      scene = createCameraScene(container, { reducedMotion: matchMedia("(prefers-reduced-motion: reduce)").matches });
    } catch (err) {
      // 没有 WebGL 时只剩摄像头画面和 HUD
      console.warn("Could not start the camera AR scene:", err);
    }
    // video.srcObject 的类型还包括 MediaSource 和 Blob，追踪器只会往里放摄像头的 MediaStream
    const tracker = startCameraAR(video as VideoLike, {
      // 每秒二三十次：状态变了才重新渲染，帧率和位姿直接改文字
      onUpdate(update) {
        setStatus(update.status);
        setError(update.error);
        if (fpsRef.current) fpsRef.current.textContent = `${update.fps} FPS`;
        const { pose, intrinsics, frame } = update;
        const viewport = { width: container.clientWidth, height: container.clientHeight };
        if (pose && intrinsics && frame && viewport.width > 0 && viewport.height > 0) {
          scene?.setPose(viewMatrix(pose), projectionMatrix(intrinsics, frame, viewport, NEAR, FAR));
          const [x, y, z] = Array.from(cameraPosition(pose), (v) => v * METERS_PER_UNIT);
          const yaw = ((Math.atan2(x, z) * 180) / Math.PI + 360) % 360;
          if (poseRef.current) poseRef.current.textContent = `x ${x.toFixed(2)}  y ${y.toFixed(2)}  z ${z.toFixed(2)} m · ${yaw.toFixed(0)}°`;
        } else {
          scene?.setPose(null, null);
          if (poseRef.current) poseRef.current.textContent = "";
        }
      },
    });
    return () => {
      tracker.stop();
      scene?.dispose();
    };
  }, []);

  const statusText = status === "error" ? "" : labels[status];

  return createPortal(
    <div
      ref={dialogRef}
      role="dialog"
      aria-modal="true"
      aria-label={labels.title}
      className="fixed inset-0 z-50 overflow-hidden bg-black text-foreground"
    >
      {/* 不镜像：前置摄像头也照原样显示（D2）。画面和 3D 画布用同样的 cover 方式铺满 */}
      <video ref={videoRef} playsInline muted autoPlay className="absolute inset-0 h-full w-full object-cover" />
      <div ref={sceneRef} aria-hidden className="pointer-events-none absolute inset-0" />
      <HudCorners className="inset-4" />

      <div className="absolute inset-x-6 top-6 flex items-start justify-between gap-4 text-xs sm:inset-x-8">
        {error === null ? (
          <span role="status" className="flex items-center gap-2 rounded-lg bg-black/60 px-2 py-1 backdrop-blur">
            <span aria-hidden className={`size-2 shrink-0 rounded-full motion-safe:animate-pulse ${dotColor[status as keyof typeof dotColor]}`} />
            {statusText}
          </span>
        ) : (
          <span />
        )}
        <span className="flex items-center gap-3">
          <span ref={fpsRef} className="rounded-lg bg-black/60 px-2 py-1 font-mono tabular-nums text-muted backdrop-blur">
            0 FPS
          </span>
          <button
            ref={closeRef}
            type="button"
            onClick={onClose}
            aria-label={labels.close}
            className="panel flex size-10 items-center justify-center rounded-full bg-surface/70 backdrop-blur transition-colors hover:bg-raised active:scale-[0.98]"
          >
            <X aria-hidden size={20} />
          </button>
        </span>
      </div>

      {/* 相机相对板子中心的位置，只在追踪时显示；一直挂着，onUpdate 才能直接改它的文字 */}
      <div
        className={`absolute inset-x-6 bottom-6 flex flex-wrap items-baseline gap-x-3 gap-y-1 text-xs sm:inset-x-8 ${status === "tracking" ? "" : "invisible"}`}
      >
        <span ref={poseRef} className="rounded-lg bg-black/60 px-2 py-1 font-mono tabular-nums backdrop-blur" />
        <span className="text-muted">{labels.note}</span>
      </div>

      {error !== null && (
        <div className="absolute inset-0 flex items-center justify-center px-4">
          <div role="alert" className="panel relative w-full max-w-[420px] rounded-3xl bg-surface p-6 text-center">
            <HudCorners className="inset-3 opacity-50" />
            <p className="text-base">{labels.errors[error]}</p>
            <button
              type="button"
              onClick={onClose}
              className="mt-6 inline-flex rounded-full bg-foreground px-3 py-2 text-base font-semibold text-background transition hover:bg-white active:scale-[0.98]"
            >
              {labels.close}
            </button>
          </div>
        </div>
      )}
    </div>,
    document.body,
  );
}

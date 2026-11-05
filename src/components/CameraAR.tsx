"use client";

import { X } from "@phosphor-icons/react/ssr";
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { encode } from "uqr";
import { BOARD } from "@/ar/board";
import { cameraPosition, projectionMatrix, viewMatrix } from "@/ar/pose";
import { type CameraError, type TrackingStatus, type VideoLike, startCameraAR } from "@/ar/tracker";
import { HudCorners } from "@/components/HudCorners";
import { createCameraScene } from "@/components/heroScene";

/** 叠层的两个画面，和网址里 ?ar= 的值一样 */
export type ARView = "camera" | "board";

export type CameraARLabels = {
  title: string;
  close: string;
  starting: string;
  searching: string;
  tracking: string;
  // 位姿读数旁的说明：按每格 25 毫米换算成米（D7）
  note: string;
  errors: Record<CameraError, string>;
  showBoard: string;
  print: string;
  showBoardInstead: string;
  useCamera: string;
  // 标定板画面的说明：桌面端在二维码下面，触屏设备上没有二维码
  scanCaption: string;
  pointCaption: string;
  boardLabel: string;
  qrLabel: string;
};

type Props = {
  view: ARView;
  labels: CameraARLabels;
  // 这台设备能不能打开摄像头；不能时标定板画面不显示「用这台设备的摄像头」（OQ-59）
  canUseCamera: boolean;
  onClose: () => void;
  // 换到另一个画面，网址里的参数跟着换（U12）
  onView: (view: ARView) => void;
};

// 场景单位（一格 0.24）的近远裁剪面：手机离板子几厘米到几米都画得出来
const NEAR = 0.05;
const FAR = 100;
const METERS_PER_UNIT = BOARD.squareMeters / BOARD.squareSize;
const PDF_HREF = "/chessboard.pdf";

// 状态行前的圆点：追踪到是绿色，在找是琥珀色，打开中是灰色，都在闪
const dotColor: Record<Exclude<TrackingStatus, "error">, string> = {
  starting: "bg-muted",
  searching: "bg-(--cat-engines)",
  tracking: "bg-(--cat-perception)",
};

const chipButton =
  "inline-flex items-center rounded-full border border-accent/60 bg-black/60 px-3 py-2 text-sm font-semibold text-accent backdrop-blur transition-colors hover:bg-surface active:scale-[0.98]";
const primaryButton =
  "inline-flex rounded-full bg-foreground px-3 py-2 text-base font-semibold text-background transition hover:bg-white active:scale-[0.98]";

// 摄像头 AR 的全屏叠层（docs/design_camera_ar.md §5.7）。摄像头画面（U5–U7）：下面是摄像头画面，上面是透明的
// 3D 画布，城堡和 OpenCV 风格的角点、坐标轴按真实标定板的位姿画上去；标定板画面（U9–U12）：屏幕上显示一块
// 标定板，让另一台设备的摄像头对准它，桌面端旁边有打开摄像头 AR 的二维码。
// 由 HeroViewport 在打开时才加载，所以追踪、位姿、three.js 和二维码都不进首页的代码。
// Reveal 会给首页内容加 transform，fixed 定位会相对它，所以叠层用 portal 挂到 body 上
export default function CameraAR({ view, labels, canUseCamera, onClose, onView }: Props) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);

  // 页面不能滚动
  useEffect(() => {
    const root = document.documentElement;
    const overflow = root.style.overflow;
    root.style.overflow = "hidden";
    return () => {
      root.style.overflow = overflow;
    };
  }, []);

  // 打开时、换画面后焦点落在关闭按钮上：原来有焦点的按钮可能随着换画面消失了
  useEffect(() => {
    closeRef.current?.focus();
  }, [view]);

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

  return createPortal(
    <div
      ref={dialogRef}
      role="dialog"
      aria-modal="true"
      aria-label={labels.title}
      className="fixed inset-0 z-50 overflow-hidden bg-black text-foreground"
    >
      {view === "camera" ? (
        <CameraView labels={labels} onClose={onClose} onShowBoard={() => onView("board")} />
      ) : (
        <BoardView labels={labels} canUseCamera={canUseCamera} onUseCamera={() => onView("camera")} />
      )}
      <button
        ref={closeRef}
        type="button"
        onClick={onClose}
        aria-label={labels.close}
        className="panel absolute right-6 top-6 flex size-10 items-center justify-center rounded-full bg-surface/70 backdrop-blur transition-colors hover:bg-raised active:scale-[0.98] sm:right-8"
      >
        <X aria-hidden size={20} />
      </button>
    </div>,
    document.body,
  );
}

// 摄像头画面：打开摄像头、追踪标定板，把城堡画在板子上。离开这个画面时摄像头就关掉
function CameraView({ labels, onClose, onShowBoard }: { labels: CameraARLabels; onClose: () => void; onShowBoard: () => void }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const sceneRef = useRef<HTMLDivElement>(null);
  const fpsRef = useRef<HTMLSpanElement>(null);
  const poseRef = useRef<HTMLSpanElement>(null);
  const [status, setStatus] = useState<TrackingStatus>("starting");
  const [error, setError] = useState<CameraError | null>(null);

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

  return (
    <>
      {/* 不镜像：前置摄像头也照原样显示（D2）。画面和 3D 画布用同样的 cover 方式铺满 */}
      <video ref={videoRef} playsInline muted autoPlay className="absolute inset-0 h-full w-full object-cover" />
      <div ref={sceneRef} aria-hidden className="pointer-events-none absolute inset-0" />
      <HudCorners className="inset-4" />

      {/* 右边留出关闭按钮的位置 */}
      <div className="absolute inset-x-6 top-6 flex items-start justify-between gap-4 pr-14 text-xs sm:inset-x-8">
        {error === null ? (
          <span role="status" className="flex items-center gap-2 rounded-lg bg-black/60 px-2 py-1 backdrop-blur">
            <span aria-hidden className={`size-2 shrink-0 rounded-full motion-safe:animate-pulse ${dotColor[status as keyof typeof dotColor]}`} />
            {statusText}
          </span>
        ) : (
          <span />
        )}
        <span ref={fpsRef} className="rounded-lg bg-black/60 px-2 py-1 font-mono tabular-nums text-muted backdrop-blur">
          0 FPS
        </span>
      </div>

      <div className="absolute inset-x-6 bottom-6 flex flex-wrap items-end justify-between gap-3 text-xs sm:inset-x-8">
        {/* 相机相对板子中心的位置，只在追踪时显示；一直挂着，onUpdate 才能直接改它的文字 */}
        <span className={`flex flex-wrap items-baseline gap-x-3 gap-y-1 ${status === "tracking" ? "" : "invisible"}`}>
          <span ref={poseRef} className="rounded-lg bg-black/60 px-2 py-1 font-mono tabular-nums backdrop-blur" />
          <span className="text-muted">{labels.note}</span>
        </span>
        {error === null && (
          <span className="flex flex-wrap justify-end gap-2">
            <button type="button" onClick={onShowBoard} className={chipButton}>
              {labels.showBoard}
            </button>
            <a href={PDF_HREF} download className={chipButton}>
              {labels.print}
            </a>
          </span>
        )}
      </div>

      {error !== null && (
        <div className="absolute inset-0 flex items-center justify-center px-4">
          <div role="alert" className="panel relative w-full max-w-[420px] rounded-3xl bg-surface p-6 text-center">
            <HudCorners className="inset-3 opacity-50" />
            <p className="text-base">{labels.errors[error]}</p>
            <div className="mt-6 flex flex-wrap justify-center gap-3">
              <button type="button" onClick={onShowBoard} className={primaryButton}>
                {labels.showBoardInstead}
              </button>
              <button
                type="button"
                onClick={onClose}
                className="panel inline-flex rounded-full bg-surface px-3 py-2 text-base font-semibold transition hover:bg-raised active:scale-[0.98]"
              >
                {labels.close}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

// 标定板画面：白底上一块 10×7 的棋盘格，四周留半格白边，尽量铺满；左上角那格是黑的，和打印的一样（U10）。
// 桌面端旁边放二维码，用手机扫了直接打开摄像头 AR（U11）。显示期间屏幕保持常亮，离开这个画面或关闭时释放
function BoardView({ labels, canUseCamera, onUseCamera }: { labels: CameraARLabels; canUseCamera: boolean; onUseCamera: () => void }) {
  // 叠层只在浏览器里渲染，这里直接读一次：有粗指针（触屏）的设备不放二维码
  const [touch] = useState(() => matchMedia("(any-pointer: coarse)").matches);
  // 二维码打开同一语言首页的摄像头画面，如 https://yu-cao.vercel.app/en?ar=camera
  const [qrUrl] = useState(() => `${window.location.origin}/${window.location.pathname.split("/")[1]}?ar=camera`);

  useEffect(() => {
    if (!("wakeLock" in navigator)) return;
    let sentinel: WakeLockSentinel | null = null;
    let active = true;
    // 页面切到后台时浏览器会自动释放，回来时再申请一次
    const acquire = () => {
      if (document.visibilityState !== "visible" || (sentinel && !sentinel.released)) return;
      navigator.wakeLock
        .request("screen")
        .then((lock) => {
          if (active) sentinel = lock;
          else void lock.release();
        })
        .catch(() => {
          // 省电模式等情况下申请不到，不影响显示标定板
        });
    };
    acquire();
    document.addEventListener("visibilitychange", acquire);
    return () => {
      active = false;
      document.removeEventListener("visibilitychange", acquire);
      void sentinel?.release().catch(() => {});
    };
  }, []);

  const caption = touch ? labels.pointCaption : labels.scanCaption;

  return (
    <div className="absolute inset-0 flex flex-col items-center gap-6 px-6 pb-6 pt-20 lg:flex-row lg:pt-6 lg:pr-24">
      <div className="relative min-h-0 w-full flex-1 self-stretch">
        <ChessboardSvg label={labels.boardLabel} />
      </div>
      <div className="flex shrink-0 flex-col items-center gap-4 text-center lg:w-60">
        {!touch && <QrCode url={qrUrl} label={labels.qrLabel} />}
        <p className="max-w-[320px] text-sm text-muted">{caption}</p>
        <div className="flex flex-wrap justify-center gap-2">
          {canUseCamera && (
            <button type="button" onClick={onUseCamera} className={chipButton}>
              {labels.useCamera}
            </button>
          )}
          <a href={PDF_HREF} download className={chipButton}>
            {labels.print}
          </a>
        </div>
      </div>
    </div>
  );
}

// 屏幕上的标定板：坐标单位是一格，白边半格；crispEdges 让相邻格子之间没有抗锯齿的灰边
function ChessboardSvg({ label }: { label: string }) {
  const squares: React.ReactNode[] = [];
  for (let r = 0; r < BOARD.squaresY; r++) {
    for (let c = 0; c < BOARD.squaresX; c++) {
      if ((r + c) % 2 === 0) squares.push(<rect key={`${r}-${c}`} x={c} y={r} width={1} height={1} />);
    }
  }
  return (
    <svg
      role="img"
      aria-label={label}
      viewBox={`-0.5 -0.5 ${BOARD.squaresX + 1} ${BOARD.squaresY + 1}`}
      preserveAspectRatio="xMidYMid meet"
      shapeRendering="crispEdges"
      className="absolute inset-0 h-full w-full"
    >
      <rect x={-0.5} y={-0.5} width={BOARD.squaresX + 1} height={BOARD.squaresY + 1} fill="#ffffff" />
      <g fill="#000000">{squares}</g>
    </svg>
  );
}

// 二维码：每个深色模块画成一个 1×1 的方格，合成一条路径；四周留 4 个模块的白边，扫码更稳
function QrCode({ url, label }: { url: string; label: string }) {
  const { path, size } = useMemo(() => {
    const qr = encode(url, { ecc: "M", border: 4 });
    let d = "";
    qr.data.forEach((row, y) => row.forEach((dark, x) => dark && (d += `M${x} ${y}h1v1h-1z`)));
    return { path: d, size: qr.size };
  }, [url]);
  return (
    <svg role="img" aria-label={label} viewBox={`0 0 ${size} ${size}`} shapeRendering="crispEdges" className="size-44 rounded-lg">
      <rect width={size} height={size} fill="#ffffff" />
      <path d={path} fill="#000000" />
    </svg>
  );
}

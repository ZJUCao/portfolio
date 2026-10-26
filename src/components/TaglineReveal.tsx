"use client";

import { useEffect, useRef } from "react";

// 一句大字的核心卖点。文字先只有 30% 的亮度，滚动到这里时按阅读顺序一个词一个词亮起来，亮了就不再变暗。
// 进度由一个用 requestAnimationFrame 节流的滚动监听算出；「减少动态效果」时直接全亮。
// lines 是按意思断好的行，每行再分成词（中文按词语切分，见 home 页里的 splitWords）
export function TaglineReveal({ lines, className }: { lines: string[][]; className?: string }) {
  const ref = useRef<HTMLParagraphElement>(null);

  useEffect(() => {
    const root = ref.current;
    if (!root) return;
    const words = Array.from(root.querySelectorAll<HTMLElement>("[data-word]"));
    const light = (count: number) => words.slice(0, count).forEach((word) => word.setAttribute("data-on", ""));
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) {
      light(words.length);
      return;
    }

    let lit = 0;
    let frame = 0;
    const update = () => {
      frame = 0;
      // 段落顶边到达屏幕 85% 高度时亮起第一个词，底边到达 45% 时全部亮完
      const box = root.getBoundingClientRect();
      const start = innerHeight * 0.85;
      const end = innerHeight * 0.45 - box.height;
      const progress = Math.min(Math.max((start - box.top) / (start - end), 0), 1);
      const count = Math.round(progress * words.length);
      if (count > lit) light((lit = count));
    };
    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(update);
    };
    update();
    addEventListener("scroll", onScroll, { passive: true });
    addEventListener("resize", onScroll);
    return () => {
      cancelAnimationFrame(frame);
      removeEventListener("scroll", onScroll);
      removeEventListener("resize", onScroll);
    };
  }, []);

  return (
    <p ref={ref} className={className}>
      {lines.map((words, i) => (
        <span key={i} className="block">
          {words.map((word, j) => (
            <span key={j} data-word className="opacity-30 transition-opacity duration-500 data-on:opacity-100">
              {word}
            </span>
          ))}
        </span>
      ))}
    </p>
  );
}

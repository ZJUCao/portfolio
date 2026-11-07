"use client";

import { usePathname } from "next/navigation";
import { useEffect, useReducer } from "react";
import { setTouch, showing } from "@/cut/coverHistory";

// 后退、前进时封面放大缩小要用到的两样东西（src/cut/coverHistory.ts、src/instrumentation-client.ts）：
// 屏幕上是哪一页，和一次没用的状态更新，好让后退、前进那次 Transition 里有更新、跟 Next 的还原一起提交。
// 整个网站只放一个，在 [lang] 的布局里，什么都不画
export function CoverHistory() {
  const pathname = usePathname();
  const [, touch] = useReducer((n: number) => n + 1, 0);

  useEffect(() => {
    showing(pathname);
  }, [pathname]);

  useEffect(() => {
    setTouch(touch);
    return () => setTouch(null);
  }, []);

  return null;
}

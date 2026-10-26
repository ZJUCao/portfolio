"use client";

import { MotionConfig } from "motion/react";

// Motion 默认不理会系统的「减少动态效果」。这里让它跟随系统：开启时所有 Motion 动画只保留透明度变化，不再位移
export function MotionProvider({ children }: { children: React.ReactNode }) {
  return <MotionConfig reducedMotion="user">{children}</MotionConfig>;
}

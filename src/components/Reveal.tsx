"use client";

import { motion } from "motion/react";
import { useEffect, useState } from "react";
import { arrived, arrivingWithCover } from "@/cut/coverHistory";

// 元素滚动进入视口时上移 32px 并淡入，只播放一次；「减少动态效果」时只淡入，见 MotionProvider。
// 项目封面缩回卡片时进来的页面直接显示，不再淡入，封面落进去的那张卡片已经在那里（src/cut/coverHistory.ts）。
// 放在列表里时用 as="li"，保持 ul / ol 下直接是 li
export function Reveal({
  children,
  delay = 0,
  className,
  as = "div",
}: {
  children: React.ReactNode;
  delay?: number;
  className?: string;
  as?: "div" | "li";
}) {
  const Tag = as === "li" ? motion.li : motion.div;
  // 只在第一次渲染时问；页面加载时总是 false，和服务端渲染的一样。这一页的 Reveal 都渲染完才会跑到 effect，
  // 这时清掉标记，以后再出现的（比如换分类时新进来的卡片）照常淡入
  const [shown] = useState(arrivingWithCover);
  useEffect(() => {
    if (shown) arrived();
  }, [shown]);
  return (
    <Tag
      className={className}
      initial={shown ? false : { opacity: 0, y: 32 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-64px" }}
      transition={{ duration: 0.7, delay, ease: [0.22, 1, 0.36, 1] }}
    >
      {children}
    </Tag>
  );
}

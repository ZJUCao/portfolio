"use client";

import Link from "next/link";
import { markCoverArrival } from "@/cut/coverHistory";
import { COVER_TYPE, isDetailPath } from "@/cut/coverMorph";

// 带 COVER_TYPE 的链接（docs/design_space_cut.md §6.6、§13 P5）：项目卡片进详情页、详情页的「全部项目」回列表，
// 这次跳转里封面放大成头图或缩回卡片。回到有卡片的页面时先打上标记，那一页的 Reveal 不再淡入（src/cut/coverHistory.ts）
export function CoverLink({ href, onNavigate, ...props }: React.ComponentProps<typeof Link> & { href: string }) {
  return (
    <Link
      {...props}
      href={href}
      transitionTypes={[COVER_TYPE]}
      onNavigate={(event) => {
        if (!isDetailPath(href)) markCoverArrival();
        onNavigate?.(event);
      }}
    />
  );
}

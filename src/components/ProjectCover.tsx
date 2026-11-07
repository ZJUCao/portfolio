import { ViewTransition } from "react";
import { CoverArt } from "@/components/CoverArt";
import { CoverImage } from "@/components/CoverImage";
import { HudCorners } from "@/components/HudCorners";
import { COVER_SHARE, coverTransitionName } from "@/cut/coverMorph";
import type { Project } from "@/data/projects";

// 项目的封面：README 里的截图，没有截图时是按分类画的线稿，四角是取景框标记。卡片封面和详情页头图都用它，
// 两边包在同名的 <ViewTransition> 里，点卡片进详情页时卡片封面放大成头图，从详情页的「全部项目」回去时反过来
// （docs/design_space_cut.md §6.6、D7）。只有带 COVER_TYPE 的跳转才配对，别的跳转里它不动。
// 放在 relative 的容器里铺满它；className 给它和容器一样的圆角，过渡时浏览器单独截下这一块，截图里不会带上外层的圆角。
// children 叠在封面上（卡片的分类标签），过渡时跟着封面一起走，不会被飞过来的封面盖住。
// 头图不能放在 Reveal 里：Reveal 开始时透明、下移 32px，截下来的位置就错了（设计文档 §2）
export function ProjectCover({
  project,
  alt,
  className = "",
  priority = false,
  children,
}: {
  project: Project;
  alt: string;
  className?: string;
  /** 详情页头图在首屏，立刻加载 */
  priority?: boolean;
  children?: React.ReactNode;
}) {
  return (
    <ViewTransition name={coverTransitionName(project.slug)} share={COVER_SHARE} default="none">
      <div className={`absolute inset-0 overflow-hidden bg-background ${className}`}>
        {project.cover ? <CoverImage src={project.cover} alt={alt} priority={priority} /> : <CoverArt category={project.category.id} />}
        <HudCorners className="inset-3 opacity-70" color="var(--tint)" />
        {children}
      </div>
    </ViewTransition>
  );
}

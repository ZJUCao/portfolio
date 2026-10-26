import { ArrowRight, Star } from "@phosphor-icons/react/ssr";
import Link from "next/link";
import { CoverArt } from "@/components/CoverArt";
import { CoverImage } from "@/components/CoverImage";
import { HudCorners } from "@/components/HudCorners";
import { LanguageDot } from "@/components/LanguageDot";
import { Tilt } from "@/components/Tilt";
import type { Content } from "@/data/profile";
import { formatMonth, type Project } from "@/data/projects";

// 所有卡片一样大：封面固定 16:10，标题、底部信息各占一行，简介最多两行，技术栈最多一行，放不下的截断，完整内容在详情页。
// 放卡片的网格要加 auto-rows-fr 让每一行一样高，并显式写 grid-cols-1，否则单列时列宽会被不换行的长标题撑开。
// 卡片的强调色 --tint 是所属分类的颜色（globals.css 里的 --cat-*）
export function ProjectCard({ project, c }: { project: Project; c: Content }) {
  // 编程语言已经显示在底部，技术栈这里只列库和工具
  const languages = new Set(project.languages.map((l) => l.name));
  const stack = project.stack.filter((tech) => !languages.has(tech));

  return (
    <Tilt className="h-full">
      <Link
        href={`/${c.locale}/projects/${project.slug}`}
        style={{ "--tint": `var(--cat-${project.category.id})` } as React.CSSProperties}
        className="panel group relative flex h-full flex-col overflow-hidden rounded-3xl bg-surface transition hover:border-[color-mix(in_srgb,var(--tint)_55%,transparent)] hover:bg-raised active:scale-[0.98]"
      >
        <div className="relative aspect-[16/10] overflow-hidden bg-background">
          {project.cover ? (
            <CoverImage src={project.cover} alt={c.ui.coverAlt(project.title)} />
          ) : (
            <CoverArt category={project.category.id} />
          )}
          <HudCorners className="inset-3 opacity-70" color="var(--tint)" />
          {/* 离卡片圆角 16px，圆角取 24 − 16 = 8px */}
          <span className="absolute left-4 top-4 flex max-w-[calc(100%-2rem)] items-center gap-2 rounded-lg bg-black/60 px-2 py-1 text-xs text-foreground backdrop-blur">
            <span aria-hidden className="size-2 shrink-0 rounded-full bg-(--tint)" />
            <span className="truncate">{project.category.label}</span>
          </span>
        </div>
        <div className="flex flex-1 flex-col p-6">
          <div className="flex items-center justify-between gap-4">
            <h3 className="min-w-0 truncate text-lg font-semibold tracking-tight">{project.title}</h3>
            <ArrowRight
              aria-hidden
              size={20}
              className="shrink-0 text-muted transition-transform duration-500 group-hover:translate-x-1 group-hover:text-(--tint)"
            />
          </div>
          <p className="mt-2 line-clamp-2 flex-1 text-sm text-muted">{project.summary ?? c.ui.noDescription}</p>
          {stack.length > 0 && (
            <ul className="mt-4 flex max-h-5 flex-wrap gap-2 overflow-hidden">
              {stack.map((tech) => (
                <li key={tech} className="chip">
                  {tech}
                </li>
              ))}
            </ul>
          )}
          <div className="mt-4 flex items-center gap-x-4 whitespace-nowrap text-xs text-muted tabular-nums">
            {project.language && <LanguageDot name={project.language} />}
            {project.stars > 0 && (
              <span className="flex items-center gap-1">
                <Star aria-hidden size={12} weight="fill" />
                {project.stars}
              </span>
            )}
            <span className="min-w-0 truncate">
              {c.ui.updated} {formatMonth(c.locale, project.pushedAt)}
            </span>
          </div>
        </div>
      </Link>
    </Tilt>
  );
}

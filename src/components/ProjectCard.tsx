import Link from "next/link";
import { CoverArt } from "@/components/CoverArt";
import { CoverImage } from "@/components/CoverImage";
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
        className="glass group relative flex h-full flex-col overflow-hidden rounded-3xl transition-[border-color,box-shadow] duration-300 hover:border-[color-mix(in_srgb,var(--tint)_55%,transparent)] hover:shadow-[0_30px_60px_-30px_color-mix(in_srgb,var(--tint)_45%,transparent)]"
      >
        <span aria-hidden className="spotlight pointer-events-none absolute inset-0 z-10 opacity-0 transition-opacity duration-300 group-hover:opacity-100" />
        <div className="relative aspect-[16/10] overflow-hidden border-b border-line bg-black/40">
          {project.cover ? <CoverImage src={project.cover} /> : <CoverArt category={project.category.id} />}
          <span aria-hidden className="hud-corners absolute inset-3 opacity-70 [--hud-color:var(--tint)]" />
          <span className="absolute left-4 top-3.5 flex max-w-[calc(100%-2rem)] items-center gap-1.5 rounded-full bg-black/55 px-2.5 py-1 font-mono text-[11px] text-foreground backdrop-blur">
            <span aria-hidden className="h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--tint)]" />
            <span className="truncate">{project.category.label}</span>
          </span>
        </div>
        <div className="flex flex-1 flex-col p-5">
          <div className="flex items-baseline justify-between gap-4">
            <h3 className="min-w-0 truncate text-lg font-semibold tracking-tight">{project.title}</h3>
            <span className="shrink-0 text-muted transition-transform group-hover:translate-x-0.5 group-hover:text-[var(--tint)]">→</span>
          </div>
          <p className="mt-2 line-clamp-2 flex-1 text-sm leading-relaxed text-muted">{project.summary ?? c.ui.noDescription}</p>
          {stack.length > 0 && (
            <ul className="mt-4 flex max-h-[1.375rem] flex-wrap gap-1.5 overflow-hidden">
              {stack.map((tech) => (
                <li key={tech} className="chip">
                  {tech}
                </li>
              ))}
            </ul>
          )}
          <div className="mt-4 flex items-center gap-x-4 whitespace-nowrap font-mono text-xs text-muted">
            {project.language && <LanguageDot name={project.language} />}
            {project.stars > 0 && <span>★ {project.stars}</span>}
            <span className="min-w-0 truncate">
              {c.ui.updated} {formatMonth(c.locale, project.pushedAt)}
            </span>
          </div>
        </div>
      </Link>
    </Tilt>
  );
}

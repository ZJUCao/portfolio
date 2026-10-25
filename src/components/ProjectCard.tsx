import Link from "next/link";
import { LanguageDot } from "@/components/LanguageDot";
import type { Content } from "@/data/profile";
import { formatMonth, type Project } from "@/data/projects";

// 所有卡片一样大：分类、标题、底部信息各占一行，简介最多三行，主题最多一行，放不下的截断，完整内容在详情页。
// 放卡片的网格要加 auto-rows-fr 让每一行一样高，并显式写 grid-cols-1，否则单列时列宽会被不换行的长标题撑开
export function ProjectCard({ project, c }: { project: Project; c: Content }) {
  return (
    <Link
      href={`/${c.locale}/projects/${project.slug}`}
      className="group flex h-full flex-col rounded-2xl border border-line bg-surface p-6 transition-colors hover:border-accent"
    >
      <p className="truncate font-mono text-xs text-muted">{project.category.label}</p>
      <div className="mt-2 flex items-baseline justify-between gap-4">
        <h3 className="min-w-0 truncate text-lg font-semibold tracking-tight group-hover:text-accent">{project.title}</h3>
        <span className="shrink-0 text-muted transition-transform group-hover:translate-x-0.5 group-hover:text-accent">→</span>
      </div>
      <p className="mt-3 line-clamp-3 flex-1 text-sm leading-relaxed text-muted">{project.summary ?? c.ui.noDescription}</p>
      {project.topics.length > 0 && (
        <ul className="mt-5 flex max-h-6 flex-wrap gap-2 overflow-hidden">
          {project.topics.map((topic) => (
            <li key={topic} className="rounded-full border border-line px-2.5 py-0.5 font-mono text-xs text-muted">
              {topic}
            </li>
          ))}
        </ul>
      )}
      <div className="mt-5 flex items-center gap-x-4 whitespace-nowrap font-mono text-xs text-muted">
        {project.language && <LanguageDot name={project.language} />}
        {project.stars > 0 && <span>★ {project.stars}</span>}
        <span className="min-w-0 truncate">
          {c.ui.updated} {formatMonth(c.locale, project.pushedAt)}
        </span>
      </div>
    </Link>
  );
}

import Link from "next/link";
import { LanguageDot } from "@/components/LanguageDot";
import type { Content } from "@/data/profile";
import { formatMonth, type Project } from "@/data/projects";

export function ProjectCard({ project, c }: { project: Project; c: Content }) {
  return (
    <Link
      href={`/${c.locale}/projects/${project.slug}`}
      className="group flex h-full flex-col rounded-2xl border border-line bg-surface p-6 transition-colors hover:border-accent"
    >
      <p className="font-mono text-xs text-muted">{project.category.label}</p>
      <div className="mt-2 flex items-baseline justify-between gap-4">
        <h3 className="text-lg font-semibold tracking-tight group-hover:text-accent">{project.title}</h3>
        <span className="shrink-0 text-muted transition-transform group-hover:translate-x-0.5 group-hover:text-accent">→</span>
      </div>
      <p className="mt-3 flex-1 text-sm leading-relaxed text-muted">{project.summary ?? c.ui.noDescription}</p>
      {project.topics.length > 0 && (
        <ul className="mt-5 flex flex-wrap gap-2">
          {project.topics.map((topic) => (
            <li key={topic} className="rounded-full border border-line px-2.5 py-0.5 font-mono text-xs text-muted">
              {topic}
            </li>
          ))}
        </ul>
      )}
      <div className="mt-5 flex flex-wrap items-center gap-x-4 gap-y-1 font-mono text-xs text-muted">
        {project.language && <LanguageDot name={project.language} />}
        {project.stars > 0 && <span>★ {project.stars}</span>}
        <span>
          {c.ui.updated} {formatMonth(c.locale, project.pushedAt)}
        </span>
      </div>
    </Link>
  );
}

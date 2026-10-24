import type { Project } from "@/data/profile";

export function ProjectCard({ project }: { project: Project }) {
  return (
    <article className="group h-full rounded-2xl border border-line bg-surface p-6 transition-colors hover:border-accent">
      <div className="flex items-baseline justify-between gap-4">
        <h3 className="text-lg font-semibold tracking-tight group-hover:text-accent">{project.title}</h3>
        <span className="font-mono text-xs text-muted">{project.year}</span>
      </div>
      <p className="mt-3 text-sm leading-relaxed text-muted">{project.summary}</p>
      <ul className="mt-5 flex flex-wrap gap-2">
        {project.tags.map((tag) => (
          <li key={tag} className="rounded-full border border-line px-2.5 py-0.5 font-mono text-xs text-muted">
            {tag}
          </li>
        ))}
      </ul>
      {project.links && (
        <div className="mt-5 flex gap-4 text-sm">
          {project.links.map((link) => (
            <a key={link.href} href={link.href} target="_blank" rel="noreferrer" className="underline-offset-4 hover:underline">
              {link.label} ↗
            </a>
          ))}
        </div>
      )}
    </article>
  );
}

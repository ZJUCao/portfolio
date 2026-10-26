import type { Metadata } from "next";
import Link from "next/link";
import { languageColor, LanguageDot } from "@/components/LanguageDot";
import { Readme } from "@/components/Readme";
import { Reveal } from "@/components/Reveal";
import { contentFor } from "@/data/profile";
import { formatMonth, getProject, projectSlugs } from "@/data/projects";
import { alternatesFor, htmlLang } from "@/i18n";

// 静态导出：每个 GitHub 仓库在每种语言下生成一个详情页；新仓库要等下一次构建才出现
export const dynamicParams = false;
export const generateStaticParams = () => projectSlugs().map((slug) => ({ slug }));

export async function generateMetadata({ params }: PageProps<"/[lang]/projects/[slug]">): Promise<Metadata> {
  const { lang, slug } = await params;
  const c = contentFor(lang);
  const { project } = getProject(c.locale, slug);
  return {
    title: project.title,
    description: project.summary ?? undefined,
    alternates: alternatesFor(`/projects/${slug}`),
  };
}

export default async function ProjectPage({ params }: PageProps<"/[lang]/projects/[slug]">) {
  const { lang, slug } = await params;
  const c = contentFor(lang);
  const { project, prev, next } = getProject(c.locale, slug);

  const facts = [
    { label: c.ui.updated, value: formatMonth(c.locale, project.pushedAt) },
    { label: c.ui.created, value: formatMonth(c.locale, project.createdAt) },
    { label: c.ui.stars, value: String(project.stars) },
    { label: c.ui.forks, value: String(project.forks) },
    ...(project.license ? [{ label: c.ui.license, value: project.license }] : []),
  ];

  return (
    // --tint：项目所属分类的颜色，和卡片上的一样
    <article style={{ "--tint": `var(--cat-${project.category.id})` } as React.CSSProperties}>
      <Reveal>
        <Link href={`/${lang}/projects`} className="text-sm text-muted hover:text-foreground">
          {c.ui.backToProjects}
        </Link>
      </Reveal>

      <header className="mt-8">
        <Reveal delay={0.04}>
          <Link
            href={`/${lang}/projects?category=${project.category.id}`}
            className="inline-flex items-center gap-2 font-mono text-sm text-[var(--tint)] hover:underline"
          >
            <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-[var(--tint)]" />
            {project.category.label}
          </Link>
          <h1 className="mt-3 break-words text-4xl font-semibold tracking-tight sm:text-5xl">{project.title}</h1>
        </Reveal>
        <Reveal delay={0.08}>
          <p className="mt-5 max-w-2xl text-lg leading-relaxed text-muted">{project.summary ?? c.ui.noDescription}</p>
        </Reveal>
        <Reveal delay={0.12} className="mt-6 flex flex-wrap items-center gap-x-5 gap-y-2 font-mono text-xs text-muted">
          {project.language && <LanguageDot name={project.language} />}
          {project.stars > 0 && <span>★ {project.stars}</span>}
          <span>
            {c.ui.updated} {formatMonth(c.locale, project.pushedAt)}
          </span>
        </Reveal>
        <Reveal delay={0.16} className="mt-8 flex flex-wrap gap-3">
          <a
            href={project.url}
            target="_blank"
            rel="noreferrer"
            className="rounded-full bg-foreground px-5 py-2.5 text-sm font-medium text-background shadow-[0_0_32px_-8px_rgb(95_227_255/0.7)] transition-shadow hover:shadow-[0_0_40px_-4px_rgb(95_227_255/0.8)]"
          >
            {c.ui.viewOnGithub} ↗
          </a>
          {project.homepage && (
            <a
              href={project.homepage}
              target="_blank"
              rel="noreferrer"
              className="glass rounded-full px-5 py-2.5 text-sm font-medium transition-colors hover:border-accent/60"
            >
              {c.ui.liveDemo} ↗
            </a>
          )}
        </Reveal>
      </header>

      {project.video && (
        <Reveal className="mt-14">
          <h2 className="text-sm font-medium text-muted">{c.ui.demoVideo}</h2>
          <div className="glass mt-4 aspect-video overflow-hidden rounded-3xl">
            <iframe
              src={project.video.embedUrl}
              title={`${project.title} — ${c.ui.demoVideo}`}
              className="h-full w-full"
              allow="accelerometer; clipboard-write; encrypted-media; gyroscope; picture-in-picture; fullscreen"
              allowFullScreen
              loading="lazy"
            />
          </div>
        </Reveal>
      )}

      <div className="mt-14 grid gap-8 lg:grid-cols-[minmax(0,1fr)_260px]">
        <Reveal className="min-w-0">
          <section className="glass relative rounded-3xl p-6 sm:p-8">
            <span aria-hidden className="hud-corners absolute inset-3 opacity-50 [--hud-color:var(--tint)]" />
            <h2 className="font-mono text-xs uppercase tracking-wider text-muted">{c.ui.readme}</h2>
            {project.readme ? (
              <>
                {project.readme.lang && project.readme.lang !== c.locale && (
                  <p className="mt-3 text-sm text-muted">{c.ui.readmeOtherLanguage}</p>
                )}
                <Readme
                  html={project.readme.html}
                  lang={project.readme.lang ? htmlLang(project.readme.lang) : undefined}
                  className="readme prose prose-sm mt-6 max-w-none sm:prose-base"
                />
              </>
            ) : (
              <p className="mt-6 text-muted">{c.ui.noReadme}</p>
            )}
          </section>
        </Reveal>
        <Reveal className="min-w-0">
          <aside className="glass space-y-8 rounded-3xl p-6 lg:sticky lg:top-24">
            {project.languages.length > 0 && (
              <section>
                <h2 className="text-sm font-medium">{c.ui.languages}</h2>
                <div className="mt-3 flex h-2 overflow-hidden rounded-full bg-line">
                  {project.languages.map((l) => (
                    <span key={l.name} style={{ width: `${l.percent}%`, backgroundColor: languageColor(l.name) }} />
                  ))}
                </div>
                <ul className="mt-3 space-y-1.5 font-mono text-xs text-muted">
                  {project.languages.slice(0, 6).map((l) => (
                    <li key={l.name} className="flex justify-between gap-2">
                      <LanguageDot name={l.name} />
                      <span>{l.percent < 0.1 ? "<0.1" : l.percent.toFixed(1)}%</span>
                    </li>
                  ))}
                </ul>
              </section>
            )}

            {project.stack.length > 0 && (
              <section>
                <h2 className="text-sm font-medium">{c.ui.stack}</h2>
                <ul className="mt-3 flex flex-wrap gap-2">
                  {project.stack.map((tech) => (
                    <li key={tech} className="chip">
                      {tech}
                    </li>
                  ))}
                </ul>
              </section>
            )}

            <section>
              <h2 className="text-sm font-medium">{c.ui.details}</h2>
              <dl className="mt-3 space-y-1.5 font-mono text-xs">
                {facts.map((f) => (
                  <div key={f.label} className="flex justify-between gap-2">
                    <dt className="text-muted">{f.label}</dt>
                    <dd>{f.value}</dd>
                  </div>
                ))}
              </dl>
            </section>

            {project.topics.length > 0 && (
              <section>
                <h2 className="text-sm font-medium">{c.ui.topics}</h2>
                <ul className="mt-3 flex flex-wrap gap-2">
                  {project.topics.map((topic) => (
                    <li key={topic} className="chip">
                      {topic}
                    </li>
                  ))}
                </ul>
              </section>
            )}
          </aside>
        </Reveal>

      </div>

      {(prev || next) && (
        <nav className="mt-16 grid gap-4 border-t border-line pt-8 sm:grid-cols-2">
          {prev ? (
            <Link href={`/${lang}/projects/${prev.slug}`} className="group rounded-2xl p-4 transition-colors hover:bg-white/5">
              <span className="text-xs text-muted">← {c.ui.prevProject}</span>
              <span className="mt-1 block font-semibold group-hover:text-accent">{prev.title}</span>
            </Link>
          ) : (
            <span />
          )}
          {next && (
            <Link href={`/${lang}/projects/${next.slug}`} className="group rounded-2xl p-4 text-right transition-colors hover:bg-white/5">
              <span className="text-xs text-muted">{c.ui.nextProject} →</span>
              <span className="mt-1 block font-semibold group-hover:text-accent">{next.title}</span>
            </Link>
          )}
        </nav>
      )}
    </article>
  );
}

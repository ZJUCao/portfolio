import { ArrowLeft, ArrowRight, ArrowUpRight, Star } from "@phosphor-icons/react/ssr";
import type { Metadata } from "next";
import Link from "next/link";
import { HudCorners } from "@/components/HudCorners";
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
        <Link
          href={`/${lang}/projects`}
          className="inline-flex items-center gap-2 text-sm font-semibold text-muted transition-colors hover:text-foreground"
        >
          <ArrowLeft aria-hidden size={16} />
          {c.ui.backToProjects}
        </Link>
      </Reveal>

      <header className="mt-8">
        <Reveal delay={0.04}>
          <Link
            href={`/${lang}/projects?category=${project.category.id}`}
            className="inline-flex items-center gap-2 text-sm font-semibold text-(--tint) hover:underline"
          >
            <span aria-hidden className="size-2 rounded-full bg-(--tint)" />
            {project.category.label}
          </Link>
          <h1 className="mt-3 break-words text-4xl font-semibold tracking-tight sm:text-5xl">{project.title}</h1>
        </Reveal>
        <Reveal delay={0.08}>
          <p className="mt-6 max-w-2xl text-lg text-muted">{project.summary ?? c.ui.noDescription}</p>
        </Reveal>
        <Reveal delay={0.12} className="mt-6 flex flex-wrap items-center gap-x-6 gap-y-2 text-sm text-muted tabular-nums">
          {project.language && <LanguageDot name={project.language} />}
          {project.stars > 0 && (
            <span className="flex items-center gap-1">
              <Star aria-hidden size={16} weight="fill" />
              {project.stars}
            </span>
          )}
          <span>
            {c.ui.updated} {formatMonth(c.locale, project.pushedAt)}
          </span>
        </Reveal>
        <Reveal delay={0.16} className="mt-8 flex flex-wrap gap-3">
          <a
            href={project.url}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-2 rounded-full bg-foreground px-3 py-2 text-base font-semibold text-background shadow-[0_0_32px_-8px_rgb(95_227_255/0.7)] transition hover:bg-white active:scale-[0.98]"
          >
            {c.ui.viewOnGithub}
            <ArrowUpRight aria-hidden size={20} />
          </a>
          {project.homepage && (
            <a
              href={project.homepage}
              target="_blank"
              rel="noreferrer"
              className="panel inline-flex items-center gap-2 rounded-full bg-surface px-3 py-2 text-base font-semibold transition hover:bg-raised active:scale-[0.98]"
            >
              {c.ui.liveDemo}
              <ArrowUpRight aria-hidden size={20} />
            </a>
          )}
        </Reveal>
      </header>

      {project.video && (
        <Reveal className="mt-16">
          <h2 className="text-sm font-semibold text-muted">{c.ui.demoVideo}</h2>
          <div className="panel mt-4 aspect-video overflow-hidden rounded-3xl bg-surface">
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

      <div className="mt-16 grid gap-8 lg:grid-cols-[minmax(0,1fr)_260px]">
        <Reveal className="min-w-0">
          <section className="panel relative rounded-3xl bg-surface p-6 sm:p-8">
            <HudCorners className="inset-3 opacity-50" color="var(--tint)" />
            <h2 className="text-sm font-semibold text-muted">{c.ui.readme}</h2>
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
          <aside className="panel space-y-8 rounded-3xl bg-surface p-6 lg:sticky lg:top-24">
            {project.languages.length > 0 && (
              <section>
                <h2 className="text-sm font-semibold">{c.ui.languages}</h2>
                <div className="mt-3 flex h-2 overflow-hidden rounded-full bg-chip">
                  {project.languages.map((l) => (
                    <span key={l.name} style={{ width: `${l.percent}%`, backgroundColor: languageColor(l.name) }} />
                  ))}
                </div>
                <ul className="mt-3 space-y-2 text-xs text-muted tabular-nums">
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
                <h2 className="text-sm font-semibold">{c.ui.stack}</h2>
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
              <h2 className="text-sm font-semibold">{c.ui.details}</h2>
              <dl className="mt-3 space-y-2 text-xs tabular-nums">
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
                <h2 className="text-sm font-semibold">{c.ui.topics}</h2>
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
            <Link href={`/${lang}/projects/${prev.slug}`} className="group rounded-2xl p-4 transition-colors hover:bg-surface">
              <span className="flex items-center gap-1 text-xs text-muted">
                <ArrowLeft aria-hidden size={12} />
                {c.ui.prevProject}
              </span>
              <span className="mt-1 block font-semibold group-hover:text-accent">{prev.title}</span>
            </Link>
          ) : (
            <span />
          )}
          {next && (
            <Link href={`/${lang}/projects/${next.slug}`} className="group rounded-2xl p-4 text-right transition-colors hover:bg-surface">
              <span className="flex items-center justify-end gap-1 text-xs text-muted">
                {c.ui.nextProject}
                <ArrowRight aria-hidden size={12} />
              </span>
              <span className="mt-1 block font-semibold group-hover:text-accent">{next.title}</span>
            </Link>
          )}
        </nav>
      )}
    </article>
  );
}

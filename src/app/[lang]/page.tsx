import type { Metadata } from "next";
import Link from "next/link";
import { HeroViewport } from "@/components/HeroViewport";
import { ProjectCard } from "@/components/ProjectCard";
import { Reveal } from "@/components/Reveal";
import { contentFor } from "@/data/profile";
import { getProjects } from "@/data/projects";
import { alternatesFor } from "@/i18n";

export const metadata: Metadata = { alternates: alternatesFor() };

export default async function Home({ params }: PageProps<"/[lang]">) {
  const { lang } = await params;
  const c = contentFor(lang);
  const featured = getProjects(c.locale).filter((p) => p.featured);

  return (
    <>
      <section className="grid items-center gap-12 lg:grid-cols-12 lg:gap-10">
        <div className="lg:col-span-5">
          <Reveal>
            <p className="flex items-center gap-3 font-mono text-xs uppercase tracking-[0.18em] text-accent">
              <span aria-hidden className="h-px w-8 bg-accent" />
              {c.focus}
            </p>
          </Reveal>
          <Reveal delay={0.08}>
            <h1 className="text-holo mt-5 text-4xl font-semibold leading-[1.1] tracking-tight sm:text-6xl lg:text-[3.25rem]">
              {c.ui.hello(c.name)}
            </h1>
          </Reveal>
          <Reveal delay={0.16}>
            <p className="mt-6 max-w-xl text-lg leading-relaxed text-muted">{c.tagline}</p>
          </Reveal>
          <Reveal delay={0.24} className="mt-10 flex flex-wrap gap-3">
            <Link
              href={`/${lang}/projects`}
              className="rounded-full bg-foreground px-5 py-2.5 text-sm font-medium text-background shadow-[0_0_32px_-8px_rgb(95_227_255/0.7)] transition-shadow hover:shadow-[0_0_40px_-4px_rgb(95_227_255/0.8)]"
            >
              {c.ui.ctaProjects}
            </Link>
            <Link
              href={`/${lang}/contact`}
              className="glass rounded-full px-5 py-2.5 text-sm font-medium transition-colors hover:border-accent/60"
            >
              {c.ui.ctaContact}
            </Link>
          </Reveal>
          <Reveal delay={0.3}>
            <p className="mt-10 flex items-center gap-2 font-mono text-xs text-muted">
              <span aria-hidden className="text-accent">◎</span>
              {c.location} · {c.coordinates}
            </p>
          </Reveal>
        </div>
        <Reveal delay={0.12} className="lg:col-span-7">
          <HeroViewport labels={c.ui.hud} />
        </Reveal>
      </section>

      {featured.length > 0 && (
      <section className="mt-28">
        <Reveal className="flex items-baseline justify-between">
          <h2 className="text-2xl font-semibold tracking-tight">{c.ui.featured}</h2>
          <Link href={`/${lang}/projects`} className="text-sm text-muted hover:text-accent">{c.ui.viewAll}</Link>
        </Reveal>
        <div className="mt-8 grid auto-rows-fr grid-cols-1 gap-5 sm:grid-cols-2">
          {featured.map((project, i) => (
            <Reveal key={project.slug} delay={i * 0.06}>
              <ProjectCard project={project} c={c} />
            </Reveal>
          ))}
        </div>
      </section>
      )}
    </>
  );
}

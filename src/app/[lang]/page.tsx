import type { Metadata } from "next";
import Link from "next/link";
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
      <section>
        <Reveal>
          <p className="font-mono text-sm text-accent">{c.title} · {c.location}</p>
        </Reveal>
        <Reveal delay={0.08}>
          <h1 className="mt-4 text-4xl font-semibold leading-tight tracking-tight sm:text-6xl">
            {c.ui.hello(c.name)}
          </h1>
        </Reveal>
        <Reveal delay={0.16}>
          <p className="mt-6 max-w-xl text-lg leading-relaxed text-muted">{c.tagline}</p>
        </Reveal>
        <Reveal delay={0.24} className="mt-10 flex flex-wrap gap-3">
          <Link href={`/${lang}/projects`} className="rounded-full bg-foreground px-5 py-2.5 text-sm font-medium text-background transition-opacity hover:opacity-85">
            {c.ui.ctaProjects}
          </Link>
          <Link href={`/${lang}/contact`} className="rounded-full border border-line px-5 py-2.5 text-sm font-medium transition-colors hover:border-foreground">
            {c.ui.ctaContact}
          </Link>
        </Reveal>
      </section>

      {featured.length > 0 && (
      <section className="mt-28">
        <Reveal className="flex items-baseline justify-between">
          <h2 className="text-2xl font-semibold tracking-tight">{c.ui.featured}</h2>
          <Link href={`/${lang}/projects`} className="text-sm text-muted hover:text-foreground">{c.ui.viewAll}</Link>
        </Reveal>
        <div className="mt-8 grid auto-rows-fr grid-cols-1 gap-4 sm:grid-cols-2">
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

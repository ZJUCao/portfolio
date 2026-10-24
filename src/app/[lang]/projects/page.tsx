import type { Metadata } from "next";
import { ProjectCard } from "@/components/ProjectCard";
import { Reveal } from "@/components/Reveal";
import { contentFor } from "@/data/profile";
import { alternatesFor } from "@/i18n";

export async function generateMetadata({ params }: PageProps<"/[lang]/projects">): Promise<Metadata> {
  const { lang } = await params;
  return { title: contentFor(lang).ui.projectsTitle, alternates: alternatesFor("/projects") };
}

export default async function ProjectsPage({ params }: PageProps<"/[lang]/projects">) {
  const { lang } = await params;
  const c = contentFor(lang);

  return (
    <>
      <Reveal>
        <h1 className="text-4xl font-semibold tracking-tight">{c.ui.projectsTitle}</h1>
        <p className="mt-4 text-muted">{c.ui.projectsIntro}</p>
      </Reveal>
      <div className="mt-12 grid gap-4 sm:grid-cols-2">
        {c.projects.map((project, i) => (
          <Reveal key={project.slug} delay={i * 0.06}>
            <ProjectCard project={project} />
          </Reveal>
        ))}
      </div>
    </>
  );
}

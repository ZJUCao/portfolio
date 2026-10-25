import type { Metadata } from "next";
import { ProjectCard } from "@/components/ProjectCard";
import { ProjectFilter } from "@/components/ProjectFilter";
import { Reveal } from "@/components/Reveal";
import { contentFor } from "@/data/profile";
import { categoriesOf, getProjects } from "@/data/projects";
import { alternatesFor } from "@/i18n";

export async function generateMetadata({ params }: PageProps<"/[lang]/projects">): Promise<Metadata> {
  const { lang } = await params;
  return { title: contentFor(lang).ui.projectsTitle, alternates: alternatesFor("/projects") };
}

export default async function ProjectsPage({ params }: PageProps<"/[lang]/projects">) {
  const { lang } = await params;
  const c = contentFor(lang);
  const projects = getProjects(c.locale);

  return (
    <>
      <Reveal>
        <h1 className="text-4xl font-semibold tracking-tight">{c.ui.projectsTitle}</h1>
        <p className="mt-4 text-muted">{c.ui.projectsIntro}</p>
      </Reveal>
      {projects.length === 0 ? (
        <p className="mt-12 rounded-2xl border border-dashed border-line p-8 text-center text-muted">{c.ui.noProjects}</p>
      ) : (
        <ProjectFilter
          categories={categoriesOf(c.locale, projects)}
          items={projects.map((project) => ({
            slug: project.slug,
            category: project.category.id,
            card: <ProjectCard project={project} c={c} />,
          }))}
          labels={{ all: c.ui.allCategories, filter: c.ui.categoryFilter }}
        />
      )}
    </>
  );
}

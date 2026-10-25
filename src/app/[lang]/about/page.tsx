import type { Metadata } from "next";
import { Reveal } from "@/components/Reveal";
import { contentFor, type Experience } from "@/data/profile";
import { getProjects } from "@/data/projects";
import { skillsOf } from "@/data/skills";
import { alternatesFor } from "@/i18n";

export async function generateMetadata({ params }: PageProps<"/[lang]/about">): Promise<Metadata> {
  const { lang } = await params;
  return { title: contentFor(lang).ui.aboutTitle, alternates: alternatesFor("/about") };
}

// 工作经历和教育经历共用的时间线
function Timeline({ title, items }: { title: string; items: Experience[] }) {
  return (
    <section className="mt-20">
      <Reveal>
        <h2 className="text-2xl font-semibold tracking-tight">{title}</h2>
      </Reveal>
      <ol className="mt-8 space-y-10 border-l border-line pl-6">
        {items.map((item, i) => (
          <Reveal key={item.role + item.org} delay={i * 0.06}>
            <li className="relative">
              <span className="absolute -left-[29px] top-1.5 h-2.5 w-2.5 rounded-full bg-accent" />
              <p className="font-mono text-xs text-muted">{item.period}</p>
              <h3 className="mt-1 font-semibold">
                {item.role} <span className="font-normal text-muted">· {item.org}</span>
              </h3>
              <ul className="mt-3 list-disc space-y-1 pl-4 text-sm leading-relaxed text-muted">
                {item.points.map((point) => (
                  <li key={point}>{point}</li>
                ))}
              </ul>
            </li>
          </Reveal>
        ))}
      </ol>
    </section>
  );
}

export default async function AboutPage({ params }: PageProps<"/[lang]/about">) {
  const { lang } = await params;
  const c = contentFor(lang);
  const skills = skillsOf(c.locale, c.skills, getProjects(c.locale));

  return (
    <>
      <Reveal>
        <h1 className="text-4xl font-semibold tracking-tight">{c.ui.aboutTitle}</h1>
      </Reveal>
      <Reveal delay={0.08} className="mt-8 max-w-2xl space-y-4 text-lg leading-relaxed text-muted">
        {c.about.map((paragraph) => (
          <p key={paragraph}>{paragraph}</p>
        ))}
      </Reveal>

      <Timeline title={c.ui.workTitle} items={c.work} />
      <Timeline title={c.ui.educationTitle} items={c.education} />

      <section className="mt-20">
        <Reveal>
          <h2 className="text-2xl font-semibold tracking-tight">{c.ui.skillsTitle}</h2>
        </Reveal>
        <div className="mt-8 grid gap-6 sm:grid-cols-3">
          {skills.map((group, i) => (
            <Reveal key={group.id} delay={i * 0.06}>
              <h3 className="text-sm font-medium">{group.label}</h3>
              <ul className="mt-3 flex flex-wrap gap-2">
                {group.skills.map((skill) => (
                  <li key={skill} className="rounded-full border border-line px-2.5 py-0.5 font-mono text-xs text-muted">
                    {skill}
                  </li>
                ))}
              </ul>
            </Reveal>
          ))}
        </div>
      </section>
    </>
  );
}

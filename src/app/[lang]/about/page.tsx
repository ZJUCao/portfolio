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

// 各节标题前的编号，像 HUD 上的分区序号
function SectionTitle({ index, children }: { index: string; children: React.ReactNode }) {
  return (
    <h2 className="flex items-baseline gap-3 text-2xl font-semibold tracking-tight">
      <span className="font-mono text-sm font-normal text-accent">{index}</span>
      {children}
    </h2>
  );
}

// 工作经历和教育经历共用的时间线
function Timeline({ index, title, items }: { index: string; title: string; items: Experience[] }) {
  return (
    <section className="mt-20">
      <Reveal>
        <SectionTitle index={index}>{title}</SectionTitle>
      </Reveal>
      <ol className="mt-8 max-w-3xl space-y-10 border-l border-line pl-6">
        {items.map((item, i) => (
          <Reveal key={item.role + item.org} delay={i * 0.06}>
            <li className="relative">
              <span className="absolute -left-[29px] top-1.5 h-2.5 w-2.5 rounded-full bg-accent shadow-[0_0_12px_rgb(95_227_255/0.8)]" />
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

      <Timeline index="01" title={c.ui.workTitle} items={c.work} />
      <Timeline index="02" title={c.ui.educationTitle} items={c.education} />

      <section className="mt-20">
        <Reveal>
          <SectionTitle index="03">{c.ui.skillsTitle}</SectionTitle>
        </Reveal>
        <div className="mt-8 grid auto-rows-fr gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {skills.map((group, i) => (
            <Reveal key={group.id} delay={i * 0.06} className="glass rounded-2xl p-5">
              <h3 className="text-sm font-medium">{group.label}</h3>
              <ul className="mt-3 flex flex-wrap gap-2">
                {group.skills.map((skill) => (
                  <li key={skill} className="chip">
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

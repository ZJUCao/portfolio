import { ArrowRight, Crosshair, Cube, Gauge, Trophy, UsersThree } from "@phosphor-icons/react/ssr";
import type { Metadata } from "next";
import Link from "next/link";
import { EmailButton } from "@/components/EmailButton";
import { HeroViewport } from "@/components/HeroViewport";
import { HudCorners } from "@/components/HudCorners";
import { ProjectCard } from "@/components/ProjectCard";
import { Reveal } from "@/components/Reveal";
import { TaglineReveal } from "@/components/TaglineReveal";
import { contentFor } from "@/data/profile";
import { getProjects } from "@/data/projects";
import { alternatesFor, htmlLang, type Locale } from "@/i18n";

export async function generateMetadata({ params }: PageProps<"/[lang]">): Promise<Metadata> {
  const { lang } = await params;
  const c = contentFor(lang);
  return {
    title: { absolute: `${c.name} · ${c.home.headline.join(" ")}` },
    alternates: alternatesFor(),
  };
}

// 「能带给团队什么」四项各配的图标，顺序和 profile.ts 里的 benefits 一致
const benefitIcons = [Gauge, Cube, Crosshair, UsersThree];

// 大字卖点逐词亮起，先切成词：中文按词语切，英文按空格切；标点和空格并到前一个词里
const splitWords = (locale: Locale, line: string) =>
  Array.from(new Intl.Segmenter(htmlLang(locale), { granularity: "word" }).segment(line)).reduce<string[]>(
    (words, { segment, isWordLike }) => {
      if (isWordLike || words.length === 0) words.push(segment);
      else words[words.length - 1] += segment;
      return words;
    },
    [],
  );

// 每一节之间的间距和标题样式
const section = "mt-16 sm:mt-24";
const sectionTitle = "text-3xl font-semibold tracking-tight";

export default async function Home({ params }: PageProps<"/[lang]">) {
  const { lang } = await params;
  const c = contentFor(lang);
  const h = c.home;
  const featured = getProjects(c.locale).filter((p) => p.featured);

  // 结构化数据：告诉搜索引擎和 AI 这是谁的主页，常见问题也按问答的格式给出
  const jsonLd = {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "Person",
        name: c.name,
        jobTitle: c.title,
        email: `mailto:${c.email}`,
        address: { "@type": "PostalAddress", addressLocality: "Boston", addressRegion: "MA", addressCountry: "US" },
        alumniOf: c.education.map((e) => ({ "@type": "CollegeOrUniversity", name: e.org.split(" · ")[0] })),
        sameAs: c.links.map((link) => link.href),
      },
      {
        "@type": "FAQPage",
        mainEntity: h.faq.map((f) => ({ "@type": "Question", name: f.q, acceptedAnswer: { "@type": "Answer", text: f.a } })),
      },
    ],
  };

  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replace(/</g, "\\u003c") }} />

      {/* 首屏：标题、副标题、唯一的主按钮、一条证明，右边是 3D 画面 */}
      <section className="grid items-center gap-12 lg:grid-cols-2">
        <div>
          <Reveal>
            <h1 className="max-w-[680px] text-4xl font-semibold tracking-tight sm:text-5xl lg:text-4xl">
              {h.headline.map((line) => (
                <span key={line} className="hero-heading block w-fit">
                  {line}
                </span>
              ))}
            </h1>
          </Reveal>
          <Reveal delay={0.08}>
            <p className="mt-6 max-w-[680px] text-lg text-muted">{h.subheadline}</p>
          </Reveal>
          <Reveal delay={0.16} className="mt-8">
            <EmailButton email={c.email} label={h.cta} />
          </Reveal>
          <Reveal delay={0.24}>
            <p className="mt-6 flex items-center gap-2 text-sm text-muted">
              <Trophy aria-hidden size={20} className="shrink-0 text-accent" />
              {h.proof}
            </p>
          </Reveal>
        </div>
        <Reveal delay={0.12}>
          <HeroViewport labels={c.ui.hud} />
        </Reveal>
      </section>

      <section className={section}>
        <Reveal>
          <h2 className={sectionTitle}>{h.benefitsTitle}</h2>
        </Reveal>
        <div className="mt-8 grid gap-6 sm:grid-cols-2">
          {h.benefits.map((benefit, i) => {
            const Icon = benefitIcons[i];
            return (
              <Reveal key={benefit.title} delay={i * 0.06} className="panel rounded-2xl bg-surface p-6">
                <Icon aria-hidden size={24} className="text-accent" />
                <h3 className="mt-4 text-lg font-semibold">{benefit.title}</h3>
                <p className="mt-2 text-muted">{benefit.body}</p>
              </Reveal>
            );
          })}
        </div>
      </section>

      {/* 大字的核心卖点，上下留足空白，单独成一段 */}
      <section className="py-24">
        <TaglineReveal
          lines={h.tagline.map((line) => splitWords(c.locale, line))}
          className={`max-w-[680px] font-semibold tracking-tight ${c.locale === "zh" ? "text-4xl sm:text-5xl" : "text-4xl"}`}
        />
      </section>

      <section>
        <Reveal>
          <h2 className={sectionTitle}>{h.stepsTitle}</h2>
        </Reveal>
        <ol className="mt-8 grid gap-6 lg:grid-cols-3">
          {h.steps.map((step, i) => (
            <Reveal as="li" key={step.title} delay={i * 0.06} className="panel rounded-2xl bg-surface p-6">
              <span className="font-mono text-sm text-accent">{String(i + 1).padStart(2, "0")}</span>
              <h3 className="mt-4 text-lg font-semibold">{step.title}</h3>
              <p className="mt-2 text-muted">{step.body}</p>
            </Reveal>
          ))}
        </ol>
      </section>

      {featured.length > 0 && (
        <section className={section}>
          <Reveal className="flex items-baseline justify-between gap-4">
            <h2 className={sectionTitle}>{c.ui.featured}</h2>
            <Link href={`/${lang}/projects`} className="flex items-center gap-2 text-sm font-semibold text-muted transition-colors hover:text-accent">
              {c.ui.viewAll}
              <ArrowRight aria-hidden size={16} />
            </Link>
          </Reveal>
          <div className="mt-8 grid auto-rows-fr grid-cols-1 gap-6 sm:grid-cols-2">
            {featured.map((project, i) => (
              <Reveal key={project.slug} delay={i * 0.06}>
                <ProjectCard project={project} c={c} />
              </Reveal>
            ))}
          </div>
        </section>
      )}

      <section className={section}>
        <Reveal>
          <h2 className="text-sm font-semibold text-muted">{h.recordTitle}</h2>
        </Reveal>
        <ul className="mt-6 grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
          {h.record.map((entry, i) => (
            <Reveal as="li" key={entry.org} delay={i * 0.06}>
              <p className="text-lg font-semibold">{entry.org}</p>
              <p className="mt-1 text-sm text-muted">{entry.detail}</p>
            </Reveal>
          ))}
        </ul>
      </section>

      <section className={section}>
        <Reveal>
          <h2 className={sectionTitle}>{h.faqTitle}</h2>
        </Reveal>
        <dl className="mt-8 grid gap-x-12 gap-y-8 lg:grid-cols-2">
          {h.faq.map((item, i) => (
            <Reveal key={item.q} delay={(i % 2) * 0.06}>
              <dt className="text-lg font-semibold">{item.q}</dt>
              <dd className="mt-2 text-muted">{item.a}</dd>
            </Reveal>
          ))}
        </dl>
      </section>

      {/* 结尾再放一次同样的主按钮 */}
      <section className={section}>
        <Reveal className="panel relative overflow-hidden rounded-3xl bg-surface px-6 py-16 text-center sm:px-12">
          <HudCorners className="inset-4" />
          <h2 className="mx-auto max-w-[680px] text-3xl font-semibold tracking-tight sm:text-4xl">{h.finalTitle}</h2>
          <p className="mx-auto mt-4 max-w-[680px] text-lg text-muted">{h.finalBody}</p>
          <div className="mt-8">
            <EmailButton email={c.email} label={h.cta} />
          </div>
          <p className="mt-4 text-sm text-muted">{c.email}</p>
        </Reveal>
      </section>
    </>
  );
}

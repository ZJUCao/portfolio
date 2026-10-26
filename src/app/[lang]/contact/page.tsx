import { ArrowUpRight, GithubLogo, LinkedinLogo } from "@phosphor-icons/react/ssr";
import type { Metadata } from "next";
import { Reveal } from "@/components/Reveal";
import { contentFor } from "@/data/profile";
import { alternatesFor } from "@/i18n";

export async function generateMetadata({ params }: PageProps<"/[lang]/contact">): Promise<Metadata> {
  const { lang } = await params;
  return { title: contentFor(lang).ui.contactTitle, alternates: alternatesFor("/contact") };
}

export default async function ContactPage({ params }: PageProps<"/[lang]/contact">) {
  const { lang } = await params;
  const c = contentFor(lang);

  return (
    <>
      <Reveal>
        <h1 className="text-4xl font-semibold tracking-tight">{c.ui.contactTitle}</h1>
        <p className="mt-4 max-w-xl text-lg text-muted">{c.ui.contactIntro}</p>
      </Reveal>
      <Reveal delay={0.08}>
        <a
          href={`mailto:${c.email}`}
          className="mt-10 inline-block break-all text-2xl font-semibold tracking-tight underline decoration-accent decoration-2 underline-offset-8 transition-colors hover:text-accent sm:text-3xl"
        >
          {c.email}
        </a>
      </Reveal>
      <Reveal delay={0.16} className="mt-12 flex flex-wrap gap-3">
        {c.links.map((link) => (
          <a
            key={link.href}
            href={link.href}
            target="_blank"
            rel="noreferrer"
            className="panel inline-flex items-center gap-2 rounded-full bg-surface px-3 py-2 text-base font-semibold transition hover:bg-raised active:scale-[0.98]"
          >
            {link.label === "GitHub" ? <GithubLogo aria-hidden size={20} /> : <LinkedinLogo aria-hidden size={20} />}
            {link.label}
            <ArrowUpRight aria-hidden size={16} className="text-muted" />
          </a>
        ))}
      </Reveal>
    </>
  );
}

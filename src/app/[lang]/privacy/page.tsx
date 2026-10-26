import type { Metadata } from "next";
import { Reveal } from "@/components/Reveal";
import { contentFor } from "@/data/profile";
import { alternatesFor } from "@/i18n";

export async function generateMetadata({ params }: PageProps<"/[lang]/privacy">): Promise<Metadata> {
  const { lang } = await params;
  return { title: contentFor(lang).privacy.title, alternates: alternatesFor("/privacy") };
}

// 隐私说明，页脚链接到这里。内容在 profile.ts 的 privacy 里
export default async function PrivacyPage({ params }: PageProps<"/[lang]/privacy">) {
  const { lang } = await params;
  const c = contentFor(lang);

  return (
    <>
      <Reveal>
        <h1 className="text-4xl font-semibold tracking-tight">{c.privacy.title}</h1>
      </Reveal>
      <Reveal delay={0.08}>
        <ul className="mt-8 max-w-2xl list-disc space-y-4 pl-6 text-lg text-muted">
          {c.privacy.points.map((point) => (
            <li key={point}>{point}</li>
          ))}
        </ul>
      </Reveal>
    </>
  );
}

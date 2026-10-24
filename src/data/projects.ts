// 项目列表来自 GitHub：GitHub 上每个公开的非 fork 仓库都会自动成为一个项目，不需要改这里。
// 下面的 overrides 是可选补充，按仓库名对应，用来写中英文标题和简介、标记精选、加演示视频，
// 或隐藏某个仓库。没写的字段用 GitHub 上的信息（仓库名、About 里的 description）。

import { notFound } from "next/navigation";
import type { Locale } from "@/i18n";
import snapshot from "./github.generated.json";

// scripts/fetch-github.mjs 写出的数据格式。显式声明，避免类型随抓到的数据变化
type GithubRepo = {
  name: string;
  url: string;
  description: string | null;
  homepage: string | null;
  language: string | null;
  languages: Record<string, number>;
  topics: string[];
  stars: number;
  forks: number;
  license: string | null;
  createdAt: string;
  pushedAt: string;
  readmeHtml: string | null;
};
const github = snapshot as unknown as { user: string; fetchedAt: string; repos: GithubRepo[] };

type Localized = { title?: string; summary?: string };

type Override = {
  zh?: Localized;
  en?: Localized;
  featured?: boolean;
  hidden?: boolean;
  // 演示视频：中文页优先用 B 站，英文页优先用 YouTube，只有一个就两边都用它
  video?: { youtube?: string; bilibili?: string };
};

const overrides: Record<string, Override> = {
  "job-assistant": {
    featured: true,
    zh: {
      title: "求职助手",
      summary: "一组完全在本机运行的求职 Agent：按岗位 JD 优化简历，并从多个来源找岗位、和个人经历做匹配。个人数据不出本机，测试禁止访问外网。",
    },
    en: {
      title: "Job Assistant",
      summary:
        "A set of job-search agents that run entirely on-device: tailoring résumés to a job description, and sourcing roles from several sites to match against my experience. Personal data never leaves the machine.",
    },
  },
  portfolio: {
    zh: {
      title: "个人作品集",
      summary: "就是这个网站。Next.js 静态导出，中英双语，项目从 GitHub 自动同步，部署在 Vercel。",
    },
    en: {
      title: "Portfolio",
      summary: "This site. A bilingual Next.js static export whose projects sync automatically from GitHub, deployed on Vercel.",
    },
  },
};

// 首页「精选项目」没有手动标记时，取最近更新的几个
const FEATURED_FALLBACK = 3;

export type Project = {
  slug: string;
  title: string;
  summary: string | null;
  url: string;
  homepage: string | null;
  language: string | null;
  languages: { name: string; percent: number }[];
  topics: string[];
  stars: number;
  forks: number;
  license: string | null;
  createdAt: string;
  pushedAt: string;
  readmeHtml: string | null;
  featured: boolean;
  video: { kind: "youtube" | "bilibili"; embedUrl: string } | null;
};

function embedFor(locale: Locale, video: Override["video"]): Project["video"] {
  if (!video) return null;
  const order = locale === "zh" ? (["bilibili", "youtube"] as const) : (["youtube", "bilibili"] as const);
  for (const kind of order) {
    const url = video[kind];
    if (!url) continue;
    if (kind === "youtube") {
      const id = url.match(/(?:youtu\.be\/|v=|embed\/|shorts\/)([\w-]{11})/)?.[1];
      if (id) return { kind, embedUrl: `https://www.youtube-nocookie.com/embed/${id}` };
    } else {
      const bvid = url.match(/(BV[\w]{10})/)?.[1];
      if (bvid) return { kind, embedUrl: `https://player.bilibili.com/player.html?bvid=${bvid}&autoplay=0` };
    }
  }
  return null;
}

function toPercentages(bytes: Record<string, number>) {
  const total = Object.values(bytes).reduce((a, b) => a + b, 0) || 1;
  return Object.entries(bytes)
    .map(([name, n]) => ({ name, percent: (n / total) * 100 }))
    .sort((a, b) => b.percent - a.percent);
}

export function getProjects(locale: Locale): Project[] {
  const projects = github.repos
    .filter((repo) => !overrides[repo.name]?.hidden)
    .map((repo) => {
      const o = overrides[repo.name] ?? {};
      return {
        slug: repo.name,
        title: o[locale]?.title ?? repo.name,
        summary: o[locale]?.summary ?? repo.description,
        url: repo.url,
        homepage: repo.homepage,
        language: repo.language,
        languages: toPercentages(repo.languages),
        topics: repo.topics,
        stars: repo.stars,
        forks: repo.forks,
        license: repo.license,
        createdAt: repo.createdAt,
        pushedAt: repo.pushedAt,
        readmeHtml: repo.readmeHtml,
        featured: Boolean(o.featured),
        video: embedFor(locale, o.video),
      };
    })
    .sort((a, b) => b.pushedAt.localeCompare(a.pushedAt));

  if (!projects.some((p) => p.featured)) {
    projects.slice(0, FEATURED_FALLBACK).forEach((p) => (p.featured = true));
  }
  return projects;
}

export function getProject(locale: Locale, slug: string) {
  const projects = getProjects(locale);
  const index = projects.findIndex((p) => p.slug === slug);
  if (index === -1) notFound();
  return { project: projects[index], prev: projects[index - 1] ?? null, next: projects[index + 1] ?? null };
}

export const projectSlugs = () => getProjects("en").map((p) => p.slug);

// 构建时把日期格式化成「2026年10月」/「Oct 2026」
export const formatMonth = (locale: Locale, iso: string) =>
  new Intl.DateTimeFormat(locale === "zh" ? "zh-CN" : "en-US", { year: "numeric", month: "short" }).format(new Date(iso));

// 项目列表来自 GitHub：GitHub 上每个公开的非 fork 仓库都会自动成为一个项目，不需要改这里。
// 下面的 overrides 是可选补充，按仓库名对应，用来写中英文标题和简介、指定分类、标记精选、加演示视频，
// 或隐藏某个仓库。没写的字段用 GitHub 上的信息（仓库名、About 里的 description、README）。

import { notFound } from "next/navigation";
import type { Locale } from "@/i18n";
import snapshot from "./github.generated.json";

// scripts/fetch-github.mjs 写出的数据格式。显式声明，避免类型随抓到的数据变化
type GithubReadme = {
  path: string;
  lang: Locale | null; // 判断不出语言时为 null
  html: string;
  lead: string | null; // 开头第一段正文
};
type GithubRepo = {
  name: string;
  url: string;
  defaultBranch: string;
  description: string | null;
  descriptionLang: Locale | null;
  homepage: string | null;
  language: string | null;
  languages: Record<string, number>;
  topics: string[];
  stars: number;
  forks: number;
  license: string | null;
  createdAt: string;
  pushedAt: string;
  readmes: GithubReadme[]; // 第一个是 GitHub 默认显示的 README，后面是其他语言的版本
};
const github = snapshot as unknown as { user: string; fetchedAt: string; repos: GithubRepo[] };

// 项目分类，按这里的顺序显示在项目页的筛选栏里，没有项目的分类不显示。
// 仓库归哪一类：overrides 里写了 category 就用它；否则看仓库在 GitHub 上的 topics，
// 归到第一个 topics 对得上的分类；都对不上归到「其他」。
// 所以新仓库在 GitHub 上加个 topic（如 opengl、computer-vision）就能自动归类，不用改这里。
const categories = {
  graphics: {
    zh: "图形与引擎",
    en: "Graphics & Engines",
    topics: [
      "computer-graphics", "graphics", "rendering", "renderer", "ray-tracing", "raytracing", "path-tracing", "rasterizer",
      "opengl", "webgl", "vulkan", "directx", "glsl", "hlsl", "shader", "shaders", "game-engine", "game-development",
      "gamedev", "game", "ecs", "physics-engine", "collision-detection", "unity", "unreal-engine",
    ],
  },
  vision: {
    zh: "计算机视觉",
    en: "Computer Vision",
    topics: [
      "computer-vision", "opencv", "image-processing", "object-detection", "image-classification", "image-segmentation",
      "yolo", "detr", "camera-calibration", "pattern-recognition",
    ],
  },
  ai: {
    zh: "AI 应用",
    en: "Applied AI",
    topics: [
      "ai", "artificial-intelligence", "llm", "llms", "agent", "agents", "ai-agent", "ai-agents", "machine-learning",
      "deep-learning", "nlp", "rag", "ollama", "chatbot",
    ],
  },
  systems: {
    zh: "系统",
    en: "Systems",
    topics: [
      "systems", "distributed-systems", "operating-system", "kernel", "embedded", "embedded-systems", "rtos", "freertos",
      "linux", "networking", "compiler", "database", "middleware", "concurrency",
    ],
  },
  web: {
    zh: "Web",
    en: "Web",
    topics: [
      "web", "website", "web-app", "webapp", "frontend", "backend", "fullstack", "full-stack", "nextjs", "react", "vue",
      "nodejs", "express", "saas", "portfolio",
    ],
  },
  other: { zh: "其他", en: "Other", topics: [] },
} satisfies Record<string, Record<Locale, string> & { topics: string[] }>;

export type CategoryId = keyof typeof categories;
const categoryIds = Object.keys(categories) as CategoryId[];

type Localized = { title?: string; summary?: string };

type Override = {
  zh?: Localized;
  en?: Localized;
  category?: CategoryId;
  featured?: boolean;
  hidden?: boolean;
  // 演示视频：中文页优先用 B 站，英文页优先用 YouTube，只有一个就两边都用它
  video?: { youtube?: string; bilibili?: string };
};

const overrides: Record<string, Override> = {
  "job-assistant": {
    featured: true,
    category: "ai",
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
    category: "web",
    zh: {
      title: "个人作品集",
      summary: "就是这个网站。Next.js 静态导出，中英双语，项目从 GitHub 自动同步，部署在 Vercel。",
    },
    en: {
      title: "Portfolio",
      summary: "This site. A bilingual Next.js static export whose projects sync automatically from GitHub, deployed on Vercel.",
    },
  },
  "SceneGraph-Ray-Tracer": { category: "graphics" },
  "SceneGraph-Renderer": { category: "graphics" },
};

// 首页「精选项目」没有手动标记时，取最近更新的几个
const FEATURED_FALLBACK = 3;

export type Project = {
  slug: string;
  title: string;
  category: { id: CategoryId; label: string };
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
  readme: { html: string; lang: Locale | null } | null;
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

const categoryOf = (repo: GithubRepo, o: Override): CategoryId =>
  o.category ?? categoryIds.find((id) => categories[id].topics.some((t) => repo.topics.includes(t))) ?? "other";

// 同一内容有几种语言的版本时，优先取页面语言的，没有就取排在第一个的
const preferLocale = <T extends { lang: Locale | null }>(locale: Locale, items: T[]) =>
  items.find((item) => item.lang === locale) ?? items[0] ?? null;

// README 开头常有切换语言的链接（如「English | 简体中文」），指向仓库里另一种语言的 README。
// 在网站上改成指向本站对应语言的项目页，不跳去 GitHub
const linkReadmes = (html: string, repo: GithubRepo) =>
  repo.readmes.reduce(
    (out, r) =>
      r.lang
        ? out.replaceAll(`href="${repo.url}/blob/${repo.defaultBranch}/${r.path}"`, `href="/${r.lang}/projects/${repo.name}"`)
        : out,
    html,
  );

export function getProjects(locale: Locale): Project[] {
  const projects = github.repos
    .filter((repo) => !overrides[repo.name]?.hidden)
    .map((repo) => {
      const o = overrides[repo.name] ?? {};
      const category = categoryOf(repo, o);
      // 项目介绍：overrides 里写了就用；否则从 GitHub 简介和各语言 README 的第一段里挑页面语言的，
      // 都不是页面语言时用 GitHub 简介
      const intro = preferLocale(
        locale,
        [
          { lang: repo.descriptionLang, text: repo.description },
          ...repo.readmes.map((r) => ({ lang: r.lang, text: r.lead })),
        ].filter((i) => i.text),
      );
      const readme = preferLocale(locale, repo.readmes);
      return {
        slug: repo.name,
        title: o[locale]?.title ?? repo.name,
        category: { id: category, label: categories[category][locale] },
        summary: o[locale]?.summary ?? intro?.text ?? null,
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
        readme: readme && { html: linkReadmes(readme.html, repo), lang: readme.lang },
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

// 项目页筛选栏列出的分类：按上面定义的顺序，只列有项目的，带项目数
export const categoriesOf = (locale: Locale, projects: Project[]) =>
  categoryIds
    .map((id) => ({ id, label: categories[id][locale], count: projects.filter((p) => p.category.id === id).length }))
    .filter((c) => c.count > 0);

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

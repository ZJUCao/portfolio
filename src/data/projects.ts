// 项目列表来自 GitHub：GitHub 上每个公开的非 fork 仓库都会自动成为一个项目，不需要改这里。
// 下面的 overrides 是可选补充，按仓库名对应，用来写中英文标题和简介、指定分类、标记精选、加演示视频，
// 或隐藏某个仓库。没写的字段用 GitHub 上的信息（仓库名、About 里的 description、README）。

import { notFound } from "next/navigation";
import type { Locale } from "@/i18n";
import snapshot from "./github.generated.json";
import { stackGroupsOf, stackOf, type SkillGroupId } from "./skills";

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
  dependencies: string[]; // 依赖声明文件、第三方库目录等处收集到的库和工具名，小写
  topics: string[];
  stars: number;
  forks: number;
  license: string | null;
  createdAt: string;
  pushedAt: string;
  readmes: GithubReadme[]; // 第一个是 GitHub 默认显示的 README，后面是其他语言的版本
};
const github = snapshot as unknown as { user: string; fetchedAt: string; repos: GithubRepo[] };

// 项目分类，按 XR 的技术栈来分，按这里的顺序显示在项目页的筛选栏里，没有项目的分类不显示。
// 仓库归哪一类，依次看：
//   1. overrides 里写的 category；
//   2. 仓库在 GitHub 上的 topics：归到第一个 topics 对得上的分类；
//   3. 项目本身：归到第一个对得上的分类——识别出的技术栈里有 groups 所列分组的技术（见 skills.ts），
//      或者仓库名、GitHub 简介、README 第一段里出现 keywords 里的词；
//   4. 都对不上归到「其他」。
// 排在前面的分类优先：XR 项目常常也用 OpenGL 和 OpenCV，自研引擎和视觉项目也常用 OpenGL 画画面，
// 所以 XR 排最前，渲染靠后。新仓库一般不用改这里就能自动归类；归错了就在 GitHub 上给它加个 topic
// （如 augmented-reality、game-engine），或者在 overrides 里写 category。
type Category = Record<Locale, string> & { topics: string[]; groups?: SkillGroupId[]; keywords?: string[] };

const categories = {
  xr: {
    zh: "XR 与空间计算",
    en: "XR & spatial computing",
    topics: [
      "xr", "ar", "vr", "augmented-reality", "virtual-reality", "mixed-reality", "extended-reality", "spatial-computing",
      "openxr", "webxr", "arkit", "arcore", "arfoundation", "realitykit", "visionos", "vision-pro", "oculus", "meta-quest",
      "oculus-quest", "hololens", "mrtk", "vuforia", "steamvr",
    ],
    groups: ["xr"],
    // 用 OpenCV + OpenGL 自己实现的 AR 从技术栈看不出来，所以还看这些词
    keywords: [
      "ar", "vr", "xr", "webxr", "openxr", "augmented reality", "virtual reality", "mixed reality", "extended reality",
      "spatial computing", "vision pro", "meta quest", "oculus", "hololens", "增强现实", "虚拟现实", "混合现实", "扩展现实",
      "空间计算",
    ],
  },
  engines: {
    zh: "引擎与交互",
    en: "Engines & interaction",
    topics: [
      "game-engine", "game-development", "gamedev", "game", "games", "ecs", "entity-component-system", "physics-engine",
      "physics", "collision-detection", "unity", "unity3d", "unreal-engine", "unreal", "godot",
    ],
    groups: ["engines"],
  },
  perception: {
    zh: "视觉与感知",
    en: "Vision & perception",
    topics: [
      "computer-vision", "opencv", "image-processing", "object-detection", "image-classification", "image-segmentation",
      "pose-estimation", "slam", "visual-slam", "hand-tracking", "point-cloud", "camera-calibration", "yolo", "detr",
      "mediapipe", "pattern-recognition",
    ],
    groups: ["perception"],
  },
  rendering: {
    zh: "图形渲染",
    en: "Rendering",
    topics: [
      "computer-graphics", "graphics", "rendering", "renderer", "real-time-rendering", "ray-tracing", "raytracing",
      "path-tracing", "rasterizer", "pbr", "opengl", "webgl", "webgpu", "vulkan", "metal", "directx", "glsl", "hlsl",
      "shader", "shaders", "threejs",
    ],
    groups: ["rendering"],
  },
  tools: {
    zh: "AI 与工具",
    en: "AI & tools",
    topics: [
      "ai", "artificial-intelligence", "llm", "llms", "agent", "agents", "ai-agent", "ai-agents", "machine-learning",
      "deep-learning", "nlp", "rag", "ollama", "chatbot", "web", "website", "web-app", "webapp", "frontend", "backend",
      "fullstack", "full-stack", "nextjs", "react", "vue", "nodejs", "saas", "portfolio", "cli", "developer-tools",
      "automation",
    ],
    groups: ["ai", "web"],
  },
  other: { zh: "其他", en: "Other", topics: [] },
} satisfies Record<string, Category>;

export type CategoryId = keyof typeof categories;
const categoryIds = Object.keys(categories) as CategoryId[];

type Localized = { title?: string; summary?: string };

type Override = {
  zh?: Localized;
  en?: Localized;
  category?: CategoryId;
  // 首页精选：true 一定上精选；false 不上，也不会被自动补上；不写时可能被自动补上，见 FEATURED_COUNT
  featured?: boolean;
  hidden?: boolean;
  // 演示视频：中文页优先用 B 站，英文页优先用 YouTube，只有一个就两边都用它
  video?: { youtube?: string; bilibili?: string };
  // 卡片封面图的地址。不写时用 README 里的图：文件名带 cover、banner 或 hero 的优先，否则第一张；
  // README 里没有图时，卡片上按分类画一幅线稿。左右并排的对比图在卡片上只显示右边那张，见 CoverImage
  cover?: string;
};

const overrides: Record<string, Override> = {
  NutriScan: {
    en: {
      summary:
        "Recognizes 256 dishes from a webcam with YOLOv8 and overlays calories, protein, carbs and fat from an offline nutrition database.",
    },
  },
  "SceneGraph-AR": {
    zh: { title: "SceneGraph AR" },
    en: {
      title: "SceneGraph AR",
      summary: "Calibrates a camera with OpenCV, then renders a lit scene graph that stays aligned with a printed checkerboard.",
    },
  },
  "SceneGraph-Renderer": {
    zh: { title: "SceneGraph Renderer" },
    en: {
      title: "SceneGraph Renderer",
      summary:
        "An OpenGL 3.3 scene graph renderer that runs in real time, with multiple lights, toon shading, keyframe animation and four camera modes.",
    },
  },
  "SceneGraph-Ray-Tracer": {
    zh: { title: "SceneGraph Ray Tracer" },
    en: {
      title: "SceneGraph Ray Tracer",
      summary:
        "A CPU ray tracer for scene graphs with shadows, reflection and refraction; a KD tree per mesh makes renders up to 150× faster.",
    },
  },
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
    featured: false, // 访客正在看的就是它，不必再放进精选
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

// 首页「精选项目」至少放几个：overrides 里标了 featured: true 的都放，不够这个数时
// 用最新发布（按仓库创建时间）、又没标 featured: false 的项目补齐。首页一行两个，取偶数排得整齐
const FEATURED_COUNT = 4;

export type Project = {
  slug: string;
  title: string;
  category: { id: CategoryId; label: string };
  summary: string | null;
  url: string;
  homepage: string | null;
  language: string | null;
  languages: { name: string; percent: number }[];
  stack: string[]; // 识别出的技术栈，见 skills.ts
  topics: string[];
  stars: number;
  forks: number;
  license: string | null;
  createdAt: string;
  pushedAt: string;
  readme: { html: string; lang: Locale | null } | null;
  cover: string | null; // 卡片封面图，见 Override.cover
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

// 找关键词用的文字：小写，单词之间隔一个空格，驼峰写法也拆开（SceneGraph-AR → scene graph ar，ARKit → ar kit）
const wordsOf = (text: string) =>
  ` ${text
    .replace(/([a-z\d])([A-Z])/g, "$1 $2")
    .replace(/([A-Z])([A-Z][a-z])/g, "$1 $2")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()} `;

// 英文要整词对上（ar 不算 car 里的 ar），中文直接找
const mentions = (words: string, keyword: string) =>
  words.includes(/\p{Script=Han}/u.test(keyword) ? keyword : wordsOf(keyword));

// 规则见上面的 categories。stackGroups 是项目用到的技术所属的分组
function categoryOf(repo: GithubRepo, o: Override, stackGroups: Set<SkillGroupId>): CategoryId {
  if (o.category) return o.category;
  const byTopic = categoryIds.find((id) => categories[id].topics.some((t) => repo.topics.includes(t)));
  if (byTopic) return byTopic;
  const words = wordsOf([repo.name, repo.description, ...repo.readmes.map((r) => r.lead)].join(" "));
  return (
    categoryIds.find((id) => {
      const c: Category = categories[id];
      return c.groups?.some((g) => stackGroups.has(g)) || c.keywords?.some((k) => mentions(words, k));
    }) ?? "other"
  );
}

// README 里可以当封面的图：跳过 shields.io 一类的徽章，文件名带 cover、banner 或 hero 的排前面
function coverOf(html: string) {
  const images = [...html.matchAll(/<img\b[^>]*?\bsrc="([^"]+)"/gi)]
    .map((m) => m[1].replaceAll("&amp;", "&"))
    .filter((src) => !/shields\.io|badgen\.net|badge\.fury\.io|\/badge\.svg/i.test(src));
  return images.find((src) => /(cover|banner|hero)[^/]*$/i.test(src)) ?? images[0] ?? null;
}

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
      const signals = [...Object.keys(repo.languages), ...repo.topics, ...repo.dependencies];
      const category = categoryOf(repo, o, stackGroupsOf(signals));
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
        stack: stackOf(locale, signals),
        topics: repo.topics,
        stars: repo.stars,
        forks: repo.forks,
        license: repo.license,
        createdAt: repo.createdAt,
        pushedAt: repo.pushedAt,
        readme: readme && { html: linkReadmes(readme.html, repo), lang: readme.lang },
        cover: o.cover ?? (readme && coverOf(readme.html)),
        featured: Boolean(o.featured),
        video: embedFor(locale, o.video),
      };
    })
    .sort((a, b) => b.pushedAt.localeCompare(a.pushedAt));

  const missing = FEATURED_COUNT - projects.filter((p) => p.featured).length;
  projects
    .filter((p) => !p.featured && overrides[p.slug]?.featured !== false)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, Math.max(0, missing))
    .forEach((p) => (p.featured = true));
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

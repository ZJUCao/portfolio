// 构建前从 GitHub 拉取公开仓库，写入 src/data/github.generated.json，页面在构建时读取它。
// 只在这里请求一次：Next 用多个 worker 并行生成页面，若每个页面各自请求 GitHub，
// 很快会用完未登录时每小时 60 次的额度。
//
// 环境变量：
//   GITHUB_TOKEN  可选，只读 token，可把额度提高到每小时 5000 次（Vercel 上建议配置）
//   GITHUB_USER   可选，默认 ZJUCao
//
// 本地拉取失败时沿用上次的数据继续开发；CI / Vercel 上拉取失败则让构建失败，
// 这样线上会继续保留上一次成功部署的版本，而不是变成一个没有项目的网站。

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const USER = process.env.GITHUB_USER || "ZJUCao";
const OUT = join(dirname(fileURLToPath(import.meta.url)), "../src/data/github.generated.json");
const API = "https://api.github.com";
const HTML = "application/vnd.github.html+json";
// 快照的数据格式改动时加 1。本地拉取失败时只沿用同一格式的旧快照，格式不同页面代码读不了
const FORMAT = 2;

const headers = {
  "User-Agent": `${USER}-portfolio`,
  "X-GitHub-Api-Version": "2022-11-28",
  ...(process.env.GITHUB_TOKEN ? { Authorization: `Bearer ${process.env.GITHUB_TOKEN}` } : {}),
};

async function get(path, accept = "application/vnd.github+json") {
  const res = await fetch(`${API}${path}`, { headers: { ...headers, Accept: accept } });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`GitHub ${path} → ${res.status} ${await res.text()}`);
  return accept.includes("html") ? res.text() : res.json();
}

// README 里的相对链接在 GitHub 上由前端补全，搬到这里要换成绝对地址：
// 图片指向原始文件，其他链接指向仓库里的文件页，页内锚点对应 GitHub 生成的 user-content- 前缀 id。
function absolutize(html, repo) {
  const blob = `https://github.com/${repo.full_name}/blob/${repo.default_branch}/`;
  const raw = `https://raw.githubusercontent.com/${repo.full_name}/${repo.default_branch}/`;
  const isAbsolute = (url) => /^([a-z][a-z0-9+.-]*:|\/\/)/i.test(url);
  const strip = (url) => url.replace(/^\.?\//, "");
  return html
    .replace(/(<(?:img|video|source)\b[^>]*?\bsrc=")([^"]+)"/gi, (m, pre, url) =>
      isAbsolute(url) ? m : `${pre}${raw}${strip(url)}"`,
    )
    .replace(/(<a\b[^>]*?\bhref=")([^"]+)"/gi, (m, pre, url) => {
      if (url.startsWith("#")) return url.startsWith("#user-content-") ? m : `${pre}#user-content-${url.slice(1)}"`;
      return isAbsolute(url) ? m : `${pre}${blob}${strip(url)}"`;
    });
}

// Markdown 源文件里中文句子中间换了行，浏览器会把换行显示成一个空格。这种换行直接去掉，代码块里的不动
const CJK_LINE_BREAK = /(?<=[\p{Script=Han}\u3000-\u303f\uff00-\uffef])\s*\n\s*(?=[\p{Script=Han}\u3000-\u303f\uff00-\uffef])/gu;
const joinCjkLines = (html) =>
  html
    .split(/(<pre\b[\s\S]*?<\/pre>)/i)
    .map((part, i) => (i % 2 ? part : part.replace(CJK_LINE_BREAK, "")))
    .join("");

const ENTITIES = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };

// GitHub 渲染出的 HTML 片段转成纯文本
const textOf = (html) =>
  html
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/<[^>]+>/g, "")
    .replace(/&(?:#(\d+)|#x([\da-f]+)|(\w+));/gi, (m, dec, hex, name) =>
      dec ? String.fromCodePoint(Number(dec)) : hex ? String.fromCodePoint(parseInt(hex, 16)) : (ENTITIES[name] ?? m),
    )
    .replace(/\s+/g, " ")
    .trim();

const hanCount = (text) => text.match(/\p{Script=Han}/gu)?.length ?? 0;
// 显示宽度：一个汉字大约占两个英文字母的宽度
const widthOf = (text) => text.length + hanCount(text);

// 粗略判断一段文字是中文还是英文：汉字比英文单词多就算中文
function langOf(text) {
  if (!text) return null;
  const han = hanCount(text);
  const words = text.match(/[a-z]+/gi)?.length ?? 0;
  return han + words === 0 ? null : han >= words ? "zh" : "en";
}

// 截到 maxWidth 宽度以内：尽量停在句末；没有句末就停在词间（英文），再不行硬截断，后两种加省略号
function clip(text, maxWidth) {
  if (widthOf(text) <= maxWidth) return text;
  let head = "";
  for (const ch of text) {
    if (widthOf(head + ch) >= maxWidth) break;
    head += ch;
  }
  const end = Math.max(...["。", "！", "？", ". ", "! ", "? "].map((p) => head.lastIndexOf(p)));
  if (end >= 20) return head.slice(0, end + 1);
  const space = head.lastIndexOf(" ");
  return `${(space >= 20 ? head.slice(0, space) : head).trimEnd()}…`;
}

// README 开头的第一段正文，仓库没有简介时用作项目介绍。跳过 Logo、徽章、语言切换链接
// 这类除了链接几乎没有文字的段落，也不取引用、提示框、折叠块、列表和表格里的段落
function leadOf(html) {
  const body = html.replace(/<(blockquote|details|table|ul|ol)\b[\s\S]*?<\/\1>|<div class="markdown-alert[\s\S]*?<\/div>/gi, "");
  for (const [, inner] of body.matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/gi)) {
    if (widthOf(textOf(inner.replace(/<a\b[\s\S]*?<\/a>/gi, ""))) >= 24) return clip(textOf(inner), 240);
  }
  return null;
}

// 网站有中英文两版，README 也按页面语言挑。其他语言版本的 README 和默认 README 一样放在仓库根目录，
// 文件名带语言后缀，如 README.zh-CN.md、README_CN.md、README.en.md；网站只用得上中文和英文
const README_LANGS = {
  zh: "zh", "zh-cn": "zh", "zh-hans": "zh", cn: "zh", chs: "zh", chinese: "zh", 中文: "zh", 简体中文: "zh",
  en: "en", "en-us": "en", "en-gb": "en", english: "en",
};
const readmeLangOf = (path) => {
  const suffix = path.split("/").pop().match(/^readme[._-](.+)\.(?:md|markdown|rst|adoc|org|txt)$/i)?.[1];
  return (suffix && README_LANGS[suffix.toLowerCase().replaceAll("_", "-")]) || null;
};

// 返回仓库的各语言 README：GitHub 默认显示的那份排第一，后面是根目录里其他语言的版本。
// 默认 README（如 README.md）的语言看内容判断，其他版本看文件名
async function fetchReadmes(repo) {
  const [readme, root] = await Promise.all([
    get(`/repos/${repo.full_name}/readme`, HTML),
    get(`/repos/${repo.full_name}/contents/`),
  ]);
  const defaultPath = readme?.match(/data-path="([^"]+)"/)?.[1] ?? "README.md";
  const variants = (root ?? []).filter((f) => f.type === "file" && f.path !== defaultPath && readmeLangOf(f.path));
  const files = [
    ...(readme ? [{ path: defaultPath, html: readme }] : []),
    ...(await Promise.all(
      variants.map(async (f) => ({
        path: f.path,
        html: await get(`/repos/${repo.full_name}/contents/${encodeURIComponent(f.path)}`, HTML),
      })),
    )),
  ];
  return files
    .filter((f) => f.html)
    .map((f) => {
      const html = joinCjkLines(f.html);
      return {
        path: f.path,
        lang: readmeLangOf(f.path) ?? langOf(textOf(html.replace(/<(pre|code)\b[\s\S]*?<\/\1>/gi, " "))),
        html: absolutize(html, repo),
        lead: leadOf(html),
      };
    });
}

async function fetchRepos() {
  const repos = await get(`/users/${USER}/repos?per_page=100&type=owner&sort=pushed`);
  if (!repos) throw new Error(`GitHub user ${USER} not found`);

  // 只展示自己的公开仓库：排除 fork、已归档仓库和个人主页仓库（与用户名同名）
  const visible = repos.filter(
    (r) => !r.private && !r.fork && !r.archived && r.name.toLowerCase() !== USER.toLowerCase(),
  );

  return Promise.all(
    visible.map(async (r) => {
      const [languages, readmes] = await Promise.all([get(`/repos/${r.full_name}/languages`), fetchReadmes(r)]);
      return {
        name: r.name,
        url: r.html_url,
        defaultBranch: r.default_branch,
        description: r.description,
        descriptionLang: langOf(r.description),
        homepage: r.homepage || null,
        language: r.language,
        languages: languages ?? {},
        topics: r.topics ?? [],
        stars: r.stargazers_count,
        forks: r.forks_count,
        license: r.license?.spdx_id && r.license.spdx_id !== "NOASSERTION" ? r.license.spdx_id : null,
        createdAt: r.created_at,
        pushedAt: r.pushed_at,
        readmes,
      };
    }),
  );
}

try {
  const repos = await fetchRepos();
  await mkdir(dirname(OUT), { recursive: true });
  const snapshot = { format: FORMAT, user: USER, fetchedAt: new Date().toISOString(), repos };
  await writeFile(OUT, JSON.stringify(snapshot, null, 2) + "\n");
  console.log(`✓ Fetched ${repos.length} public repos of ${USER} from GitHub`);
} catch (err) {
  const inCI = Boolean(process.env.CI || process.env.VERCEL);
  const reusable = await readFile(OUT, "utf8")
    .then((text) => JSON.parse(text).format === FORMAT)
    .catch(() => false);
  if (inCI || !reusable) {
    console.error(`✗ Could not fetch GitHub repos: ${err.message}`);
    process.exit(1);
  }
  console.warn(`! Could not fetch GitHub repos, reusing the last snapshot: ${err.message}`);
}

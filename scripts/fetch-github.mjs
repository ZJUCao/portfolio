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

import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const USER = process.env.GITHUB_USER || "ZJUCao";
const OUT = join(dirname(fileURLToPath(import.meta.url)), "../src/data/github.generated.json");
const API = "https://api.github.com";

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

async function fetchRepos() {
  const repos = await get(`/users/${USER}/repos?per_page=100&type=owner&sort=pushed`);
  if (!repos) throw new Error(`GitHub user ${USER} not found`);

  // 只展示自己的公开仓库：排除 fork、已归档仓库和个人主页仓库（与用户名同名）
  const visible = repos.filter(
    (r) => !r.private && !r.fork && !r.archived && r.name.toLowerCase() !== USER.toLowerCase(),
  );

  return Promise.all(
    visible.map(async (r) => {
      const [languages, readme] = await Promise.all([
        get(`/repos/${r.full_name}/languages`),
        get(`/repos/${r.full_name}/readme`, "application/vnd.github.html+json"),
      ]);
      return {
        name: r.name,
        url: r.html_url,
        description: r.description,
        homepage: r.homepage || null,
        language: r.language,
        languages: languages ?? {},
        topics: r.topics ?? [],
        stars: r.stargazers_count,
        forks: r.forks_count,
        license: r.license?.spdx_id && r.license.spdx_id !== "NOASSERTION" ? r.license.spdx_id : null,
        createdAt: r.created_at,
        pushedAt: r.pushed_at,
        readmeHtml: readme ? absolutize(readme, r) : null,
      };
    }),
  );
}

try {
  const repos = await fetchRepos();
  await mkdir(dirname(OUT), { recursive: true });
  await writeFile(OUT, JSON.stringify({ user: USER, fetchedAt: new Date().toISOString(), repos }, null, 2) + "\n");
  console.log(`✓ Fetched ${repos.length} public repos of ${USER} from GitHub`);
} catch (err) {
  const inCI = Boolean(process.env.CI || process.env.VERCEL);
  if (inCI || !existsSync(OUT)) {
    console.error(`✗ Could not fetch GitHub repos: ${err.message}`);
    process.exit(1);
  }
  console.warn(`! Could not fetch GitHub repos, reusing the last snapshot: ${err.message}`);
}

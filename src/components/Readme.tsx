"use client";

import type { Mermaid, MermaidConfig } from "mermaid";
import { useEffect, useRef } from "react";

// 每次画图都换一个新 id：重画时新旧两张图同时在页面上，mermaid 靠 id 找临时元素、限定 SVG 里样式的范围
let diagramCount = 0;

// 项目详情页的 README 正文。Mermaid 代码块 GitHub 只给原始代码（github.com 在浏览器里才画图），
// 这里挂载后发现有代码块才加载 mermaid，换成 SVG；没有 JS 或画图失败时原始代码照常显示
export function Readme({ html, lang, className }: { html: string; lang?: string; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const root = ref.current;
    if (!root) return;
    // GitHub 把代码块包在 section[data-type="mermaid"] 里，还附带一个加载动画，整块换成图
    const blocks = Array.from(root.querySelectorAll('pre[lang="mermaid"]'), (pre) => ({
      source: pre.textContent ?? "",
      el: pre.closest('[data-type="mermaid"]') ?? pre,
    }));
    if (blocks.length === 0) return;

    const dark = matchMedia("(prefers-color-scheme: dark)");
    let cancelled = false;
    const draw = async () => {
      const { default: mermaid } = await import("mermaid");
      // 等网页字体加载完再量文字，不然字体换掉后标签会撑出节点
      await document.fonts.ready;
      if (cancelled) return;
      mermaid.initialize(mermaidConfig(root, dark.matches));
      for (const block of blocks) {
        if (cancelled) return;
        try {
          block.el = await replaceWithDiagram(mermaid, block.source, block.el);
        } catch (error) {
          console.warn("Could not render a Mermaid diagram, keeping it as is:", error);
        }
      }
    };

    // 系统切换深浅色时按新颜色重画，排在上一轮后面；mermaid 加载失败（比如断网）时原始代码留着
    const report = (error: unknown) => console.warn("Could not load Mermaid:", error);
    let drawing = draw().catch(report);
    const redraw = () => {
      drawing = drawing.then(draw).catch(report);
    };
    dark.addEventListener("change", redraw);
    return () => {
      cancelled = true;
      dark.removeEventListener("change", redraw);
    };
  }, [html]);

  // README 是 GitHub 渲染并清理过的 HTML，只来自本人的公开仓库
  return <div ref={ref} lang={lang} className={className} dangerouslySetInnerHTML={{ __html: html }} />;
}

// 在 el 旁边画好图再把 el 换掉，画不出来就抛错、el 原样留着。画的时候容器不占位置也不显示，
// 但仍在 .readme 里，量出来的文字尺寸和最终显示时一致
async function replaceWithDiagram(mermaid: Mermaid, source: string, el: Element) {
  const container = document.createElement("div");
  container.className = "mermaid-diagram not-prose";
  container.dataset.drawing = "";
  el.after(container);
  try {
    const { svg, bindFunctions } = await mermaid.render(`readme-mermaid-${++diagramCount}`, source, container);
    container.innerHTML = svg;
    bindFunctions?.(container);
    // 图会缩到和正文一样宽，但最多缩到原来的 0.7 倍，再宽就横向滚动，免得字小得看不清
    const svgEl = container.querySelector("svg");
    const width = svgEl?.viewBox.baseVal?.width;
    if (svgEl && width) svgEl.style.minWidth = `${Math.round(width * 0.7)}px`;
    delete container.dataset.drawing;
    el.replaceWith(container);
    return container;
  } catch (error) {
    container.remove();
    throw error;
  }
}

// mermaid 把颜色直接写进 SVG，所以按当前主题读出站点的 CSS 变量交给它
function mermaidConfig(root: HTMLElement, dark: boolean): MermaidConfig {
  const style = getComputedStyle(root);
  const color = (name: string) => style.getPropertyValue(name).trim();
  return {
    startOnLoad: false,
    // 画不出来时别往页面里插 mermaid 自带的报错图
    suppressErrorRendering: true,
    // v12 默认的 ELK 布局要多下载约 1.4 MB，原来默认的 dagre 画这些图足够了
    layout: "dagre",
    // v12 各类图默认用带阴影和渐变描边的 neo 外观，这里要平的
    look: "classic",
    // v12 节点文字超过 120px 就折行；README 里的标签已经用 <br/> 分好行，放宽回 v11 的 200px
    flowchart: { wrappingWidth: 200 },
    theme: "base",
    fontFamily: style.fontFamily,
    themeVariables: {
      darkMode: dark,
      background: color("--surface"),
      primaryColor: color("--background"),
      primaryBorderColor: color("--line"),
      primaryTextColor: color("--foreground"),
      secondaryColor: color("--background"),
      tertiaryColor: color("--surface"),
      lineColor: color("--muted"),
      textColor: color("--foreground"),
      edgeLabelBackground: color("--surface"),
    },
  };
}

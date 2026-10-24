// GitHub（linguist）给常见语言用的颜色，其他语言显示为灰色
const COLORS: Record<string, string> = {
  "C++": "#f34b7d",
  C: "#555555",
  "C#": "#178600",
  Python: "#3572A5",
  TypeScript: "#3178c6",
  JavaScript: "#f1e05a",
  Java: "#b07219",
  Lua: "#000080",
  GLSL: "#5686a5",
  HLSL: "#aace60",
  Rust: "#dea584",
  Go: "#00ADD8",
  CSS: "#663399",
  HTML: "#e34c26",
  Shell: "#89e051",
  CMake: "#DA3434",
  Jupyter: "#DA5B0B",
  "Jupyter Notebook": "#DA5B0B",
  Dockerfile: "#384d54",
  Jinja: "#a52a22",
};

export const languageColor = (name: string) => COLORS[name] ?? "#8b8b8b";

export function LanguageDot({ name }: { name: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: languageColor(name) }} />
      {name}
    </span>
  );
}

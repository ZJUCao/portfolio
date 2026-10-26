import type { CategoryId } from "@/data/projects";

// 没有截图的项目卡片用的封面：一块透视网格地面，上面按分类画一幅线稿，颜色跟着卡片的 --tint。
// 坐标都在 320×200 的画布里

// 地面网格：横线越近越疏，竖线汇向远处的消失点。首页 3D 画面加载前的底图也用它
const VANISH = { x: 160, y: 95 };
const HORIZON = 125;
export const floorPath = [
  ...[125, 133, 145, 162, 186].map((y) => `M0 ${y}H320`),
  ...Array.from({ length: 13 }, (_, k) => {
    const x = VANISH.x + (k - 6) * 64;
    const t = (HORIZON - VANISH.y) / (200 - VANISH.y);
    return `M${VANISH.x + (x - VANISH.x) * t} ${HORIZON}L${x} 200`;
  }),
].join("");

const art: Record<CategoryId, React.ReactNode> = {
  // 悬浮的线框立方体，用虚线锚定到地面上
  xr: (
    <>
      <path d="M140 50h40v40h-40zM154 38h40v40h-40zM140 50l14-12M180 50l14-12M180 90l14-12M140 90l14-12" />
      <path d="M167 96v52" strokeDasharray="3 4" />
      <ellipse cx="167" cy="152" rx="30" ry="7" />
      <path d="M120 30h-8v8M214 30h8v8M120 108h-8v-8M214 108h8v-8" opacity="0.6" />
    </>
  ),
  // 两个检测框和置信度标签
  perception: (
    <>
      <rect x="92" y="52" width="74" height="58" />
      <rect x="92" y="41" width="50" height="11" fill="var(--tint)" fillOpacity="0.2" />
      <rect x="184" y="70" width="52" height="44" />
      <rect x="184" y="59" width="50" height="11" fill="var(--tint)" fillOpacity="0.2" />
      <g fill="var(--tint)" stroke="none" fontSize="7" fontFamily="var(--font-mono)">
        <text x="96" y="49">obj 0.94</text>
        <text x="188" y="67">obj 0.81</text>
      </g>
    </>
  ),
  // 线框球和一盏点光源
  rendering: (
    <>
      <circle cx="160" cy="74" r="38" />
      <ellipse cx="160" cy="74" rx="38" ry="11" />
      <ellipse cx="160" cy="56" rx="33" ry="8" opacity="0.7" />
      <ellipse cx="160" cy="92" rx="33" ry="8" opacity="0.7" />
      <ellipse cx="160" cy="74" rx="14" ry="38" />
      <ellipse cx="160" cy="74" rx="28" ry="38" opacity="0.7" />
      <circle cx="228" cy="30" r="4" fill="var(--tint)" />
      <path d="M220 38l-14 12M228 40v12M218 32h-12" opacity="0.6" />
    </>
  ),
  // 实体和组件连成的图
  engines: (
    <>
      <path d="M110 60L160 40L210 62L190 104L135 100ZM160 40L162 76M110 60L162 76L210 62M135 100L162 76L190 104" opacity="0.6" />
      {[[110, 60], [160, 40], [210, 62], [135, 100], [190, 104]].map(([x, y]) => (
        <circle key={`${x}-${y}`} cx={x} cy={y} r="6" fill="var(--background)" />
      ))}
      <circle cx="162" cy="76" r="9" fill="var(--tint)" fillOpacity="0.25" />
    </>
  ),
  // 几个节点和箭头组成的流程，像 Agent 的执行图
  tools: (
    <>
      <rect x="88" y="44" width="60" height="26" rx="6" />
      <rect x="180" y="44" width="60" height="26" rx="6" />
      <rect x="134" y="94" width="60" height="26" rx="6" fill="var(--tint)" fillOpacity="0.15" />
      <path d="M148 57h26M170 53l4 4-4 4M118 70l24 22M210 70l-24 22" />
      <path d="M98 54h30M98 61h20M190 54h34M190 61h18M144 104h30M144 111h22" opacity="0.5" />
    </>
  ),
  other: (
    <>
      <circle cx="160" cy="74" r="14" />
      <circle cx="160" cy="74" r="30" opacity="0.6" />
      <circle cx="160" cy="74" r="46" opacity="0.3" />
    </>
  ),
};

export function CoverArt({ category }: { category: CategoryId }) {
  return (
    <svg
      aria-hidden
      viewBox="0 0 320 200"
      preserveAspectRatio="xMidYMid slice"
      className="absolute inset-0 h-full w-full [&_*]:[vector-effect:non-scaling-stroke]"
      fill="none"
      stroke="var(--tint)"
      strokeWidth="1"
    >
      <path d={floorPath} opacity="0.22" />
      {art[category]}
    </svg>
  );
}

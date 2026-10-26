"use client";

import { AnimatePresence, motion } from "motion/react";
import { usePathname, useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { Reveal } from "@/components/Reveal";

// 位置变化统一用这条先快后慢的曲线
const EASE = [0.22, 1, 0.36, 1] as const;

type Props = {
  categories: { id: string; label: string; count: number }[];
  // 卡片在服务端渲染好再传进来，这里只负责按分类显示或隐藏
  items: { slug: string; category: string; card: React.ReactNode }[];
  labels: { all: string; filter: string };
};

// 项目页的分类筛选。选中的分类记在网址的 ?category= 里，链接可以直接分享，从详情页返回时也还在。
// 静态导出在构建时拿不到网址参数，生成的 HTML 里是 Suspense 的 fallback，也就是「全部」
export function ProjectFilter(props: Props) {
  return (
    <Suspense fallback={<FilterView {...props} active={null} />}>
      <FilterFromUrl {...props} />
    </Suspense>
  );
}

function FilterFromUrl(props: Props) {
  const pathname = usePathname();
  const param = useSearchParams().get("category");
  const active = props.categories.some((c) => c.id === param) ? param : null;
  // 换分类不新增浏览记录，按后退直接回到上一个页面
  const select = (id: string | null) =>
    window.history.replaceState(null, "", id ? `${pathname}?category=${id}` : pathname);
  return <FilterView {...props} active={active} onSelect={select} />;
}

function FilterView({
  categories,
  items,
  labels,
  active,
  onSelect,
}: Props & { active: string | null; onSelect?: (id: string | null) => void }) {
  const visible = active ? items.filter((item) => item.category === active) : items;
  // 所有项目都在同一个分类时筛选没有意义，不显示筛选栏
  const showFilter = categories.length > 1;
  const chips = [{ id: null, label: labels.all, count: items.length }, ...categories];

  return (
    <>
      {showFilter && (
        <Reveal delay={0.04} className="mt-10">
          <div role="group" aria-label={labels.filter} className="isolate flex flex-wrap gap-2">
            {chips.map((chip) => {
              const selected = chip.id === active;
              return (
                <button
                  key={chip.id ?? "all"}
                  type="button"
                  aria-pressed={selected}
                  onClick={() => onSelect?.(chip.id)}
                  style={chip.id ? ({ "--tint": `var(--cat-${chip.id})` } as React.CSSProperties) : undefined}
                  className={`relative flex items-center gap-2 rounded-full border bg-surface px-3 py-2 text-sm font-semibold transition active:scale-[0.98] ${
                    selected ? "border-white/20 text-foreground" : "border-line text-muted hover:bg-raised hover:text-foreground"
                  }`}
                >
                  {selected && (
                    <motion.span
                      layoutId="category-pill"
                      className="absolute inset-0 rounded-full bg-chip"
                      transition={{ duration: 0.5, ease: EASE }}
                    />
                  )}
                  {/* 分类的标记色，和卡片封面上的一样 */}
                  {chip.id && <span aria-hidden className="relative size-2 rounded-full bg-(--tint)" />}
                  <span className="relative">{chip.label}</span>
                  <span className="relative text-xs font-normal text-muted tabular-nums">{chip.count}</span>
                </button>
              );
            })}
          </div>
        </Reveal>
      )}
      {/* 切换分类时，留下的卡片滑到新位置，移走的淡出，新出现的由 Reveal 淡入 */}
      <div className={`relative grid auto-rows-fr grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3 ${showFilter ? "mt-6" : "mt-12"}`}>
        <AnimatePresence mode="popLayout">
          {visible.map((item, i) => (
            <motion.div
              key={item.slug}
              layout="position"
              exit={{ opacity: 0, transition: { duration: 0.3, ease: EASE } }}
              transition={{ duration: 0.5, ease: EASE }}
            >
              <Reveal delay={i * 0.06} className="h-full">
                {item.card}
              </Reveal>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </>
  );
}

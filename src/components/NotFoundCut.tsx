"use client";

// 404 页的空间切口（docs/design_space_cut.md §6.3、§3 D4）：在页面空白处划一刀或按住魔杖，切开以后不停，
// 直接扩大到铺满，再整页跳到首页。窗后是首页本身：页面闲下来时用一个看不见的 iframe 先把它加载好。
// "回到首页"按钮变成点击自动切，从按钮中间切开；回车也一样（D8）
import { useEffect, useMemo, useRef, useState } from "react";
import { type CutHints, CutLayer } from "@/components/CutLayer";
import type { Cut, CutTarget } from "@/cut/engine";
import { toClipPath } from "@/cut/geometry";
import { defaultLocale, type Locale, LOCALE_STORAGE_KEY, locales } from "@/i18n";

const HIDDEN = "polygon(0px 0px, 0px 0px, 0px 0px)";
const TOOLS = { knife: true, wand: true, click: false };

// 和根路径 / 的跳转用同一套规则：先看上次在切换按钮上选的语言，再看浏览器语言，都不匹配用默认语言
function pickLocale(): Locale {
  try {
    const saved = localStorage.getItem(LOCALE_STORAGE_KEY);
    if ((locales as readonly string[]).includes(saved ?? "")) return saved as Locale;
  } catch {
    // 存储不可用时看浏览器语言
  }
  for (const lang of navigator.languages ?? [navigator.language]) {
    const base = String(lang).toLowerCase().split("-")[0];
    if ((locales as readonly string[]).includes(base)) return base as Locale;
  }
  return defaultLocale;
}

export function NotFoundCut({ hints }: { hints: CutHints }) {
  const worldRef = useRef<HTMLDivElement>(null);
  const frameRef = useRef<HTMLIFrameElement>(null);
  const cutRef = useRef<Cut | null>(null);
  const homeRef = useRef<Locale>(defaultLocale);
  const [home, setHome] = useState<Locale | null>(null);

  // 页面闲下来以后再加载首页，不跟 404 页本身抢网络
  useEffect(() => {
    const locale = pickLocale();
    homeRef.current = locale;
    const load = () => setHome(locale);
    if (typeof requestIdleCallback === "function") {
      const id = requestIdleCallback(load, { timeout: 2000 });
      return () => cancelIdleCallback(id);
    }
    const timer = setTimeout(load, 1000);
    return () => clearTimeout(timer);
  }, []);

  // 切口的目标是盖在整页上面的首页：窗口形状写进 clip-path，视差移动 iframe，减少动态效果时改透明度
  const target = useMemo<CutTarget>(
    () => ({
      setWindow(polygon) {
        const world = worldRef.current;
        if (world) world.style.clipPath = polygon === null ? "" : polygon.length ? toClipPath(polygon) : HIDDEN;
      },
      setParallax(dx, dy, scale, origin) {
        const frame = frameRef.current;
        if (!frame) return;
        const still = dx === 0 && dy === 0 && scale === 1;
        frame.style.transformOrigin = still ? "" : `${origin[0]}px ${origin[1]}px`;
        frame.style.transform = still ? "" : `translate(${dx.toFixed(2)}px, ${dy.toFixed(2)}px) scale(${scale.toFixed(4)})`;
      },
      setFade(opacity) {
        const world = worldRef.current;
        if (world) world.style.opacity = opacity >= 1 ? "" : String(opacity);
      },
    }),
    [],
  );

  // "回到首页"按钮：不带修饰键的点击（回车也会触发点击）从按钮中间切开；首页语言跟着按钮走
  useEffect(() => {
    const onClick = (event: MouseEvent) => {
      const link = (event.target as Element | null)?.closest<HTMLAnchorElement>("a[data-cut-home]");
      const cut = cutRef.current;
      if (!link || !cut || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      event.preventDefault();
      const locale = link.dataset.cutHome as Locale;
      homeRef.current = locale;
      setHome(locale);
      const box = link.getBoundingClientRect();
      cut.clickAt([box.left + box.width / 2, box.top + box.height / 2]);
    };
    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
  }, []);

  return (
    <>
      {/* 窗后的首页：盖在页面上面，平时整个藏着；只看不点 */}
      <div ref={worldRef} aria-hidden className="pointer-events-none fixed inset-0 z-40 overflow-hidden bg-black" style={{ clipPath: HIDDEN }}>
        {home && <iframe ref={frameRef} src={`/${home}`} title="" tabIndex={-1} className="h-full w-full border-0" />}
      </div>
      {/* 接指针的这一层垫在卡片下面：空白处能划、能按住，卡片里的按钮照常能点 */}
      <CutLayer
        fixed
        target={target}
        stop={false}
        tools={TOOLS}
        hints={hints}
        onReady={(cut) => {
          cutRef.current = cut;
        }}
        onThrough={() => window.location.replace(`/${homeRef.current}`)}
        onClose={() => {}}
      />
    </>
  );
}

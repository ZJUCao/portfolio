"use client";

import { AnimatePresence, motion } from "motion/react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { LOCALE_STORAGE_KEY, type Locale } from "@/i18n";

type Props = {
  locale: Locale;
  name: string;
  labels: { projects: string; about: string; contact: string; openMenu: string; closeMenu: string };
  switchLabel: string;
  switchAria: string;
};

// 所有动效都用这条先快后慢、缓缓停住的曲线
const EASE = [0.22, 1, 0.36, 1] as const;

// 浮在页面上方、按内容宽度居中的导航条，名字前的圆点是一直亮着的「追踪中」指示灯。
// 手机上链接收进菜单：点右边的按钮打开一整屏的面板，链接按顺序依次上移淡入
export function Nav({ locale, name, labels, switchLabel, switchAria }: Props) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const other: Locale = locale === "zh" ? "en" : "zh";
  // 切换语言时停留在同一页面，只替换路径开头的语言段
  const switchHref = pathname.replace(/^\/(zh|en)(?=\/|$)/, `/${other}`);

  const items = [
    { href: `/${locale}/projects`, label: labels.projects },
    { href: `/${locale}/about`, label: labels.about },
    { href: `/${locale}/contact`, label: labels.contact },
  ];

  const switchLanguage = () => {
    setOpen(false);
    try {
      localStorage.setItem(LOCALE_STORAGE_KEY, other);
    } catch {
      // 隐私模式等情况下存不了，不影响切换
    }
  };

  // 菜单打开时页面不能滚动；按 Esc、或窗口变宽到不用菜单时关闭
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => event.key === "Escape" && setOpen(false);
    const wide = matchMedia("(min-width: 640px)");
    const onWide = () => wide.matches && setOpen(false);
    document.documentElement.style.overflow = "hidden";
    window.addEventListener("keydown", onKey);
    wide.addEventListener("change", onWide);
    return () => {
      document.documentElement.style.overflow = "";
      window.removeEventListener("keydown", onKey);
      wide.removeEventListener("change", onWide);
    };
  }, [open]);

  return (
    <>
      <header className="sticky top-0 z-30 flex justify-center px-4 pt-4">
        <nav className="panel flex h-12 items-center gap-2 rounded-full bg-surface/70 pl-4 pr-2 backdrop-blur-xl">
          <Link
            href={`/${locale}`}
            onClick={() => setOpen(false)}
            className="flex shrink-0 items-center gap-2 pr-2 text-sm font-semibold"
          >
            <span aria-hidden className="relative flex size-2">
              <span className="absolute inset-0 rounded-full bg-accent opacity-60 motion-safe:animate-ping" />
              <span className="relative size-2 rounded-full bg-accent" />
            </span>
            {name}
          </Link>
          <ul className="hidden items-center gap-1 sm:flex">
            {items.map((item) => {
              const active = pathname.startsWith(item.href);
              return (
                <li key={item.href} className="relative">
                  <Link
                    href={item.href}
                    aria-current={active ? "page" : undefined}
                    className={`block whitespace-nowrap rounded-full px-3 py-2 text-sm font-semibold transition-colors ${
                      active ? "text-foreground" : "text-muted hover:text-foreground"
                    }`}
                  >
                    {active && (
                      <motion.span
                        layoutId="nav-pill"
                        className="absolute inset-0 -z-10 rounded-full bg-chip"
                        transition={{ duration: 0.5, ease: EASE }}
                      />
                    )}
                    {item.label}
                  </Link>
                </li>
              );
            })}
          </ul>
          <Link
            href={switchHref}
            onClick={switchLanguage}
            hrefLang={other}
            aria-label={switchAria}
            className="hidden whitespace-nowrap rounded-full border border-line px-3 py-2 text-sm font-semibold text-muted transition-colors hover:border-accent hover:text-accent active:scale-[0.98] sm:block"
          >
            {switchLabel}
          </Link>
          <button
            type="button"
            onClick={() => setOpen(!open)}
            aria-expanded={open}
            aria-controls="mobile-menu"
            aria-label={open ? labels.closeMenu : labels.openMenu}
            className="relative size-10 rounded-full transition-colors hover:bg-chip active:scale-[0.98] sm:hidden"
          >
            {/* 两道横线，打开时各转 45° 合成一个叉 */}
            <span
              aria-hidden
              className={`absolute left-3 top-1/2 h-px w-4 bg-foreground transition-transform duration-500 ${open ? "rotate-45" : "-translate-y-1"}`}
            />
            <span
              aria-hidden
              className={`absolute left-3 top-1/2 h-px w-4 bg-foreground transition-transform duration-500 ${open ? "-rotate-45" : "translate-y-1"}`}
            />
          </button>
        </nav>
      </header>

      <AnimatePresence>
        {open && (
          <motion.div
            id="mobile-menu"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.3, ease: EASE }}
            className="fixed inset-0 z-20 bg-black/90 px-6 pt-24 backdrop-blur-2xl sm:hidden"
          >
            {/* 每项比上一项晚 60ms 出现，整段不超过 400ms */}
            <ul className="flex flex-col gap-2">
              {items.map((item, i) => (
                <motion.li
                  key={item.href}
                  initial={{ opacity: 0, y: 24 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.22, delay: i * 0.06, ease: EASE }}
                >
                  <Link
                    href={item.href}
                    onClick={() => setOpen(false)}
                    aria-current={pathname.startsWith(item.href) ? "page" : undefined}
                    className={`block py-3 text-3xl font-semibold ${pathname.startsWith(item.href) ? "text-accent" : "text-foreground"}`}
                  >
                    {item.label}
                  </Link>
                </motion.li>
              ))}
              <motion.li
                initial={{ opacity: 0, y: 24 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.22, delay: items.length * 0.06, ease: EASE }}
              >
                <Link
                  href={switchHref}
                  onClick={switchLanguage}
                  hrefLang={other}
                  aria-label={switchAria}
                  className="block py-3 text-3xl font-semibold text-muted"
                >
                  {switchLabel}
                </Link>
              </motion.li>
            </ul>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}

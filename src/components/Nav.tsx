"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { motion } from "motion/react";
import { LOCALE_STORAGE_KEY, type Locale } from "@/i18n";

type Props = {
  locale: Locale;
  name: string;
  labels: { projects: string; about: string; contact: string };
  switchLabel: string;
  switchAria: string;
};

export function Nav({ locale, name, labels, switchLabel, switchAria }: Props) {
  const pathname = usePathname();
  const other: Locale = locale === "zh" ? "en" : "zh";
  // 切换语言时停留在同一页面，只替换路径开头的语言段
  const switchHref = pathname.replace(/^\/(zh|en)(?=\/|$)/, `/${other}`);

  const items = [
    { href: `/${locale}/projects`, label: labels.projects },
    { href: `/${locale}/about`, label: labels.about },
    { href: `/${locale}/contact`, label: labels.contact },
  ];

  const rememberChoice = () => {
    try {
      localStorage.setItem(LOCALE_STORAGE_KEY, other);
    } catch {
      // 隐私模式等情况下存不了，不影响切换
    }
  };

  return (
    // 浮在页面上方的玻璃胶囊，名字前的圆点是一直亮着的「追踪中」指示灯
    <header className="sticky top-0 z-20 px-3 pt-3 sm:px-6 sm:pt-4">
      <nav className="glass mx-auto flex h-12 max-w-6xl items-center justify-between gap-4 rounded-full bg-background/70 pl-4 pr-1.5 backdrop-blur-xl sm:pl-5">
        <Link href={`/${locale}`} className="flex shrink-0 items-center gap-2.5 font-semibold tracking-tight">
          <span aria-hidden className="relative flex h-2 w-2">
            <span className="absolute inset-0 rounded-full bg-accent opacity-60 motion-safe:animate-ping" />
            <span className="relative h-2 w-2 rounded-full bg-accent" />
          </span>
          {name}
        </Link>
        <div className="flex items-center gap-1 text-sm">
          <ul className="flex gap-1">
            {items.map((item) => {
              const active = pathname.startsWith(item.href);
              return (
                <li key={item.href} className="relative">
                  <Link
                    href={item.href}
                    className={`block whitespace-nowrap rounded-full px-2.5 py-1.5 transition-colors sm:px-3 ${
                      active ? "text-foreground" : "text-muted hover:text-foreground"
                    }`}
                  >
                    {active && (
                      <motion.span
                        layoutId="nav-pill"
                        className="absolute inset-0 -z-10 rounded-full bg-white/10"
                        transition={{ type: "spring", stiffness: 400, damping: 32 }}
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
            onClick={rememberChoice}
            hrefLang={other}
            aria-label={switchAria}
            className="ml-1 whitespace-nowrap rounded-full border border-line px-2.5 py-1 font-mono text-xs sm:ml-2 sm:px-3 text-muted transition-colors hover:border-accent hover:text-accent"
          >
            {switchLabel}
          </Link>
        </div>
      </nav>
    </header>
  );
}

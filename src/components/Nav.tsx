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
    <header className="sticky top-0 z-10 border-b border-line bg-background/80 backdrop-blur">
      <nav className="mx-auto flex h-14 max-w-4xl items-center justify-between gap-4 px-4 sm:px-6">
        <Link href={`/${locale}`} className="shrink-0 font-semibold tracking-tight">
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
                    className={`block rounded-full px-3 py-1.5 transition-colors ${
                      active ? "text-foreground" : "text-muted hover:text-foreground"
                    }`}
                  >
                    {active && (
                      <motion.span
                        layoutId="nav-pill"
                        className="absolute inset-0 -z-10 rounded-full bg-line"
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
            className="ml-2 rounded-full border border-line px-3 py-1 font-mono text-xs text-muted transition-colors hover:border-foreground hover:text-foreground"
          >
            {switchLabel}
          </Link>
        </div>
      </nav>
    </header>
  );
}

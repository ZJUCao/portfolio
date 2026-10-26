import type { Metadata } from "next";
import Link from "next/link";
import { HudCorners } from "@/components/HudCorners";
import { getContent } from "@/data/profile";
import { geistMono, geistSans } from "./fonts";
import "./globals.css";

// 所有找不到的地址都显示这一页。它不经过任何布局，网址里也不一定有语言，所以中英文都写上
export const metadata: Metadata = { title: "404 · 曹宇 Yu Cao" };

const copy = {
  zh: { title: "这个页面不存在", body: "地址可能输错了，或者页面已经移走。", home: "回到首页" },
  en: { title: "This page doesn't exist", body: "The address may be mistyped, or the page has moved.", home: "Back to home" },
};

export default function GlobalNotFound() {
  const names = { zh: getContent("zh").name, en: getContent("en").name };
  return (
    <html lang="zh-CN" className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}>
      <body className="flex min-h-full items-center justify-center px-4 py-16 font-sans">
        <main className="panel relative w-full max-w-[680px] rounded-3xl bg-surface px-6 py-16 text-center sm:px-12">
          <HudCorners className="inset-4" />
          <p className="font-mono text-sm text-accent">404</p>
          {(["zh", "en"] as const).map((locale) => (
            <section key={locale} lang={locale === "zh" ? "zh-CN" : "en"} className="mt-8">
              <h1 className="text-3xl font-semibold tracking-tight">{copy[locale].title}</h1>
              <p className="mt-2 text-muted">{copy[locale].body}</p>
              <Link
                href={`/${locale}`}
                className="mt-6 inline-flex rounded-full bg-foreground px-3 py-2 text-base font-semibold text-background transition hover:bg-white active:scale-[0.98]"
              >
                {copy[locale].home}
              </Link>
            </section>
          ))}
          <p className="mt-8 text-sm text-muted">
            {names.zh} · {names.en}
          </p>
        </main>
      </body>
    </html>
  );
}

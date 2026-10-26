import type { Metadata, Viewport } from "next";
import Link from "next/link";
import { MotionProvider } from "@/components/MotionProvider";
import { Nav } from "@/components/Nav";
import { contentFor } from "@/data/profile";
import { htmlLang, locales } from "@/i18n";
import { geistMono, geistSans } from "../fonts";
import { ogImage } from "../share-image";
import "../globals.css";

// 静态导出：只生成 /zh 和 /en 两套页面，其他语言前缀一律 404
export const dynamicParams = false;
export const generateStaticParams = () => locales.map((lang) => ({ lang }));

// 手机浏览器的地址栏也用网站的底色
export const viewport: Viewport = { themeColor: "#000000" };

export async function generateMetadata({ params }: LayoutProps<"/[lang]">): Promise<Metadata> {
  const { lang } = await params;
  const c = contentFor(lang);
  const title = `${c.name} · ${c.title}`;
  return {
    title: { default: title, template: `%s · ${c.name}` },
    description: c.tagline,
    // 分享卡片：图片由 app/og.png/route.tsx 生成
    openGraph: {
      type: "website",
      siteName: c.name,
      locale: c.locale === "zh" ? "zh_CN" : "en_US",
      title,
      description: c.tagline,
      images: [ogImage],
    },
    twitter: { card: "summary_large_image" },
    icons: { apple: "/apple-touch-icon.png" },
  };
}

export default async function LangLayout({ children, params }: LayoutProps<"/[lang]">) {
  const { lang } = await params;
  const c = contentFor(lang);

  return (
    <html
      lang={htmlLang(c.locale)}
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="flex min-h-full flex-col font-sans">
        {/* 用键盘访问时第一个能聚焦的是它，回车直接跳过导航到正文 */}
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-full focus:bg-foreground focus:px-3 focus:py-2 focus:text-sm focus:font-semibold focus:text-background"
        >
          {c.ui.skip}
        </a>
        <MotionProvider>
          <Nav
            locale={c.locale}
            name={c.name}
            labels={c.ui.nav}
            switchLabel={c.ui.switchLabel}
            switchAria={c.ui.switchAria}
          />
          <main id="main" tabIndex={-1} className="mx-auto w-full max-w-6xl flex-1 px-4 py-12 outline-none sm:px-6 sm:py-20">
            {children}
          </main>
          <footer className="border-t border-line">
            <div className="mx-auto flex max-w-6xl flex-wrap justify-between gap-4 px-4 py-6 text-sm text-muted sm:px-6">
              <span>
                © {c.name} · {c.location}
              </span>
              <span className="flex flex-wrap gap-4">
                {c.links.map((link) => (
                  <a key={link.href} href={link.href} target="_blank" rel="noreferrer" className="transition-colors hover:text-foreground">
                    {link.label}
                  </a>
                ))}
                <Link href={`/${lang}/privacy`} className="transition-colors hover:text-foreground">
                  {c.privacy.title}
                </Link>
              </span>
            </div>
          </footer>
        </MotionProvider>
      </body>
    </html>
  );
}

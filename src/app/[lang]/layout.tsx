import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { Nav } from "@/components/Nav";
import { contentFor } from "@/data/profile";
import { htmlLang, locales } from "@/i18n";
import "../globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

// 静态导出：只生成 /zh 和 /en 两套页面，其他语言前缀一律 404
export const dynamicParams = false;
export const generateStaticParams = () => locales.map((lang) => ({ lang }));

// 手机浏览器的地址栏也用网站的深色
export const viewport: Viewport = { themeColor: "#05070d" };

export async function generateMetadata({ params }: LayoutProps<"/[lang]">): Promise<Metadata> {
  const { lang } = await params;
  const c = contentFor(lang);
  return {
    title: {
      default: `${c.name} · ${c.title}`,
      template: `%s · ${c.name}`,
    },
    description: c.tagline,
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
        <Nav
          locale={c.locale}
          name={c.name}
          labels={c.ui.nav}
          switchLabel={c.ui.switchLabel}
          switchAria={c.ui.switchAria}
        />
        <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-12 sm:px-6 sm:py-20">{children}</main>
        <footer className="border-t border-line">
          <div className="mx-auto flex max-w-6xl flex-wrap justify-between gap-2 px-4 py-6 text-sm text-muted sm:px-6">
            <span>© {c.name}</span>
            <span className="flex gap-4">
              {c.links.map((link) => (
                <a key={link.href} href={link.href} target="_blank" rel="noreferrer" className="hover:text-foreground">
                  {link.label}
                </a>
              ))}
            </span>
          </div>
        </footer>
      </body>
    </html>
  );
}

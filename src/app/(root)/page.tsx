import type { Metadata } from "next";
import Link from "next/link";
import { alternatesFor, defaultLocale, LOCALE_STORAGE_KEY, locales } from "@/i18n";

export const metadata: Metadata = { title: "Yu Cao · 曹宇", alternates: alternatesFor() };

// 静态导出没有服务器，不能按 Accept-Language 重定向，所以在浏览器里判断：
// 优先用上次在切换按钮上选的语言，否则看浏览器语言，都不匹配就用默认语言。
const script = `(function () {
  var locales = ${JSON.stringify(locales)};
  var pick = null;
  try { pick = localStorage.getItem(${JSON.stringify(LOCALE_STORAGE_KEY)}); } catch (e) {}
  if (locales.indexOf(pick) === -1) {
    var langs = navigator.languages || [navigator.language || ""];
    pick = ${JSON.stringify(defaultLocale)};
    for (var i = 0; i < langs.length; i++) {
      var base = String(langs[i]).toLowerCase().split("-")[0];
      if (locales.indexOf(base) !== -1) { pick = base; break; }
    }
  }
  location.replace("/" + pick);
})();`;

export default function RootRedirect() {
  return (
    <>
      <script dangerouslySetInnerHTML={{ __html: script }} />
      <noscript>
        <meta httpEquiv="refresh" content={`0; url=/${defaultLocale}`} />
      </noscript>
      <p className="p-6 text-sm">
        <Link href="/en">English</Link> · <Link href="/zh">中文</Link>
      </p>
    </>
  );
}

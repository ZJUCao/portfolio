export const locales = ["zh", "en"] as const;
export type Locale = (typeof locales)[number];
export const defaultLocale: Locale = "en";

export const hasLocale = (value: string): value is Locale =>
  (locales as readonly string[]).includes(value);

// 告诉搜索引擎同一页面的其他语言版本，path 是去掉语言前缀后的路径，如 "/about"
export const alternatesFor = (path = "") => ({
  languages: Object.fromEntries(locales.map((l) => [l, `/${l}${path}`])),
});

// 用户在语言切换按钮上的选择，根路径 / 跳转时优先使用
export const LOCALE_STORAGE_KEY = "preferred-locale";

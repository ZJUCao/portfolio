import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // 构建时生成纯静态文件到 out/，不需要 Node 服务器
  output: "export",
  // 网站有两个根布局（/ 跳转页和 /[lang]），找不到的地址统一用 app/global-not-found.tsx 显示 404
  experimental: { globalNotFound: true },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;

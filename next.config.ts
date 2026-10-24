import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // 构建时生成纯静态文件到 out/，不需要 Node 服务器
  output: "export",
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

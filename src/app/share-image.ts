// 分享预览图的地址、尺寸和说明文字：app/og.png/route.tsx 按这个尺寸生成图片，[lang]/layout.tsx 在 openGraph.images 里引用。
// 路由文件只能导出 GET 这类固定名字，所以单独放在这里
export const ogImage = {
  url: "/og.png",
  width: 1200,
  height: 630,
  alt: "Yu Cao, C++ engineer for XR rendering and tracking",
};

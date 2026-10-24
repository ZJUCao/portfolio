import "../globals.css";

// 只给根路径 / 用的根布局：这个页面只负责跳转到 /zh 或 /en
export default function RootRedirectLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}

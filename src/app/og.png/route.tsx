import { ImageResponse } from "next/og";
import { ogImage } from "../share-image";

// 分享到社交平台时的预览图，构建时生成到 /og.png，[lang]/layout.tsx 的 openGraph.images 引用它。
// 用带 .png 的路由而不是 opengraph-image 约定：静态导出时后者生成的文件没有扩展名，
// 静态托管可能不按图片返回，LinkedIn 之类就显示不出预览。
// next/og 自带的字体只有拉丁字母，所以图上只写英文，中英文页面共用这一张；首页英文标题改了，这里也跟着改。
// 右边是一块缩小的棋盘格标定板，内角点按行着色，和首页的 3D 画面一样
export const dynamic = "force-static";

const COLS = 10;
const ROWS = 7;
const SQUARE = 30;

export function GET() {
  const corner = (position: Record<string, number>, sides: Record<string, string>) => (
    <div style={{ position: "absolute", width: 32, height: 32, ...position, ...sides }} />
  );
  const line = "2px solid #5fe3ff";
  return new ImageResponse(
    (
      <div style={{ display: "flex", gap: 48, width: "100%", height: "100%", background: "#000000", color: "#ededed", padding: 96 }}>
        {corner({ left: 40, top: 40 }, { borderLeft: line, borderTop: line })}
        {corner({ right: 40, top: 40 }, { borderRight: line, borderTop: line })}
        {corner({ left: 40, bottom: 40 }, { borderLeft: line, borderBottom: line })}
        {corner({ right: 40, bottom: 40 }, { borderRight: line, borderBottom: line })}

        <div style={{ display: "flex", flexDirection: "column", justifyContent: "center", flex: 1 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 16, fontSize: 28, color: "#a1a1a1" }}>
            <div style={{ width: 16, height: 16, borderRadius: 9999, background: "#5fe3ff" }} />
            Yu Cao
          </div>
          <div style={{ display: "flex", flexDirection: "column", marginTop: 32, fontSize: 52, lineHeight: 1.15 }}>
            <span style={{ color: "#ffffff" }}>C++ engineer for</span>
            <span style={{ color: "#bdbdbd" }}>XR rendering and tracking</span>
          </div>
          <div style={{ display: "flex", marginTop: 32, fontSize: 28, color: "#a1a1a1" }}>
            Rendering · Computer vision · XR · Boston
          </div>
        </div>

        <div style={{ display: "flex", alignItems: "center" }}>
          <div style={{ display: "flex", position: "relative", flexDirection: "column", border: "12px solid #b3bfd0" }}>
            {Array.from({ length: ROWS }, (_, r) => (
              <div key={r} style={{ display: "flex" }}>
                {Array.from({ length: COLS }, (_, c) => (
                  <div
                    key={c}
                    style={{ width: SQUARE, height: SQUARE, background: (r + c) % 2 === 0 ? "#0a0f18" : "#b3bfd0" }}
                  />
                ))}
              </div>
            ))}
            {Array.from({ length: (ROWS - 1) * (COLS - 1) }, (_, i) => {
              const r = Math.floor(i / (COLS - 1));
              const c = i % (COLS - 1);
              return (
                <div
                  key={i}
                  style={{
                    position: "absolute",
                    left: (c + 1) * SQUARE - 6,
                    top: (r + 1) * SQUARE - 6,
                    width: 12,
                    height: 12,
                    borderRadius: 9999,
                    border: `3px solid hsl(${(r / (ROWS - 1)) * 300}, 90%, 62%)`,
                  }}
                />
              );
            })}
          </div>
        </div>
      </div>
    ),
    { width: ogImage.width, height: ogImage.height },
  );
}

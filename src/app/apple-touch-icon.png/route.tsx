import { ImageResponse } from "next/og";

// iOS 添加到主屏幕时用的图标，构建时生成到 /apple-touch-icon.png（iOS 默认也会找这个地址），
// [lang]/layout.tsx 的 icons.apple 引用它。图案和 icon.svg 一样：黑底上一个青色的追踪圆点
export const dynamic = "force-static";

export function GET() {
  return new ImageResponse(
    (
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", width: "100%", height: "100%", background: "#000000" }}>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            width: 104,
            height: 104,
            borderRadius: 9999,
            border: "8px solid rgba(95, 227, 255, 0.45)",
          }}
        >
          <div style={{ width: 52, height: 52, borderRadius: 9999, background: "#5fe3ff" }} />
        </div>
      </div>
    ),
    { width: 180, height: 180 },
  );
}

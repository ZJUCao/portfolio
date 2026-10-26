// 取景框四角的标记：四个只画两条边的小方块。放在 relative 的容器里，用 className 里的 inset-* 控制离边多远，
// color 默认是强调色
export function HudCorners({ className = "", color = "var(--accent)" }: { className?: string; color?: string }) {
  const corner = "absolute size-4 border-(--hud)";
  return (
    <span
      aria-hidden
      style={{ "--hud": color } as React.CSSProperties}
      className={`pointer-events-none absolute ${className}`}
    >
      <span className={`${corner} left-0 top-0 border-l border-t`} />
      <span className={`${corner} right-0 top-0 border-r border-t`} />
      <span className={`${corner} bottom-0 left-0 border-b border-l`} />
      <span className={`${corner} bottom-0 right-0 border-b border-r`} />
    </span>
  );
}

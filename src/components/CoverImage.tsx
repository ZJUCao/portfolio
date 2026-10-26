"use client";

// 卡片的封面图。README 里的截图常是左右并排的对比图（如 phong-vs-toon.png），整张裁进卡片会露出中间的分界，
// 所以宽高比在 1.9 以上的图当作左右两张拼在一起，只显示右边那张（通常是效果图），并多裁掉一点，避开中间的分隔线。
// 宽高比要等图片加载完才知道，先透明，算好再显示
const SIDE_BY_SIDE = 1.9;
const RIGHT_PANEL = 0.49; // 显示整张图最右边 49% 的宽度

function fit(img: HTMLImageElement | null) {
  if (!img?.complete || !img.naturalWidth) return;
  if (img.naturalWidth / img.naturalHeight >= SIDE_BY_SIDE) {
    // 图片框放宽到卡片的 1/0.49 倍、靠右对齐，卡片里正好露出右边那张；悬停放大时以露出部分的中心为原点
    img.style.width = `${100 / RIGHT_PANEL}%`;
    img.style.objectPosition = "right center";
    img.style.transformOrigin = `${100 - 50 * RIGHT_PANEL}% 50%`;
  }
  img.style.opacity = "1";
}

export function CoverImage({ src }: { src: string }) {
  return (
    // 静态导出没有图片优化服务，直接用原图地址。图片在 React 接管页面前就加载完时 onLoad 不会触发，由 ref 补上
    // eslint-disable-next-line @next/next/no-img-element
    <img
      ref={fit}
      src={src}
      alt=""
      loading="lazy"
      decoding="async"
      onLoad={(event) => fit(event.currentTarget)}
      style={{ opacity: 0 }}
      className="absolute right-0 top-0 h-full w-full max-w-none object-cover transition-[opacity,transform] duration-700 group-hover:scale-[1.04]"
    />
  );
}

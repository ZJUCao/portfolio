import { BOARD } from "@/ar/board";

// 可打印的标定板，构建时生成到 /chessboard.pdf，摄像头 AR 的叠层里有下载链接。
// 一页 A4 横向：10×7 个 25 毫米的格子居中，左上角那格是黑的，和 src/ar/board.ts、首页 3D 画面里的标定板一样；
// 板子下面一行说明文字和一条 50 毫米的比例尺，打印后量一下就知道是不是按 100% 打印的。
// 文件按 PDF 1.4 手写：没有日期和随机 ID，每次构建的字节都一样。契约见 docs/design_camera_ar.md §5.8
export const dynamic = "force-static";

const PT_PER_MM = 72 / 25.4;
const PAGE = { width: 842, height: 595 }; // A4 横向，单位是点
const SQUARE = BOARD.squareMeters * 1000 * PT_PER_MM;
const BOARD_X = (PAGE.width - BOARD.squaresX * SQUARE) / 2;
const BOARD_Y = (PAGE.height - BOARD.squaresY * SQUARE) / 2; // 板子下边缘；PDF 的 y 轴朝上
const BOARD_TOP = BOARD_Y + BOARD.squaresY * SQUARE;
const BAR = 50 * PT_PER_MM;
const FONT_SIZE = 9;
const BASELINE = 26; // 说明文字和比例尺在板子下方的空白里，离纸边约 9 毫米，普通打印机都印得出来

// 说明文字用英文，和 og.png 一样只用 PDF 自带的 Helvetica；· 和 × 在 WinAnsi 里是单字节 0xB7、0xD7
const CAPTION = `SceneGraph AR board · ${BOARD.squaresX}×${BOARD.squaresY} squares, ${BOARD.cornersX}×${BOARD.cornersY} inner corners · ${BOARD.squareMeters * 1000} mm squares · print at 100% (actual size)`;

// 坐标最多保留 4 位小数，去掉多余的 0
const n = (value: number) => String(Number(value.toFixed(4)));
const pdfString = (text: string) => `(${text.replace(/[\\()]/g, (ch) => `\\${ch}`)})`;

function content() {
  const ops: string[] = [];
  // 35 个黑格：第 r 行（从上往下数）第 c 列，r + c 为偶数时是黑的，所以左上角那格是黑的
  ops.push("0 g");
  for (let r = 0; r < BOARD.squaresY; r++) {
    for (let c = 0; c < BOARD.squaresX; c++) {
      if ((r + c) % 2 === 0) ops.push(`${n(BOARD_X + c * SQUARE)} ${n(BOARD_TOP - (r + 1) * SQUARE)} ${n(SQUARE)} ${n(SQUARE)} re f`);
    }
  }
  // 比例尺用深灰色，和黑格区分开；右端和板子右边缘对齐，左边写上「50 mm」
  const barRight = BOARD_X + BOARD.squaresX * SQUARE;
  ops.push(`0.3 g ${n(barRight - BAR)} ${n(BASELINE - 1)} ${n(BAR)} 4 re f`);
  ops.push("0 g");
  ops.push(`BT /F1 ${FONT_SIZE} Tf ${n(BOARD_X)} ${BASELINE} Td ${pdfString(CAPTION)} Tj ET`);
  // 「50 mm」在 9 号 Helvetica 下约 27.5 点宽，右边离比例尺留 6 点
  ops.push(`BT /F1 ${FONT_SIZE} Tf ${n(barRight - BAR - 34)} ${BASELINE} Td ${pdfString("50 mm")} Tj ET`);
  return ops.join("\n");
}

function buildPdf() {
  const stream = content();
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    `<< /Type /Pages /Kids [3 0 R] /Count 1 /MediaBox [0 0 ${PAGE.width} ${PAGE.height}] >>`,
    "<< /Type /Page /Parent 2 0 R /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>",
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>",
  ];
  // 第二行的注释里放几个大于 127 的字节，告诉传输工具这是二进制文件
  let out = "%PDF-1.4\n%âãÏÓ\n";
  const offsets: number[] = [];
  objects.forEach((body, k) => {
    offsets.push(out.length);
    out += `${k + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xref = out.length;
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets) out += `${String(offset).padStart(10, "0")} 00000 n \n`;
  out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  // 每个字符都在 0–255 之内，按 latin1 一个字符一个字节，上面算的偏移就是字节偏移
  return Buffer.from(out, "latin1");
}

export function GET(): Response {
  return new Response(new Uint8Array(buildPdf()), { headers: { "Content-Type": "application/pdf" } });
}

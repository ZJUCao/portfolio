// P4 contract tests for the printable board src/app/chessboard.pdf/route.ts:
// docs/design_camera_ar.md §5.8 and §14 (OQ-50–OQ-55); test plan §6.1. The body is read with the
// small PDF reader of test plan §2.7, so structure, geometry and text are checked as a viewer sees them.

import { describe, expect, it } from "vitest";
import { GET, dynamic } from "@/app/chessboard.pdf/route";
import {
  type PdfDict,
  type PdfFile,
  bounds,
  decodeStream,
  interpretContent,
  isArray,
  isAxisAlignedRect,
  isBlack,
  isDict,
  isName,
  isRef,
  isStream,
  readPdf,
} from "./helpers/pdf";

const PT_PER_MM = 72 / 25.4;
const SQUARE = 25 * PT_PER_MM; // 70.8661 pt
const BAR = 50 * PT_PER_MM; // 141.7323 pt
const PAGE = { width: 842, height: 595 };
const CAPTION = "SceneGraph AR board · 10×7 squares, 9×6 inner corners · 25 mm squares · print at 100% (actual size)";

async function body(): Promise<Uint8Array> {
  const response = await GET();
  return new Uint8Array(await response.arrayBuffer());
}

const dictOf = (pdf: PdfFile, value: Parameters<PdfFile["resolve"]>[0]): PdfDict => {
  const v = pdf.resolve(value);
  if (!isDict(v)) throw new Error("expected a dictionary");
  return v;
};

const nameOf = (value: Parameters<PdfFile["resolve"]>[0]): string | null => (isName(value) ? value.value : null);

const numbersOf = (pdf: PdfFile, value: Parameters<PdfFile["resolve"]>[0]): number[] | null => {
  const v = pdf.resolve(value);
  return isArray(v) ? v.items.map((item) => pdf.resolve(item) as number) : null;
};

/** The file, its one page and that page's interpreted content. */
async function load() {
  const bytes = await body();
  const pdf = readPdf(bytes);
  const catalog = dictOf(pdf, pdf.trailer.entries.Root);
  const pages = dictOf(pdf, catalog.entries.Pages);
  const kids = pdf.resolve(pages.entries.Kids);
  if (!isArray(kids)) throw new Error("Pages without /Kids");
  const page = dictOf(pdf, kids.items[0]);
  const contents = pdf.resolve(page.entries.Contents);
  const streams = isArray(contents) ? contents.items.map((item) => pdf.resolve(item)) : [contents];
  const data = Buffer.concat(
    streams.map((s) => {
      if (!isStream(s)) throw new Error("/Contents is not a stream");
      return Buffer.from(decodeStream(s));
    }),
  );
  const content = interpretContent(new Uint8Array(data));
  const blacks = content.fills.filter((f) => isBlack(f.colour));
  const board = bounds(blacks.flatMap((f) => f.points));
  return { bytes, pdf, catalog, pages, page, content, blacks, board };
}

describe("chessboard.pdf route (§5.8)", () => {
  it("P4-PDF-01 the route is force-static", () => {
    expect(dynamic).toBe("force-static");
  });

  it("P4-PDF-02 GET returns a 200 application/pdf Response", async () => {
    const response = await GET();
    expect(response).toBeInstanceOf(Response);
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("application/pdf");
  });

  it("P4-PDF-03 starts with %PDF-1.4 and ends with %%EOF and at most one EOL (OQ-54)", async () => {
    const text = Buffer.from(await body()).toString("latin1");
    expect(text.slice(0, 8)).toBe("%PDF-1.4");
    expect(text).toMatch(/%%EOF(\r\n|\n|\r)?$/);
  });

  it("P4-PDF-04 startxref, the cross-reference table and the trailer agree", async () => {
    const { pdf } = await load();
    expect(pdf.text.startsWith("xref", pdf.startxref)).toBe(true);
    expect(pdf.xref).toHaveLength(1);
    const [section] = pdf.xref;
    expect(section.start).toBe(0);
    const n = section.entries.length;
    expect(pdf.trailer.entries.Size).toBe(n);
    for (const entry of section.entries) expect(entry.raw).toHaveLength(20);
    expect(section.entries[0].raw.startsWith("0000000000 65535 f")).toBe(true);
    section.entries.forEach((entry, k) => {
      if (k > 0) {
        expect(entry.inUse, `entry ${k}`).toBe(true);
        expect(pdf.text.slice(entry.offset, entry.offset + 20), `offset of object ${k}`).toMatch(new RegExp(`^${k} 0 obj\\b`));
      }
    });
  });

  it("P4-PDF-05 /Root leads to a catalog with one page, and every reference resolves", async () => {
    const { pdf, catalog, pages, page } = await load();
    expect(nameOf(catalog.entries.Type)).toBe("Catalog");
    expect(nameOf(pages.entries.Type)).toBe("Pages");
    expect(pdf.resolve(pages.entries.Count)).toBe(1);
    const kids = pdf.resolve(pages.entries.Kids);
    expect(isArray(kids) && kids.items.length).toBe(1);
    expect(nameOf(page.entries.Type)).toBe("Page");
    const parent = page.entries.Parent;
    const pagesRef = catalog.entries.Pages;
    expect(isRef(parent) && isRef(pagesRef) && parent.num === pagesRef.num).toBe(true);
    const refs = pdf.references();
    expect(refs.length).toBeGreaterThan(0);
    for (const ref of refs) expect(() => pdf.object(ref.num), `${ref.num} ${ref.gen} R`).not.toThrow();
  });

  it("P4-PDF-06 one A4 landscape page", async () => {
    const { pdf, pages, page } = await load();
    expect(numbersOf(pdf, page.entries.MediaBox ?? pages.entries.MediaBox)).toEqual([0, 0, 842, 595]);
    const rotate = pdf.resolve(page.entries.Rotate ?? pages.entries.Rotate);
    expect(rotate === undefined || rotate === 0).toBe(true);
    const crop = numbersOf(pdf, page.entries.CropBox ?? pages.entries.CropBox);
    if (crop) expect(crop[0] <= 0 && crop[1] <= 0 && crop[2] >= 842 && crop[3] >= 595, "CropBox covers the MediaBox").toBe(true);
  });

  it("P4-PDF-07 the content stream's /Length is its real length and it decodes (OQ-54)", async () => {
    const { pdf, page } = await load();
    const contents = pdf.resolve(page.entries.Contents);
    const streams = isArray(contents) ? contents.items.map((item) => pdf.resolve(item)) : [contents];
    for (const stream of streams) {
      expect(isStream(stream)).toBe(true);
      if (!isStream(stream)) continue;
      // readPdf already refuses a /Length that does not end at "endstream"
      expect(pdf.resolve(stream.dict.entries.Length)).toBe(stream.raw.length);
      const filter = nameOf(stream.dict.entries.Filter as Parameters<typeof nameOf>[0]);
      expect(stream.dict.entries.Filter === undefined || filter === "FlateDecode").toBe(true);
      expect(decodeStream(stream).length).toBeGreaterThan(0);
    }
  });

  it("P4-PDF-08 exactly 35 black fills, each a 25 mm square", async () => {
    const { blacks } = await load();
    expect(blacks).toHaveLength(35);
    for (const fill of blacks) {
      expect(isAxisAlignedRect(fill.points)).toBe(true);
      const b = bounds(fill.points);
      expect(Math.abs(b.x1 - b.x0 - SQUARE)).toBeLessThanOrEqual(0.01);
      expect(Math.abs(b.y1 - b.y0 - SQUARE)).toBeLessThanOrEqual(0.01);
    }
  });

  it("P4-PDF-09 the squares sit on a 10 × 7 grid, dark where r + c is even, square (0, 0) top left", async () => {
    const { blacks, board } = await load();
    expect(Math.abs(board.x1 - board.x0 - 10 * SQUARE)).toBeLessThanOrEqual(0.02);
    expect(Math.abs(board.y1 - board.y0 - 7 * SQUARE)).toBeLessThanOrEqual(0.02);
    const cells = new Set<string>();
    for (const fill of blacks) {
      const b = bounds(fill.points);
      const c = (b.x0 - board.x0) / SQUARE;
      const r = (board.y1 - b.y1) / SQUARE; // rows counted from the top of the page
      expect(Math.abs(c - Math.round(c)) * SQUARE, "on the column grid").toBeLessThanOrEqual(0.01);
      expect(Math.abs(r - Math.round(r)) * SQUARE, "on the row grid").toBeLessThanOrEqual(0.01);
      const [ri, ci] = [Math.round(r), Math.round(c)];
      expect(ri >= 0 && ri < 7 && ci >= 0 && ci < 10, `square (${ri}, ${ci}) inside the board`).toBe(true);
      expect((ri + ci) % 2, `square (${ri}, ${ci}) is dark`).toBe(0);
      cells.add(`${ri},${ci}`);
    }
    expect(cells.size).toBe(35);
    expect(cells.has("0,0")).toBe(true);
  });

  it("P4-PDF-10 the board is centred on the page (OQ-50)", async () => {
    const { board } = await load();
    expect(Math.abs((board.x0 + board.x1) / 2 - PAGE.width / 2)).toBeLessThanOrEqual(0.5);
    expect(Math.abs((board.y0 + board.y1) / 2 - PAGE.height / 2)).toBeLessThanOrEqual(0.5);
    expect(Math.abs(board.y0 - 49.468)).toBeLessThanOrEqual(0.5);
  });

  it("P4-PDF-11 nothing but the squares and the scale bar is filled; the page's white is the background (OQ-55)", async () => {
    const { content, blacks, board } = await load();
    const others = content.fills.filter((f) => !blacks.includes(f));
    expect(others, "the scale bar is the only other fill").toHaveLength(1);
    const bar = bounds(others[0].points);
    expect(bar.y1, "the other fill is below the board").toBeLessThan(board.y0);
  });

  it("P4-PDF-12 a Helvetica caption of at most 10 pt below the board", async () => {
    const { pdf, page, content, board } = await load();
    const run = content.texts.find((t) => t.text === CAPTION);
    expect(run, `a text run "${CAPTION}"; found ${JSON.stringify(content.texts.map((t) => t.text))}`).toBeDefined();
    if (!run) return;
    const resources = dictOf(pdf, page.entries.Resources);
    const font = dictOf(pdf, dictOf(pdf, resources.entries.Font).entries[run.font]);
    expect(nameOf(font.entries.Subtype)).toBe("Type1");
    expect(nameOf(font.entries.BaseFont)).toBe("Helvetica");
    expect(run.size).toBeGreaterThan(0);
    expect(run.size).toBeLessThanOrEqual(10);
    expect(run.y).toBeLessThan(board.y0);
    expect(run.y).toBeGreaterThan(0);
    expect(run.x).toBeGreaterThanOrEqual(0);
  });

  it("P4-PDF-13 the caption is WinAnsi, with · as 0xB7 and × as 0xD7 (OQ-51)", async () => {
    const { pdf, page, content } = await load();
    const run = content.texts.find((t) => t.text === CAPTION);
    expect(run).toBeDefined();
    if (!run) return;
    const resources = dictOf(pdf, page.entries.Resources);
    const font = dictOf(pdf, dictOf(pdf, resources.entries.Font).entries[run.font]);
    expect(nameOf(font.entries.Encoding)).toBe("WinAnsiEncoding");
    expect(run.bytes).toHaveLength(CAPTION.length);
    Array.from(CAPTION).forEach((ch, k) => {
      if (ch === "·") expect(run.bytes[k], `byte ${k}`).toBe(0xb7);
      if (ch === "×") expect(run.bytes[k], `byte ${k}`).toBe(0xd7);
    });
  });

  it("P4-PDF-14 a solid 50 mm scale bar below the board, labelled 50 mm (OQ-52)", async () => {
    const { content, blacks, board } = await load();
    const bars = content.fills.filter((f) => !blacks.includes(f) && isAxisAlignedRect(f.points));
    expect(bars).toHaveLength(1);
    const bar = bounds(bars[0].points);
    expect(Math.abs(bar.x1 - bar.x0 - BAR)).toBeLessThanOrEqual(0.05);
    expect(bar.y1).toBeLessThan(board.y0);
    expect(bar.x0 >= 0 && bar.x1 <= PAGE.width && bar.y0 >= 0).toBe(true);
    const label = content.texts.find((t) => t.text === "50 mm");
    expect(label, "a 50 mm label").toBeDefined();
    if (!label) return;
    expect(Math.abs(label.y - (bar.y0 + bar.y1) / 2), "the label sits on the bar's line").toBeLessThanOrEqual(15);
    expect(label.x >= bar.x0 - 80 && label.x <= bar.x1 + 20, "the label is next to the bar").toBe(true);
  });

  it("P4-PDF-15 the bytes are reproducible (OQ-53)", async () => {
    const [a, b] = await Promise.all([body(), body()]);
    expect(Buffer.from(a).equals(Buffer.from(b))).toBe(true);
  });

  it("P4-PDF-16 PDF 1.4 only: no cross-reference or object streams", async () => {
    const text = Buffer.from(await body()).toString("latin1");
    expect(text).not.toMatch(/\/Type\s*\/XRef/);
    expect(text).not.toContain("/ObjStm");
  });
});

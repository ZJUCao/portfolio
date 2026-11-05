// A small PDF reader for the chessboard.pdf tests (docs/test_plan_camera_ar.md §2.7). It reads the
// header, `startxref`, the classic cross-reference table and the trailer, and fails on anything a
// PDF 1.4 file written by hand should not have (cross-reference streams, wrong offsets, a wrong
// stream /Length). It resolves indirect objects, decodes unfiltered and FlateDecode streams, and
// interprets a page content stream into filled polygons, stroked segments and text runs in page
// coordinates.

import { inflateSync } from "node:zlib";

export type PdfValue =
  | number
  | boolean
  | null
  | { readonly type: "name"; readonly value: string }
  | { readonly type: "string"; readonly bytes: Uint8Array }
  | { readonly type: "ref"; readonly num: number; readonly gen: number }
  | { readonly type: "array"; readonly items: PdfValue[] }
  | PdfDict
  | PdfStream;

export interface PdfDict {
  readonly type: "dict";
  readonly entries: Record<string, PdfValue>;
}

export interface PdfStream {
  readonly type: "stream";
  readonly dict: PdfDict;
  /** The bytes between `stream` + EOL and `endstream`, exactly /Length long. */
  readonly raw: Uint8Array;
}

type Token =
  | { readonly kind: "value"; readonly value: PdfValue }
  | { readonly kind: "keyword"; readonly value: string }
  | { readonly kind: "open"; readonly value: "[" | "<<" }
  | { readonly kind: "close"; readonly value: "]" | ">>" };

const WHITESPACE = new Set([0, 9, 10, 12, 13, 32]);
const DELIMITERS = new Set([...("()<>[]{}/%".split("").map((c) => c.charCodeAt(0)))]);

const latin1 = (bytes: Uint8Array): string => Buffer.from(bytes).toString("latin1");

/** A tokenizer over PDF bytes, shared by the object parser and the content interpreter. */
class Lexer {
  pos: number;
  constructor(
    readonly bytes: Uint8Array,
    pos = 0,
  ) {
    this.pos = pos;
  }

  private skipSpace(): void {
    const { bytes } = this;
    while (this.pos < bytes.length) {
      const b = bytes[this.pos];
      if (WHITESPACE.has(b)) this.pos++;
      else if (b === 0x25) {
        // A comment runs to the end of the line
        while (this.pos < bytes.length && bytes[this.pos] !== 10 && bytes[this.pos] !== 13) this.pos++;
      } else break;
    }
  }

  next(): Token | null {
    this.skipSpace();
    const { bytes } = this;
    if (this.pos >= bytes.length) return null;
    const b = bytes[this.pos];
    const c = String.fromCharCode(b);
    if (c === "[" || c === "]") {
      this.pos++;
      return c === "[" ? { kind: "open", value: "[" } : { kind: "close", value: "]" };
    }
    if (c === "<" && bytes[this.pos + 1] === 0x3c) {
      this.pos += 2;
      return { kind: "open", value: "<<" };
    }
    if (c === ">" && bytes[this.pos + 1] === 0x3e) {
      this.pos += 2;
      return { kind: "close", value: ">>" };
    }
    if (c === "<") return { kind: "value", value: this.hexString() };
    if (c === "(") return { kind: "value", value: this.literalString() };
    if (c === "/") return { kind: "value", value: this.name() };
    const start = this.pos;
    while (this.pos < bytes.length && !WHITESPACE.has(bytes[this.pos]) && !DELIMITERS.has(bytes[this.pos])) this.pos++;
    if (this.pos === start) throw new Error(`PDF: unexpected byte 0x${b.toString(16)} at ${start}`);
    const word = latin1(bytes.subarray(start, this.pos));
    if (/^[+-]?(\d+\.?\d*|\.\d+)$/.test(word)) return { kind: "value", value: Number(word) };
    if (word === "true" || word === "false") return { kind: "value", value: word === "true" };
    if (word === "null") return { kind: "value", value: null };
    return { kind: "keyword", value: word };
  }

  private name(): PdfValue {
    const { bytes } = this;
    this.pos++; // "/"
    let out = "";
    while (this.pos < bytes.length && !WHITESPACE.has(bytes[this.pos]) && !DELIMITERS.has(bytes[this.pos])) {
      if (bytes[this.pos] === 0x23) {
        out += String.fromCharCode(parseInt(latin1(bytes.subarray(this.pos + 1, this.pos + 3)), 16));
        this.pos += 3;
      } else out += String.fromCharCode(bytes[this.pos++]);
    }
    return { type: "name", value: out };
  }

  private hexString(): PdfValue {
    const end = this.bytes.indexOf(0x3e, this.pos);
    if (end < 0) throw new Error("PDF: unterminated hex string");
    const hex = latin1(this.bytes.subarray(this.pos + 1, end)).replace(/\s+/g, "");
    this.pos = end + 1;
    const padded = hex.length % 2 ? `${hex}0` : hex;
    return { type: "string", bytes: Uint8Array.from(padded.match(/../g) ?? [], (h) => parseInt(h, 16)) };
  }

  private literalString(): PdfValue {
    const { bytes } = this;
    this.pos++; // "("
    const out: number[] = [];
    let depth = 1;
    while (this.pos < bytes.length) {
      const b = bytes[this.pos++];
      if (b === 0x5c) {
        const e = bytes[this.pos++];
        const simple: Record<number, number> = { 0x6e: 10, 0x72: 13, 0x74: 9, 0x62: 8, 0x66: 12, 0x28: 0x28, 0x29: 0x29, 0x5c: 0x5c };
        if (e in simple) out.push(simple[e]);
        else if (e >= 0x30 && e <= 0x37) {
          let octal = e - 0x30;
          for (let k = 0; k < 2 && bytes[this.pos] >= 0x30 && bytes[this.pos] <= 0x37; k++) octal = octal * 8 + bytes[this.pos++] - 0x30;
          out.push(octal & 0xff);
        } else if (e === 13) {
          if (bytes[this.pos] === 10) this.pos++; // a line continuation
        } else if (e !== 10) out.push(e);
      } else if (b === 0x28) {
        depth++;
        out.push(b);
      } else if (b === 0x29) {
        if (--depth === 0) return { type: "string", bytes: Uint8Array.from(out) };
        out.push(b);
      } else out.push(b);
    }
    throw new Error("PDF: unterminated literal string");
  }
}

/** Reads one object at the lexer's position; `R` after two integers makes a reference. */
function parseValue(lexer: Lexer, first?: Token | null): PdfValue {
  const token = first ?? lexer.next();
  if (!token) throw new Error("PDF: unexpected end of data");
  if (token.kind === "open" && token.value === "[") {
    const items: PdfValue[] = [];
    for (;;) {
      const t = lexer.next();
      if (!t) throw new Error("PDF: unterminated array");
      if (t.kind === "close" && t.value === "]") return { type: "array", items: resolveRefs(items) };
      items.push(parseValue(lexer, t));
    }
  }
  if (token.kind === "open" && token.value === "<<") {
    const flat: PdfValue[] = [];
    for (;;) {
      const t = lexer.next();
      if (!t) throw new Error("PDF: unterminated dictionary");
      if (t.kind === "close" && t.value === ">>") break;
      flat.push(parseValue(lexer, t));
    }
    const items = resolveRefs(flat);
    if (items.length % 2) throw new Error("PDF: dictionary with an odd number of items");
    const entries: Record<string, PdfValue> = {};
    for (let k = 0; k < items.length; k += 2) {
      const key = items[k];
      if (!isName(key)) throw new Error("PDF: dictionary key is not a name");
      entries[key.value] = items[k + 1];
    }
    return { type: "dict", entries };
  }
  if (token.kind === "value") return token.value;
  if (token.kind === "keyword" && token.value === "R") return { type: "keyword-R" } as unknown as PdfValue;
  throw new Error(`PDF: unexpected ${token.kind} ${token.value}`);
}

// Folds `num gen R` triples inside arrays and dictionaries into references
function resolveRefs(items: PdfValue[]): PdfValue[] {
  const out: PdfValue[] = [];
  for (const item of items) {
    if (typeof item === "object" && item !== null && (item as { type: string }).type === "keyword-R") {
      const gen = out.pop();
      const num = out.pop();
      if (typeof num !== "number" || typeof gen !== "number") throw new Error("PDF: R without two integers");
      out.push({ type: "ref", num, gen });
    } else out.push(item);
  }
  return out;
}

export const isName = (v: PdfValue | undefined): v is { type: "name"; value: string } => typeof v === "object" && v !== null && v.type === "name";
export const isDict = (v: PdfValue | undefined): v is PdfDict => typeof v === "object" && v !== null && v.type === "dict";
export const isRef = (v: PdfValue | undefined): v is { type: "ref"; num: number; gen: number } => typeof v === "object" && v !== null && v.type === "ref";
export const isStream = (v: PdfValue | undefined): v is PdfStream => typeof v === "object" && v !== null && v.type === "stream";
export const isArray = (v: PdfValue | undefined): v is { type: "array"; items: PdfValue[] } => typeof v === "object" && v !== null && v.type === "array";

export interface XrefEntry {
  /** The 20 bytes of the entry as they appear in the file. */
  readonly raw: string;
  readonly offset: number;
  readonly gen: number;
  readonly inUse: boolean;
}

export interface PdfFile {
  readonly bytes: Uint8Array;
  /** The whole file as latin1 text, for searching. */
  readonly text: string;
  readonly version: string;
  readonly startxref: number;
  readonly xref: { readonly start: number; readonly entries: XrefEntry[] }[];
  readonly trailer: PdfDict;
  /** Object `num` (generation 0), parsed from the offset the table gives. */
  object(num: number): PdfValue;
  /** Follows references until a direct value. */
  resolve(value: PdfValue | undefined): PdfValue | undefined;
  /** Every reference found in any object of the file. */
  references(): { num: number; gen: number }[];
}

/** Parses a classic PDF; throws on a cross-reference stream or an offset that does not hold its object. */
export function readPdf(input: Uint8Array): PdfFile {
  const bytes = input;
  const text = latin1(bytes);
  const header = /^%PDF-(\d\.\d)/.exec(text);
  if (!header) throw new Error("PDF: no %PDF- header");
  const sx = text.lastIndexOf("startxref");
  if (sx < 0) throw new Error("PDF: no startxref");
  const startxref = Number(/^startxref\s+(\d+)/.exec(text.slice(sx))?.[1]);
  if (!Number.isInteger(startxref)) throw new Error("PDF: bad startxref");
  if (!text.startsWith("xref", startxref)) throw new Error("PDF: startxref does not point at a classic xref table (cross-reference streams are not supported)");

  // The table: "xref" EOL, then subsections "start count" EOL followed by 20-byte entries
  let pos = startxref + 4;
  const eol = (): void => {
    if (text[pos] === "\r") pos++;
    if (text[pos] === "\n") pos++;
  };
  eol();
  const xref: { start: number; entries: XrefEntry[] }[] = [];
  for (;;) {
    const line = /^(\d+) (\d+)[ ]?(\r\n|\n|\r)/.exec(text.slice(pos, pos + 40));
    if (!line) break;
    pos += line[0].length;
    const start = Number(line[1]);
    const count = Number(line[2]);
    const entries: XrefEntry[] = [];
    for (let k = 0; k < count; k++) {
      const raw = text.slice(pos, pos + 20);
      const m = /^(\d{10}) (\d{5}) ([nf])( \r| \n|\r\n)$/.exec(raw);
      if (!m) throw new Error(`PDF: xref entry ${start + k} is not 20 bytes in the standard form: ${JSON.stringify(raw)}`);
      entries.push({ raw, offset: Number(m[1]), gen: Number(m[2]), inUse: m[3] === "n" });
      pos += 20;
    }
    xref.push({ start, entries });
  }
  if (!text.startsWith("trailer", pos)) throw new Error("PDF: no trailer after the xref table");
  const trailerLexer = new Lexer(bytes, pos + "trailer".length);
  const trailer = parseValue(trailerLexer);
  if (!isDict(trailer)) throw new Error("PDF: trailer is not a dictionary");

  const offsets = new Map<number, XrefEntry>();
  for (const section of xref) section.entries.forEach((entry, k) => offsets.set(section.start + k, entry));
  const cache = new Map<number, PdfValue>();

  const object = (num: number): PdfValue => {
    if (cache.has(num)) return cache.get(num) as PdfValue;
    const entry = offsets.get(num);
    if (!entry || !entry.inUse) throw new Error(`PDF: object ${num} is not in use`);
    const lexer = new Lexer(bytes, entry.offset);
    const a = lexer.next();
    const b = lexer.next();
    const c = lexer.next();
    if (a?.kind !== "value" || a.value !== num || b?.kind !== "value" || b.value !== entry.gen || c?.kind !== "keyword" || c.value !== "obj") {
      throw new Error(`PDF: the xref offset ${entry.offset} of object ${num} does not hold "${num} ${entry.gen} obj"`);
    }
    let value = parseValue(lexer);
    const after = lexer.next();
    if (after?.kind === "keyword" && after.value === "stream") {
      if (!isDict(value)) throw new Error(`PDF: stream ${num} without a dictionary`);
      let start = lexer.pos;
      if (bytes[start] === 13 && bytes[start + 1] === 10) start += 2;
      else if (bytes[start] === 10) start += 1;
      else throw new Error(`PDF: no EOL after "stream" in object ${num}`);
      const length = resolve(value.entries.Length);
      if (typeof length !== "number") throw new Error(`PDF: stream ${num} has no numeric /Length`);
      const raw = bytes.subarray(start, start + length);
      const rest = latin1(bytes.subarray(start + length, start + length + 12));
      if (!/^(\r\n|\n|\r)?endstream/.test(rest)) throw new Error(`PDF: /Length ${length} of stream ${num} does not end at "endstream"`);
      value = { type: "stream", dict: value, raw };
    } else if (!(after?.kind === "keyword" && after.value === "endobj")) {
      throw new Error(`PDF: object ${num} does not end with endobj`);
    }
    cache.set(num, value);
    return value;
  };

  const resolve = (value: PdfValue | undefined): PdfValue | undefined => {
    let v = value;
    for (let guard = 0; isRef(v); guard++) {
      if (guard > 32) throw new Error("PDF: reference loop");
      v = object(v.num);
    }
    return v;
  };

  const references = (): { num: number; gen: number }[] => {
    const found: { num: number; gen: number }[] = [];
    const walk = (v: PdfValue | undefined): void => {
      if (isRef(v)) found.push({ num: v.num, gen: v.gen });
      else if (isArray(v)) v.items.forEach(walk);
      else if (isDict(v)) Object.values(v.entries).forEach(walk);
      else if (isStream(v)) walk(v.dict);
    };
    walk(trailer);
    for (const [num, entry] of offsets) if (entry.inUse) walk(object(num));
    return found;
  };

  return { bytes, text, version: header[1], startxref, xref, trailer, object, resolve, references };
}

/** A stream's data: raw when unfiltered, inflated when FlateDecode; other filters throw. */
export function decodeStream(stream: PdfStream): Uint8Array {
  const filter = stream.dict.entries.Filter;
  if (filter === undefined) return stream.raw;
  const name = isName(filter) ? filter.value : isArray(filter) && filter.items.length === 1 && isName(filter.items[0]) ? filter.items[0].value : null;
  if (name === "FlateDecode") return new Uint8Array(inflateSync(stream.raw));
  throw new Error(`PDF: unsupported filter ${JSON.stringify(filter)}`);
}

/** A fill or stroke colour: its operator's colour space and components. */
export interface Colour {
  readonly space: "gray" | "rgb" | "cmyk" | string;
  readonly components: number[];
}

export type Point = readonly [number, number];

export interface Fill {
  readonly colour: Colour;
  /** One subpath, in page coordinates. */
  readonly points: Point[];
}

export interface Stroke {
  readonly colour: Colour;
  readonly points: Point[];
}

export interface TextRun {
  /** The font resource name given to Tf, such as "F1". */
  readonly font: string;
  /** Tf size times the vertical scale of the text matrix and the CTM. */
  readonly size: number;
  /** The text origin in page coordinates. */
  readonly x: number;
  readonly y: number;
  readonly bytes: Uint8Array;
  /** The bytes decoded as WinAnsi. */
  readonly text: string;
}

export interface PageContent {
  readonly fills: Fill[];
  readonly strokes: Stroke[];
  readonly texts: TextRun[];
}

type Matrix = [number, number, number, number, number, number];
const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0];

/** m1 × m2 in PDF's row-vector convention: apply m1 first, then m2. */
const multiply = (m1: Matrix, m2: Matrix): Matrix => [
  m1[0] * m2[0] + m1[1] * m2[2],
  m1[0] * m2[1] + m1[1] * m2[3],
  m1[2] * m2[0] + m1[3] * m2[2],
  m1[2] * m2[1] + m1[3] * m2[3],
  m1[4] * m2[0] + m1[5] * m2[2] + m2[4],
  m1[4] * m2[1] + m1[5] * m2[3] + m2[5],
];
const apply = (m: Matrix, x: number, y: number): Point => [x * m[0] + y * m[2] + m[4], x * m[1] + y * m[3] + m[5]];

/** WinAnsi for the bytes a caption uses: ASCII, and Latin-1 above 0xA0 (0xB7 ·, 0xD7 ×). */
export const winAnsi = (bytes: Uint8Array): string => Array.from(bytes, (b) => String.fromCharCode(b)).join("");

/** Interprets a page content stream: paths and their painting, colours, and text showing. */
export function interpretContent(content: Uint8Array): PageContent {
  const lexer = new Lexer(content);
  const fills: Fill[] = [];
  const strokes: Stroke[] = [];
  const texts: TextRun[] = [];
  type State = { ctm: Matrix; fill: Colour; stroke: Colour };
  let state: State = { ctm: IDENTITY, fill: { space: "gray", components: [0] }, stroke: { space: "gray", components: [0] } };
  const stack: State[] = [];
  let subpaths: Point[][] = [];
  let current: Point[] | null = null;
  let tm: Matrix = IDENTITY;
  let tlm: Matrix = IDENTITY;
  let font = "";
  let fontSize = 0;
  let leading = 0;
  let operands: PdfValue[] = [];

  const nums = (count: number): number[] => {
    const values = operands.slice(-count);
    if (values.length !== count || values.some((v) => typeof v !== "number")) throw new Error(`PDF content: expected ${count} numbers`);
    return values as number[];
  };
  const point = (x: number, y: number): Point => apply(state.ctm, x, y);
  const paint = (fill: boolean, stroke: boolean): void => {
    for (const path of subpaths) {
      if (path.length === 0) continue;
      if (fill) fills.push({ colour: state.fill, points: path });
      if (stroke) strokes.push({ colour: state.stroke, points: path });
    }
    subpaths = [];
    current = null;
  };
  const show = (strings: Uint8Array[]): void => {
    const bytes = Uint8Array.from(strings.flatMap((s) => Array.from(s)));
    const m = multiply(tm, state.ctm);
    const [x, y] = apply(m, 0, 0);
    texts.push({ font, size: fontSize * Math.hypot(m[2], m[3]), x, y, bytes, text: winAnsi(bytes) });
  };
  const nextLine = (): void => {
    tlm = multiply([1, 0, 0, 1, 0, -leading], tlm);
    tm = tlm;
  };
  const stringOperand = (v: PdfValue | undefined): Uint8Array => {
    if (typeof v === "object" && v !== null && v.type === "string") return v.bytes;
    throw new Error("PDF content: expected a string");
  };

  for (let token = lexer.next(); token; token = lexer.next()) {
    if (token.kind !== "keyword") {
      operands.push(parseValue(lexer, token));
      continue;
    }
    const op = token.value;
    switch (op) {
      case "q":
        stack.push({ ...state });
        break;
      case "Q":
        state = stack.pop() ?? state;
        break;
      case "cm":
        state = { ...state, ctm: multiply(nums(6) as Matrix, state.ctm) };
        break;
      case "m": {
        const [x, y] = nums(2);
        current = [point(x, y)];
        subpaths.push(current);
        break;
      }
      case "l":
      case "c":
      case "v":
      case "y": {
        const n = op === "l" ? 2 : op === "c" ? 6 : 4;
        const values = nums(n);
        if (!current) throw new Error(`PDF content: ${op} without a current point`);
        current.push(point(values[n - 2], values[n - 1]));
        break;
      }
      case "h":
        current = null;
        break;
      case "re": {
        const [x, y, w, h] = nums(4);
        subpaths.push([point(x, y), point(x + w, y), point(x + w, y + h), point(x, y + h)]);
        current = null;
        break;
      }
      case "f":
      case "F":
      case "f*":
        paint(true, false);
        break;
      case "S":
      case "s":
        paint(false, true);
        break;
      case "B":
      case "B*":
      case "b":
      case "b*":
        paint(true, true);
        break;
      case "n":
        paint(false, false);
        break;
      case "g":
        state = { ...state, fill: { space: "gray", components: nums(1) } };
        break;
      case "G":
        state = { ...state, stroke: { space: "gray", components: nums(1) } };
        break;
      case "rg":
        state = { ...state, fill: { space: "rgb", components: nums(3) } };
        break;
      case "RG":
        state = { ...state, stroke: { space: "rgb", components: nums(3) } };
        break;
      case "k":
        state = { ...state, fill: { space: "cmyk", components: nums(4) } };
        break;
      case "K":
        state = { ...state, stroke: { space: "cmyk", components: nums(4) } };
        break;
      case "cs":
      case "CS": {
        const name = operands[operands.length - 1];
        const space = isName(name) ? name.value : "?";
        if (op === "cs") state = { ...state, fill: { space, components: [] } };
        else state = { ...state, stroke: { space, components: [] } };
        break;
      }
      case "sc":
      case "scn":
      case "SC":
      case "SCN": {
        const components = operands.filter((v): v is number => typeof v === "number");
        if (op === "sc" || op === "scn") state = { ...state, fill: { space: state.fill.space, components } };
        else state = { ...state, stroke: { space: state.stroke.space, components } };
        break;
      }
      case "BT":
        tm = IDENTITY;
        tlm = IDENTITY;
        break;
      case "ET":
        break;
      case "Tf": {
        const name = operands[operands.length - 2];
        font = isName(name) ? name.value : "";
        fontSize = nums(1)[0];
        break;
      }
      case "TL":
        leading = nums(1)[0];
        break;
      case "Tm":
        tm = nums(6) as Matrix;
        tlm = tm;
        break;
      case "Td":
      case "TD": {
        const [tx, ty] = nums(2);
        if (op === "TD") leading = -ty;
        tlm = multiply([1, 0, 0, 1, tx, ty], tlm);
        tm = tlm;
        break;
      }
      case "T*":
        nextLine();
        break;
      case "Tj":
        show([stringOperand(operands[operands.length - 1])]);
        break;
      case "TJ": {
        const array = operands[operands.length - 1];
        if (!isArray(array)) throw new Error("PDF content: TJ without an array");
        show(array.items.filter((v) => typeof v === "object" && v !== null && v.type === "string").map(stringOperand));
        break;
      }
      case "'":
        nextLine();
        show([stringOperand(operands[operands.length - 1])]);
        break;
      case '"':
        nextLine();
        show([stringOperand(operands[operands.length - 1])]);
        break;
      default:
        // Operators that do not affect what is checked here (line width, graphics state, …)
        break;
    }
    operands = [];
  }
  return { fills, strokes, texts };
}

/** Whether a colour is black: 0 g, 0 0 0 rg or 0 0 0 1 k. */
export const isBlack = (c: Colour): boolean =>
  (c.space === "gray" && c.components[0] === 0) ||
  (c.space === "rgb" && c.components.every((v) => v === 0)) ||
  (c.space === "cmyk" && c.components[0] === 0 && c.components[1] === 0 && c.components[2] === 0 && c.components[3] === 1);

/** Whether a colour is white: 1 g, 1 1 1 rg or 0 0 0 0 k. */
export const isWhite = (c: Colour): boolean =>
  (c.space === "gray" && c.components[0] === 1) ||
  (c.space === "rgb" && c.components.every((v) => v === 1)) ||
  (c.space === "cmyk" && c.components.every((v) => v === 0));

/** The axis-aligned bounding box of some points. */
export function bounds(points: readonly Point[]): { x0: number; y0: number; x1: number; y1: number } {
  const xs = points.map((p) => p[0]);
  const ys = points.map((p) => p[1]);
  return { x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys) };
}

/** Whether a polygon is an axis-aligned rectangle (4 corners, each edge horizontal or vertical). */
export function isAxisAlignedRect(points: readonly Point[], tolerance = 1e-6): boolean {
  if (points.length !== 4) return false;
  for (let k = 0; k < 4; k++) {
    const [ax, ay] = points[k];
    const [bx, by] = points[(k + 1) % 4];
    if (Math.abs(ax - bx) > tolerance && Math.abs(ay - by) > tolerance) return false;
  }
  const b = bounds(points);
  return b.x1 - b.x0 > tolerance && b.y1 - b.y0 > tolerance;
}

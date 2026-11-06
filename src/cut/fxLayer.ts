// The engine's effect layer on a real element: an SVG with the rim (inner shadow, glow and core),
// the ripples, the knife's stroke and the wand's tip, and a canvas with the gold dust.
// Colours are set as style properties, because SVG presentation attributes cannot read CSS variables.
// Contract: docs/design_space_cut.md §4, §5.2.

import { COLORS } from "./constants";
import { createDustCanvas } from "./dust";
import type { CutRenderer, RimStyle } from "./engine";
import type { Pt } from "./geometry";

const SVG_NS = "http://www.w3.org/2000/svg";
let layers = 0;

const pathOf = (pts: readonly Pt[], closed: boolean) =>
  pts.length ? `M${pts.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join("L")}${closed ? "Z" : ""}` : "";

/** Builds the layer inside fx, which must be positioned and sized by its owner. */
export function createFxLayer(fx: HTMLElement): CutRenderer {
  const id = `cut-fx-${++layers}`;
  const make = <K extends keyof SVGElementTagNameMap>(tag: K, parent: Element | null, attrs: Record<string, string> = {}, style: Partial<CSSStyleDeclaration> = {}) => {
    const node = document.createElementNS(SVG_NS, tag);
    for (const [name, value] of Object.entries(attrs)) node.setAttribute(name, value);
    Object.assign(node.style, style);
    parent?.appendChild(node);
    return node;
  };

  const svg = make("svg", null, { "aria-hidden": "true", focusable: "false" });
  svg.style.cssText = "position:absolute;inset:0;width:100%;height:100%;overflow:visible;pointer-events:none";
  const defs = make("defs", svg);
  const clipPath = make("path", make("clipPath", defs, { id: `${id}-clip` }));
  const glow = make("radialGradient", defs, { id: `${id}-tip` });
  for (const [offset, color, opacity] of [
    ["0", "#fff3d6", "0.95"],
    ["0.3", "#fbbf6a", "0.45"],
    ["1", "#fbbf6a", "0"],
  ]) {
    make("stop", glow, { offset, "stop-color": color, "stop-opacity": opacity });
  }

  // The rim: a dark inner shadow clipped to the window, then a soft glow and a bright core along the edge
  const rim = make("g", svg);
  const shadow = make("g", rim, { "clip-path": `url(#${id}-clip)` });
  const shadows = (
    [
      [34, 0.16],
      [18, 0.2],
      [7, 0.3],
    ] as const
  ).map(([width, opacity]) => make("path", shadow, { fill: "none", stroke: "#000", "stroke-opacity": String(opacity), "stroke-width": String(width) }));
  const rimGlow = make("path", rim, { fill: "none", "stroke-linejoin": "round" });
  const rimCore = make("path", rim, { fill: "none", "stroke-linejoin": "round" });

  const ripples = [0, 1, 2].map(() => make("circle", svg, { fill: "none", r: "0", "stroke-width": "1.2" }, { stroke: COLORS.wand, opacity: "0" }));

  const stroke = make("g", svg, {}, { opacity: "0" });
  const line = { fill: "none", "stroke-linecap": "round", "stroke-linejoin": "round" };
  const strokeGlow = make("path", stroke, { ...line, "stroke-opacity": "0.16", "stroke-width": "9" }, { stroke: COLORS.knife });
  const strokeMid = make("path", stroke, { ...line, "stroke-opacity": "0.4", "stroke-width": "3.2" }, { stroke: COLORS.knife });
  const strokeCore = make("path", stroke, { ...line, "stroke-width": "1.3" }, { stroke: COLORS.strokeCore });
  const strokePaths = [strokeGlow, strokeMid, strokeCore];

  const tip = make("g", svg, {}, { opacity: "0" });
  const tipGlow = make("circle", tip, { r: "0", fill: `url(#${id}-tip)` });
  const tipDot = make("circle", tip, { r: "0" }, { fill: COLORS.wandCore });

  const canvas = document.createElement("canvas");
  canvas.setAttribute("aria-hidden", "true");
  canvas.style.cssText = "position:absolute;inset:0;width:100%;height:100%;pointer-events:none";
  fx.append(svg, canvas);
  const dust = createDustCanvas(canvas);
  const fit = () => dust.resize(fx.clientWidth, fx.clientHeight);
  const observer = new ResizeObserver(fit);
  observer.observe(fx);
  fit();

  // A token per stroke update, so a fade that finishes late does not clear a newer stroke
  let strokeToken = 0;
  let fadeTimer: ReturnType<typeof setTimeout> | undefined;

  return {
    size: () => ({ width: fx.clientWidth, height: fx.clientHeight }),

    stroke(points, opacity = 1, glowBoost = 1) {
      strokeToken++;
      const d = points ? pathOf(points, false) : "";
      for (const p of strokePaths) p.setAttribute("d", d);
      stroke.style.transition = "none";
      stroke.style.opacity = points ? String(opacity) : "0";
      strokeGlow.setAttribute("stroke-width", String(9 * glowBoost));
    },

    fadeStroke(ms) {
      const token = ++strokeToken;
      void stroke.getBoundingClientRect(); // start the transition from the current opacity
      stroke.style.transition = `opacity ${ms}ms ease`;
      stroke.style.opacity = "0";
      clearTimeout(fadeTimer);
      fadeTimer = setTimeout(() => {
        if (token === strokeToken) for (const p of strokePaths) p.setAttribute("d", "");
      }, ms + 60);
    },

    rim(polygon, style?: RimStyle) {
      const d = polygon ? pathOf(polygon, true) : "";
      for (const p of [...shadows, rimGlow, rimCore, clipPath]) p.setAttribute("d", d);
      if (!polygon || !style) return;
      const clamp01 = (v: number) => String(Math.min(1, Math.max(0, v)));
      shadow.style.opacity = clamp01(style.shadow);
      rimGlow.style.opacity = clamp01(style.glow);
      rimCore.style.opacity = clamp01(style.core);
      rimGlow.style.stroke = style.gold ? COLORS.wand : COLORS.knife;
      rimGlow.setAttribute("stroke-opacity", style.gold ? "0.3" : "0.22");
      rimGlow.setAttribute("stroke-width", style.gold ? "8" : "6");
      rimCore.style.stroke = style.gold ? COLORS.wandCore : COLORS.knifeCore;
      rimCore.setAttribute("stroke-width", style.gold ? "1.3" : "1.1");
    },

    tip(p, dotRadius = 0, glowRadius = 0, alpha = 1) {
      if (!p) {
        tip.style.opacity = "0";
        return;
      }
      for (const c of [tipGlow, tipDot]) {
        c.setAttribute("cx", p[0].toFixed(1));
        c.setAttribute("cy", p[1].toFixed(1));
      }
      tipDot.setAttribute("r", Math.max(0, dotRadius).toFixed(1));
      tipGlow.setAttribute("r", Math.max(0, glowRadius).toFixed(1));
      tipGlow.style.opacity = String(Math.min(1, Math.max(0, alpha)));
      tip.style.opacity = "1";
    },

    ripples(list) {
      ripples.forEach((circle, i) => {
        const q = list[i];
        if (!q) {
          circle.style.opacity = "0";
          return;
        }
        circle.setAttribute("cx", q.p[0].toFixed(1));
        circle.setAttribute("cy", q.p[1].toFixed(1));
        circle.setAttribute("r", Math.max(0, q.r).toFixed(1));
        circle.style.opacity = String(q.alpha);
      });
    },

    dust: (particles) => dust.draw(particles),

    destroy() {
      clearTimeout(fadeTimer);
      observer.disconnect();
      svg.remove();
      canvas.remove();
    },
  };
}

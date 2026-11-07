// Project card to detail page (docs/design_space_cut.md §6.6, D7; requirements F14): the pair's names,
// and the CSS that keeps the morph from clashing with the page-change cut (§12.1).

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { COVER_MORPH_CLASS, COVER_SHARE, COVER_TYPE, coverTransitionName, isDetailPath, morphsOnTraverse } from "@/cut/coverMorph";
import { CUT_TYPE, FADE_TYPE } from "@/cut/pageCut";
import { SRC_DIR } from "../ar/helpers/sourceScan";

// A <custom-ident> in ASCII: no leading digit, and not one of the keywords view-transition-name reserves
const IDENT = /^-?[A-Za-z_][A-Za-z0-9_-]*$/;
const RESERVED = new Set(["none", "auto", "match-element", "initial", "inherit", "unset", "revert", "revert-layer", "default"]);

describe("coverTransitionName", () => {
  it("keeps letters, digits and hyphens", () => {
    expect(coverTransitionName("SceneGraph-AR")).toBe("cover-SceneGraph-AR");
    expect(coverTransitionName("portfolio")).toBe("cover-portfolio");
  });

  it("escapes what a CSS name cannot hold, so every GitHub repository name works", () => {
    for (const slug of ["ZJUCao.github.io", "3d-viewer", "my_repo", "a.b_c", "-x", "none", "auto", "数据", "a b"]) {
      const name = coverTransitionName(slug);
      expect(name, slug).toMatch(IDENT);
      expect(RESERVED.has(name), slug).toBe(false);
    }
    expect(coverTransitionName("ZJUCao.github.io")).toBe("cover-ZJUCao_2e_github_2e_io");
  });

  it("gives different slugs different names", () => {
    const slugs = ["a.b", "a_b", "a-b", "a_2e_b", "ab", "A.b", "a..b", "a_2e__2e_b"];
    expect(new Set(slugs.map(coverTransitionName)).size).toBe(slugs.length);
  });
});

describe("COVER_SHARE", () => {
  it("pairs the covers only in a navigation of the cover type", () => {
    expect(COVER_SHARE).toEqual({ [COVER_TYPE]: COVER_MORPH_CLASS, default: "none" });
  });

  it("has a type of its own, apart from the cut's", () => {
    expect(new Set([COVER_TYPE, CUT_TYPE, FADE_TYPE]).size).toBe(3);
  });
});

describe("morphsOnTraverse (Back and Forward)", () => {
  it("knows a detail page by its path", () => {
    expect(isDetailPath("/en/projects/SceneGraph-AR")).toBe(true);
    expect(isDetailPath("/zh/projects/ZJUCao.github.io/")).toBe(true);
    for (const path of ["/en", "/en/projects", "/en/projects/", "/en/about", "/en/projects/a/b"]) expect(isDetailPath(path), path).toBe(false);
  });

  it("morphs going back from a detail page to a page with cards, and forward again", () => {
    expect(morphsOnTraverse("/en/projects/NutriScan", "/en/projects")).toBe(true);
    expect(morphsOnTraverse("/en/projects", "/en/projects/NutriScan")).toBe(true);
    expect(morphsOnTraverse("/zh/projects/NutriScan", "/zh")).toBe(true);
  });

  it("stays plain between two detail pages, two card pages, or two languages", () => {
    expect(morphsOnTraverse("/en/projects/NutriScan", "/en/projects/portfolio")).toBe(false);
    expect(morphsOnTraverse("/en/projects", "/en")).toBe(false);
    expect(morphsOnTraverse("/en", "/en/about")).toBe(false);
    // back across a language switch: the cut's page, not the morph
    expect(morphsOnTraverse("/en/projects/NutriScan", "/zh/projects")).toBe(false);
    expect(morphsOnTraverse("/zh/projects/NutriScan", "/en/projects/NutriScan")).toBe(false);
  });
});

describe("the two ends", () => {
  const source = (...path: string[]) => readFileSync(join(SRC_DIR, ...path), "utf8");

  it("are the same cover on the card and on the detail page, and both links carry the type", () => {
    const card = source("components", "ProjectCard.tsx");
    const detail = source("app", "[lang]", "projects", "[slug]", "page.tsx");
    for (const file of [card, detail]) {
      expect(file).toMatch(/<ProjectCover\b/);
      expect(file).toMatch(/<CoverLink\b/);
    }
    expect(source("components", "CoverLink.tsx")).toContain("transitionTypes={[COVER_TYPE]}");
    // the header image sits outside any Reveal (§2): its cover is not inside a <Reveal> … </Reveal>
    const header = detail.slice(detail.indexOf("<header"), detail.indexOf("<ProjectCover"));
    expect(header.split("<Reveal").length).toBe(header.split("</Reveal>").length);
  });
});

describe("globals.css", () => {
  const css = readFileSync(join(SRC_DIR, "app", "globals.css"), "utf8");
  const rules = (selector: RegExp) => [...css.matchAll(new RegExp(`${selector.source}[^{]*\\{([^}]*)\\}`, "g"))].map((m) => m[0]);

  it("swaps the page at once in every transition but the cut's own two types", () => {
    const notCut = `html:not(:active-view-transition-type(${CUT_TYPE}, ${FADE_TYPE}))`;
    for (const part of ["group", "old", "new"]) expect(css).toContain(`${notCut}::view-transition-${part}(root)`);
    // the cut's own rules are untouched: its old page stays, its reduce-motion crossfade still runs 200 ms
    expect(css).toContain(`html:active-view-transition-type(${CUT_TYPE})::view-transition-old(root)`);
    expect(css).toContain(`html:active-view-transition-type(${FADE_TYPE})::view-transition-new(root)`);
  });

  it("times the morph by the class the pair carries, and stills it under reduce motion", () => {
    const morph = rules(new RegExp(`::view-transition-group\\(\\.${COVER_MORPH_CLASS}\\)`));
    expect(morph.length).toBe(2);
    expect(morph[0]).toMatch(/animation-duration:\s*400ms/);
    const reduced = css.slice(css.lastIndexOf("@media (prefers-reduced-motion: reduce)"));
    expect(reduced).toMatch(new RegExp(`::view-transition-group\\(\\.${COVER_MORPH_CLASS}\\)\\s*\\{[^}]*animation-name:\\s*none`));
  });
});

// Back and Forward for the card-to-detail morph (docs/design_space_cut.md §13, P5): which traversals start
// a cover transition, and the flag that lets the page a cover shrinks back into skip its Reveal fade-in.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { arrived, arrivingWithCover, markCoverArrival, setTouch, showing, traversal } from "@/cut/coverHistory";

const touch = () => {};

beforeEach(() => {
  arrived();
  setTouch(touch);
});

describe("traversal", () => {
  it("morphs Back from a detail page to the list or the home page, and Forward again", () => {
    showing("/en/projects/NutriScan");
    expect(traversal("/en/projects")).toBe(touch);
    expect(traversal("/en")).toBe(touch);
    showing("/zh/projects");
    expect(traversal("/zh/projects/NutriScan")).toBe(touch);
  });

  it("stays plain between two detail pages, two card pages, or across a language switch", () => {
    showing("/en/projects/NutriScan");
    expect(traversal("/en/projects/portfolio")).toBeNull();
    expect(traversal("/zh/projects")).toBeNull();
    showing("/en/projects");
    expect(traversal("/en")).toBeNull();
  });

  it("does nothing before the page has mounted CoverHistory", () => {
    showing("/en/projects/NutriScan");
    setTouch(null);
    expect(traversal("/en/projects")).toBeNull();
  });
});

describe("the arrival flag", () => {
  afterEach(() => vi.useRealTimers());

  it("is raised by Back onto a page with cards, not by Forward onto a detail page", () => {
    showing("/en/projects/NutriScan");
    traversal("/en/projects");
    expect(arrivingWithCover()).toBe(true);
    arrived();
    showing("/en/projects");
    traversal("/en/projects/NutriScan");
    expect(arrivingWithCover()).toBe(false);
  });

  it("lapses on its own if no Reveal takes it", () => {
    vi.useFakeTimers();
    markCoverArrival();
    expect(arrivingWithCover()).toBe(true);
    vi.advanceTimersByTime(2000);
    expect(arrivingWithCover()).toBe(false);
  });
});

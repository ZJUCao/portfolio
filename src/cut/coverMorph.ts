// Project card to detail page (docs/design_space_cut.md §6.6, D7; requirements F14, D6). Not a cut:
// everyday navigation stays fast, so the card's cover only grows into the detail page's header image,
// a shared-element pair of React <ViewTransition>s that both use these names.

/** view-transition-class of the pair; globals.css sets its timing and keeps the rest of the page still. */
export const COVER_MORPH_CLASS = "cover-morph";

/**
 * Transition type of the navigations that morph: the card's link, the detail page's link back to the
 * list, and the browser's Back and Forward into or out of a detail page (morphsOnTraverse). Anything
 * else (header links, the project filter's Suspense swapping its fallback on load) pairs nothing and
 * stays a plain switch (§13, P5).
 */
export const COVER_TYPE = "cover";

/** Whether a path is a project detail page, /<lang>/projects/<slug>. */
export const isDetailPath = (path: string) => /^\/[^/]+\/projects\/[^/]+\/?$/.test(path);

/**
 * Whether a Back or Forward traversal from one path to another carries COVER_TYPE: it enters or leaves
 * a detail page, but not both, within one language. Next gives traversals no type of their own, so the
 * site adds it (src/cut/coverHistory.ts, src/instrumentation-client.ts). Between two card pages (the home page and the list)
 * it stays plain, or every card would fly to its place on the other page.
 */
export function morphsOnTraverse(from: string, to: string): boolean {
  if (from.split("/")[1] !== to.split("/")[1]) return false;
  return isDetailPath(from) !== isDetailPath(to);
}

/** The <ViewTransition share> of both ends: the morph's class under COVER_TYPE, nothing otherwise. */
export const COVER_SHARE = { [COVER_TYPE]: COVER_MORPH_CLASS, default: "none" } as const;

/**
 * The pair's view-transition-name. A slug is a GitHub repository name (letters, digits, "-", "_" and
 * "."), but a name has to be a CSS <custom-ident>, so every character other than a letter, a digit or
 * "-" is written as _hex_. No two slugs get the same name.
 */
export function coverTransitionName(slug: string): string {
  let name = "cover-";
  for (const ch of slug) name += /[A-Za-z0-9-]/.test(ch) ? ch : `_${(ch.codePointAt(0) ?? 0).toString(16)}_`;
  return name;
}

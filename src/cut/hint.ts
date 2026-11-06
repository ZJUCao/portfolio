// The wand's "hold" hint is shown once; after that a flag in local storage keeps it away (Q5).
// Every read and write is guarded: private browsing, blocked site data or a missing storage only
// mean the hint may show again. No DOM, no React. Contract: docs/design_space_cut.md §4.

export const HOLD_HINT_KEY = "space-cut-hold-hint";

type Store = Pick<Storage, "getItem" | "setItem">;

function browserStore(): Store | null {
  try {
    return (globalThis as { localStorage?: Store }).localStorage ?? null;
  } catch {
    return null; // reading localStorage itself can throw when site data is blocked
  }
}

/** Whether the hint has been seen in this browser. */
export function holdHintSeen(store: Store | null = browserStore()): boolean {
  try {
    return store?.getItem(HOLD_HINT_KEY) === "1";
  } catch {
    return false;
  }
}

/** Remembers that the hint has been seen; does nothing when storage is unavailable. */
export function markHoldHintSeen(store: Store | null = browserStore()): void {
  try {
    store?.setItem(HOLD_HINT_KEY, "1");
  } catch {
    // full or blocked storage: the hint may show once more next time
  }
}

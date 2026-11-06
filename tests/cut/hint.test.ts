// The wand's "hold" hint is remembered once seen, and missing storage never throws (Q5, design §8).

import { describe, expect, it } from "vitest";
import { HOLD_HINT_KEY, holdHintSeen, markHoldHintSeen } from "@/cut/hint";

const memory = () => {
  const data = new Map<string, string>();
  return { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => void data.set(k, v), data };
};

describe("hold hint", () => {
  it("is unseen at first and seen after it is marked", () => {
    const store = memory();
    expect(holdHintSeen(store)).toBe(false);
    markHoldHintSeen(store);
    expect(store.data.get(HOLD_HINT_KEY)).toBe("1");
    expect(holdHintSeen(store)).toBe(true);
  });

  it("does not throw without local storage (Node has none) and counts as unseen", () => {
    expect(() => markHoldHintSeen()).not.toThrow();
    expect(holdHintSeen()).toBe(false);
    expect(holdHintSeen(null)).toBe(false);
  });

  it("does not throw when storage refuses reads or writes", () => {
    const broken = {
      getItem: () => {
        throw new Error("SecurityError");
      },
      setItem: () => {
        throw new Error("QuotaExceededError");
      },
    };
    expect(holdHintSeen(broken)).toBe(false);
    expect(() => markHoldHintSeen(broken)).not.toThrow();
  });
});

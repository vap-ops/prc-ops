// Writing failing test first.
//
// keyboardInset: the px the on-screen (mobile) keyboard occludes at the bottom
// of the visual viewport. The soft keyboard shrinks the *visual* viewport but
// not the *layout* viewport, so a fixed / bottom-docked sheet is covered by
// `innerHeight - visualViewport.height - visualViewport.offsetTop`. Kept pure
// so the arithmetic is tested without a browser. (Distinct from spec 95's
// auto-zoom fix; this is the "keyboard covers a field inside a fixed sheet" case.)

import { describe, expect, it } from "vitest";

import { keyboardInset } from "@/lib/ui/keyboard-inset";

describe("keyboardInset", () => {
  it("is 0 when the visual viewport fills the window (no keyboard)", () => {
    expect(keyboardInset(844, 844, 0)).toBe(0);
  });

  it("equals the shrink when the keyboard pushes the visual viewport up", () => {
    // iPhone-ish: 844 tall window, keyboard takes 336 → visual viewport 508.
    expect(keyboardInset(844, 508, 0)).toBe(336);
  });

  it("subtracts a non-zero offsetTop (e.g. a pinned address bar) too", () => {
    // visual viewport 508 tall, shifted 20px down → 844 - 508 - 20 = 316.
    expect(keyboardInset(844, 508, 20)).toBe(316);
  });

  it("clamps sub-pixel / negative chrome jitter to 0", () => {
    expect(keyboardInset(844, 844.4, 0)).toBe(0);
    expect(keyboardInset(844, 900, 0)).toBe(0);
  });

  it("rounds to a whole pixel", () => {
    expect(keyboardInset(844, 507.6, 0)).toBe(336);
  });
});

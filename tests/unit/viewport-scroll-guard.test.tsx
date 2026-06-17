// Spec 95: on iOS the soft keyboard scrolls the documentElement to reveal the
// focused input and does NOT reset it on close (measured on device:
// document.scrollTop = window.scrollY = 389 with the keyboard already down). The
// body is locked (spec 64 overflow:hidden), so the document must always sit at
// scroll 0. ViewportScrollGuard forces it back to 0 when the keyboard is down —
// but never while the keyboard is up (iOS is revealing the input then).

import { render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ViewportScrollGuard } from "@/components/features/chrome/viewport-scroll-guard";

function setInnerHeight(px: number) {
  Object.defineProperty(window, "innerHeight", { configurable: true, value: px });
}

function mockVisualViewport(height: number) {
  const vv = {
    height,
    width: 375,
    offsetTop: 0,
    addEventListener: () => {},
    removeEventListener: () => {},
  };
  Object.defineProperty(window, "visualViewport", { configurable: true, value: vv });
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  document.documentElement.scrollTop = 0;
  document.body.innerHTML = "";
  Reflect.deleteProperty(window, "visualViewport");
});

describe("ViewportScrollGuard", () => {
  it("resets the document scroll to 0 when the keyboard closes (body is locked)", () => {
    vi.useFakeTimers();
    setInnerHeight(793);
    mockVisualViewport(744); // keyboard down: 793 - 744 = 49 < 100
    document.documentElement.scrollTop = 389; // iOS left it scrolled

    render(<ViewportScrollGuard />);
    document.dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
    vi.advanceTimersByTime(50);

    expect(document.documentElement.scrollTop).toBe(0);
  });

  it("does NOT reset while the keyboard is up (iOS is revealing the input)", () => {
    vi.useFakeTimers();
    setInnerHeight(793);
    mockVisualViewport(420); // keyboard up: 793 - 420 = 373 > 100
    document.documentElement.scrollTop = 389;

    render(<ViewportScrollGuard />);
    document.dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
    vi.advanceTimersByTime(50);

    expect(document.documentElement.scrollTop).toBe(389);
  });
});

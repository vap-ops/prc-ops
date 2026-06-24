// Writing failing test first.
//
// The body is locked (spec 64: <body overflow-hidden>) and PageShell's <main>
// (h-full overflow-y-auto) is the only scroller. h-full is the LAYOUT viewport
// height, which the soft keyboard does NOT shrink — so on every NON-sheet full
// page, <main> runs behind the keyboard and a focused field near the bottom of a
// long form is occluded with no room left to scroll it up. BottomSheet already
// fixes this for sheet forms (useKeyboardInset); KeyboardViewportFit is the same
// fix for the page scroller: cap <main> to the band above the keyboard and centre
// the focused field within it. No-op with the keyboard down / no VisualViewport.

import { render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { KeyboardViewportFit } from "@/components/features/chrome/keyboard-viewport-fit";

function setInnerHeight(px: number) {
  Object.defineProperty(window, "innerHeight", { configurable: true, value: px });
}

// A VisualViewport stand-in whose add/removeEventListener actually record
// handlers, so a test can fire "resize" the way iOS does as the keyboard slides.
function mockVisualViewport(height: number, offsetTop = 0) {
  const handlers: Record<string, Set<() => void>> = {};
  const vv = {
    height,
    width: 375,
    offsetTop,
    addEventListener: (type: string, fn: () => void) => {
      (handlers[type] ??= new Set()).add(fn);
    },
    removeEventListener: (type: string, fn: () => void) => {
      handlers[type]?.delete(fn);
    },
    fire: (type: string) => handlers[type]?.forEach((fn) => fn()),
  };
  Object.defineProperty(window, "visualViewport", { configurable: true, value: vv });
  return vv;
}

function addMain(): HTMLElement {
  const main = document.createElement("main");
  document.body.appendChild(main);
  return main;
}

beforeEach(() => {
  setInnerHeight(800);
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  document.body.innerHTML = "";
  Reflect.deleteProperty(window, "visualViewport");
});

describe("KeyboardViewportFit", () => {
  it("caps <main> to the band above the keyboard when one is up", () => {
    const main = addMain();
    mockVisualViewport(500); // 800 - 500 = 300px keyboard inset
    render(<KeyboardViewportFit />);
    // <main> should end at the keyboard top (innerHeight - inset = 500px).
    expect(main.style.height).toBe("500px");
  });

  it("clears the cap when the keyboard goes back down", () => {
    const main = addMain();
    const vv = mockVisualViewport(500);
    render(<KeyboardViewportFit />);
    expect(main.style.height).toBe("500px");

    vv.height = 770; // 800 - 770 = 30px < threshold → keyboard down
    vv.fire("resize");
    expect(main.style.height).toBe("");
  });

  it("applies no cap when no keyboard is up (visual viewport fills the window)", () => {
    const main = addMain();
    mockVisualViewport(800);
    render(<KeyboardViewportFit />);
    expect(main.style.height).toBe("");
  });

  it("is a no-op (no throw, no cap) when VisualViewport is unsupported", () => {
    const main = addMain();
    expect(() => render(<KeyboardViewportFit />)).not.toThrow();
    expect(main.style.height).toBe("");
  });

  it("centres a focused field within the capped scroller", () => {
    vi.useFakeTimers();
    addMain();
    const input = document.createElement("input");
    document.body.querySelector("main")!.appendChild(input);
    const scrollIntoView = vi.fn();
    input.scrollIntoView = scrollIntoView;

    mockVisualViewport(500);
    render(<KeyboardViewportFit />);

    input.dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
    vi.advanceTimersByTime(350);

    expect(scrollIntoView).toHaveBeenCalledWith({ block: "center" });
  });

  it("ignores focus on non-field elements (no scroll yank)", () => {
    vi.useFakeTimers();
    addMain();
    const button = document.createElement("button");
    document.body.querySelector("main")!.appendChild(button);
    const scrollIntoView = vi.fn();
    button.scrollIntoView = scrollIntoView;

    mockVisualViewport(500);
    render(<KeyboardViewportFit />);

    button.dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
    vi.advanceTimersByTime(350);

    expect(scrollIntoView).not.toHaveBeenCalled();
  });

  it("clears the inline cap on unmount", () => {
    const main = addMain();
    mockVisualViewport(500);
    const { unmount } = render(<KeyboardViewportFit />);
    expect(main.style.height).toBe("500px");
    unmount();
    expect(main.style.height).toBe("");
  });
});

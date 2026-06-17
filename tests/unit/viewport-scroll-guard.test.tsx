// Spec 95: on iOS standalone PWA the locked scroller (spec 64) is left UNPAINTED
// after the keyboard closes — content present but blank until a scroll forces a
// repaint (operator: "recovers on its own when I scroll"; รีเฟรช clears it). The
// guard reproduces that recovering scroll nudge on keyboard close — but never
// while the user is still editing another field.

import { render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ViewportScrollGuard } from "@/components/features/chrome/viewport-scroll-guard";

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  document.body.innerHTML = "";
});

function mountInMain() {
  const main = document.createElement("main");
  document.body.appendChild(main);
  const scrollBy = vi.fn();
  main.scrollBy = scrollBy;
  render(<ViewportScrollGuard />, { container: main });
  return { main, scrollBy };
}

describe("ViewportScrollGuard", () => {
  it("nudges the scroller to force a repaint after a field blurs (keyboard close)", () => {
    vi.useFakeTimers();
    const { scrollBy } = mountInMain();

    const input = document.createElement("input");
    document.body.appendChild(input);
    input.dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
    vi.advanceTimersByTime(150);

    expect(scrollBy).toHaveBeenCalledWith(0, 1);
  });

  it("does NOT nudge while another field is being edited (keyboard still up)", () => {
    vi.useFakeTimers();
    const { scrollBy } = mountInMain();

    const input = document.createElement("input");
    document.body.appendChild(input);
    input.focus(); // activeElement stays this input → still editing
    input.dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
    vi.advanceTimersByTime(150);

    expect(scrollBy).not.toHaveBeenCalled();
  });

  // The scroll nudge only repaints when <main> can actually scroll. A short form
  // that fits the viewport (no overflow) cannot scroll, so scrollBy moves nothing
  // and the locked scroller stays blank. Force a scroll-INDEPENDENT repaint too: a
  // 1px transform nudge on <main>, restored next frame — re-rasterizes regardless
  // of content height. This is the "freezes for good" recurrence (short forms).
  it("also applies a scroll-independent transform nudge, restored next frame", () => {
    vi.useFakeTimers();
    const rafs: FrameRequestCallback[] = [];
    vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
      rafs.push(cb);
      return rafs.length;
    });
    const { main } = mountInMain();

    const input = document.createElement("input");
    document.body.appendChild(input);
    input.dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
    vi.advanceTimersByTime(150);

    // nudge applied synchronously inside the repaint
    expect(main.style.transform).toBe("translateY(1px)");

    // and cleared on the next animation frame (net visual position unchanged)
    rafs.forEach((cb) => cb(0));
    expect(main.style.transform).toBe("");
  });
});

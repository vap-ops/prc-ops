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
});

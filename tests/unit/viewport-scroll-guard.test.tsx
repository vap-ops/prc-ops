// Writing failing test first.
//
// Spec 95: on iOS standalone PWA the locked document (spec 64) gets scrolled by
// WebKit to reveal the caret and stays offset after the keyboard closes. The
// guard snaps the document scroll back to 0 on keyboard close — but never while
// the user is still editing another field.

import { render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ViewportScrollGuard } from "@/components/features/viewport-scroll-guard";

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("ViewportScrollGuard", () => {
  it("resets the document scroll after a field blurs with nothing else focused", () => {
    vi.useFakeTimers();
    const scrollTo = vi.spyOn(window, "scrollTo").mockImplementation(() => {});
    render(<ViewportScrollGuard />);

    const input = document.createElement("input");
    document.body.appendChild(input);
    input.dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
    vi.advanceTimersByTime(150);

    expect(scrollTo).toHaveBeenCalledWith(0, 0);
    input.remove();
  });

  it("does NOT reset while another field is being edited (keyboard still up)", () => {
    vi.useFakeTimers();
    const scrollTo = vi.spyOn(window, "scrollTo").mockImplementation(() => {});
    render(<ViewportScrollGuard />);

    const input = document.createElement("input");
    document.body.appendChild(input);
    input.focus(); // activeElement stays this input → still editing
    input.dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
    vi.advanceTimersByTime(150);

    expect(scrollTo).not.toHaveBeenCalled();
    input.remove();
  });
});

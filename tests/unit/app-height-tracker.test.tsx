// Spec 95: iOS standalone PWA shrinks the web view for the soft keyboard and does
// NOT recompute the h-full (100%) height chain when it closes, so html/body/<main>
// stay at the keyboard-reduced height — the content the keyboard vacated is clipped
// and a blank gap is left at the bottom (operator screenshot). Pin html+body to the
// live window.innerHeight and re-apply on resize so the keyboard-close resize
// restores the full height. No transform (would reparent fixed chrome), no scroll.

import { render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { AppHeightTracker } from "@/components/features/chrome/app-height-tracker";

function setInnerHeight(px: number) {
  Object.defineProperty(window, "innerHeight", { configurable: true, value: px });
}

afterEach(() => {
  document.documentElement.style.height = "";
  document.body.style.height = "";
  document.body.innerHTML = "";
});

describe("AppHeightTracker", () => {
  it("pins html + body height to window.innerHeight on mount", () => {
    setInnerHeight(820);
    render(<AppHeightTracker />);
    expect(document.documentElement.style.height).toBe("820px");
    expect(document.body.style.height).toBe("820px");
  });

  it("re-applies the restored height on resize (the keyboard-close fix)", () => {
    setInnerHeight(520); // keyboard up: web view reduced
    render(<AppHeightTracker />);
    expect(document.body.style.height).toBe("520px");

    setInnerHeight(844); // keyboard closes: innerHeight restored
    window.dispatchEvent(new Event("resize"));
    expect(document.documentElement.style.height).toBe("844px");
    expect(document.body.style.height).toBe("844px");
  });
});

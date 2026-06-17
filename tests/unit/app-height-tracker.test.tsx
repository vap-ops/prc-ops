// Spec 95: on iOS the soft keyboard is a separate layer — the layout viewport
// (window.innerHeight) never changes and the window resize event does not fire;
// only window.visualViewport reacts. AppHeightTracker publishes the live
// visualViewport.height as the --app-vh CSS var so PageShell's <main> tracks the
// visible area (shrinks above the keyboard, restores to full on close).

import { render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { AppHeightTracker } from "@/components/features/chrome/app-height-tracker";

type Fire = (type: string) => void;

function mockVisualViewport(height: number): { setHeight: (h: number) => void; fire: Fire } {
  const listeners: Record<string, Array<(e: Event) => void>> = {};
  const vv = {
    height,
    width: 375,
    offsetTop: 0,
    addEventListener: (type: string, cb: (e: Event) => void) => {
      (listeners[type] ??= []).push(cb);
    },
    removeEventListener: (type: string, cb: (e: Event) => void) => {
      listeners[type] = (listeners[type] ?? []).filter((x) => x !== cb);
    },
  };
  Object.defineProperty(window, "visualViewport", { configurable: true, value: vv });
  return {
    setHeight: (h: number) => {
      vv.height = h;
    },
    fire: (type: string) => (listeners[type] ?? []).forEach((cb) => cb(new Event(type))),
  };
}

function appVh(): string {
  return document.documentElement.style.getPropertyValue("--app-vh");
}

afterEach(() => {
  document.documentElement.style.removeProperty("--app-vh");
  Reflect.deleteProperty(window, "visualViewport");
  document.body.innerHTML = "";
});

describe("AppHeightTracker", () => {
  it("publishes the visual-viewport height as --app-vh on mount", () => {
    mockVisualViewport(540); // keyboard up: visible area reduced
    render(<AppHeightTracker />);
    expect(appVh()).toBe("540px");
  });

  it("restores the full height when the keyboard closes (visualViewport resize)", () => {
    const vv = mockVisualViewport(540); // keyboard up
    render(<AppHeightTracker />);
    expect(appVh()).toBe("540px");

    vv.setHeight(844); // keyboard closes → visual viewport grows back
    vv.fire("resize");
    expect(appVh()).toBe("844px");
  });
});

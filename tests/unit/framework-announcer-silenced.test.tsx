// Writing failing test first.
//
// Next.js mounts its own route announcer — a `<next-route-announcer>` custom
// element whose shadow root holds a `role="alert" aria-live="assertive"` div —
// and speaks `document.title` on every router-tree change. In this app it does
// not work, and #983/#986 measured why: Next REPLACES the `<title>` node instead
// of editing it, so `document.title` is empty for ~1–6ms per navigation, and its
// effect samples inside that window. `getAnnouncerNode` then falls through to
// `document.querySelector("h1")`.
//
// ── Why SILENCE it rather than leave it ─────────────────────────────────────
// Measured across 7 real navigations (two sessions): it was CORRECT **zero**
// times. Usually it mutates to "" — harmless. Once it announced
// "สวัสดี คุณDev Preview (CC)" — the SA home's <h1> greeting, i.e. the user's own
// name, ASSERTIVELY, interrupting whatever they were reading, for a page they
// were not even on. Meanwhile our own polite region (#986) announced the right
// destination on every one of those navigations.
//
// So this removes nothing that works and removes a real, intermittent lie. It is
// deliberately the narrowest possible intervention: two ARIA attributes on one
// node. No patched framework file, no removed DOM.
//
// ── Why touching that node is safe, proven not assumed ──────────────────────
// React portals the announcement TEXT into that div, so the worry is that it
// also owns the attributes and would restore them. Driven in real Chrome: after
// setting aria-live="off" and removing role, both stuck across three
// navigations, `hostCount` stayed 1, and a `data-probe` tag on the node survived
// throughout — React never replaced it. It owns the children, not the element.

import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { RouteAnnouncer } from "@/components/features/chrome/route-announcer";

const HOST = "next-route-announcer";

/** Build the framework's node exactly as `getAnnouncerNode` does. */
function mountFrameworkAnnouncer(): HTMLElement {
  const container = document.createElement(HOST);
  const announcer = document.createElement("div");
  announcer.id = "__next-route-announcer__";
  announcer.setAttribute("role", "alert");
  announcer.setAttribute("aria-live", "assertive");
  container.attachShadow({ mode: "open" }).appendChild(announcer);
  document.body.appendChild(container);
  return announcer;
}

function removeFrameworkAnnouncer(): void {
  for (const el of [...document.getElementsByTagName(HOST)]) el.remove();
}

afterEach(() => {
  cleanup();
  removeFrameworkAnnouncer();
});

describe("the framework's own route announcer is silenced", () => {
  beforeEach(removeFrameworkAnnouncer);

  it("silences a node that already exists when we mount", async () => {
    const announcer = mountFrameworkAnnouncer();

    render(<RouteAnnouncer />);
    await act(async () => {});

    expect(
      announcer.getAttribute("aria-live"),
      "the framework announcer is still live — it will keep interrupting the user " +
        "assertively with the wrong page name",
    ).toBe("off");
    expect(
      announcer.getAttribute("role"),
      'role="alert" makes it an assertive live region on its own, even with ' + 'aria-live="off"',
    ).toBeNull();
  });

  it("silences a node that appears AFTER we mount", async () => {
    // The real ordering. Next creates its node inside its own effect, and effect
    // order between two components in the tree is not something we control — so
    // "it was not there when we looked" must not mean "give up".
    render(<RouteAnnouncer />);
    await act(async () => {});

    let announcer!: HTMLElement;
    await act(async () => {
      announcer = mountFrameworkAnnouncer();
    });
    await act(async () => {});

    expect(
      announcer.getAttribute("aria-live"),
      "a framework announcer created after our mount was never silenced — on a " +
        "real page ours may well run first",
    ).toBe("off");
    expect(announcer.getAttribute("role")).toBeNull();
  });

  it("does not touch OUR region", async () => {
    mountFrameworkAnnouncer();
    render(<RouteAnnouncer />);
    await act(async () => {});

    const ours = screen.getByRole("status");
    expect(ours.getAttribute("aria-live")).toBe("polite");
    expect(ours.getAttribute("aria-atomic")).toBe("true");
  });

  it("survives the node being absent entirely", async () => {
    // Other environments (tests, a future Next that drops the announcer) simply
    // have no such node. That is not an error.
    expect(document.getElementsByTagName(HOST).length).toBe(0);

    render(<RouteAnnouncer />);
    await act(async () => {});

    expect(screen.getByRole("status")).toBeTruthy();
  });

  it("stops watching for it once unmounted", async () => {
    const { unmount } = render(<RouteAnnouncer />);
    await act(async () => {});
    unmount();

    let announcer!: HTMLElement;
    await act(async () => {
      announcer = mountFrameworkAnnouncer();
    });
    await act(async () => {});

    // Nothing should still be listening after unmount.
    expect(announcer.getAttribute("aria-live")).toBe("assertive");
  });

  it("is idempotent — a second mount over an already-silenced node is harmless", async () => {
    const announcer = mountFrameworkAnnouncer();

    const first = render(<RouteAnnouncer />);
    await act(async () => {});
    first.unmount();

    render(<RouteAnnouncer />);
    await act(async () => {});

    expect(announcer.getAttribute("aria-live")).toBe("off");
    expect(announcer.getAttribute("role")).toBeNull();
  });
});

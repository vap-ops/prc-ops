// Spec 42 — LoginButton renders two CSS-toggled anchors so the
// installed PWA (display-mode: standalone) starts the OAuth flow with
// ?standalone=1 while the browser keeps the plain URL. jsdom cannot
// evaluate the display-mode media query, so these tests pin the hrefs
// and the Tailwind arbitrary-variant classes that do the toggling.

import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { LoginButton } from "@/app/login/login-button";

const STANDALONE_HIDDEN = "[@media(display-mode:standalone)]:hidden";
const STANDALONE_SHOWN = "[@media(display-mode:standalone)]:inline-flex";

describe("LoginButton", () => {
  it("renders the browser anchor, hidden in standalone display-mode", () => {
    render(<LoginButton />);
    const links = screen.getAllByRole("link", { name: "เข้าสู่ระบบด้วย LINE" });
    const browserAnchor = links.find((a) => a.getAttribute("href") === "/auth/line/start");
    expect(browserAnchor).toBeDefined();
    expect(browserAnchor?.className).toContain(STANDALONE_HIDDEN);
  });

  it("renders the standalone anchor with ?standalone=1, shown only in standalone", () => {
    render(<LoginButton />);
    const links = screen.getAllByRole("link", { name: "เข้าสู่ระบบด้วย LINE" });
    const standaloneAnchor = links.find(
      (a) => a.getAttribute("href") === "/auth/line/start?standalone=1",
    );
    expect(standaloneAnchor).toBeDefined();
    // Hidden by default, swapped in by the media query.
    expect(standaloneAnchor?.className).toContain("hidden");
    expect(standaloneAnchor?.className).toContain(STANDALONE_SHOWN);
  });
});

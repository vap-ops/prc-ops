// Spec 43 (named update of the spec-42 pins) — LoginButton renders the
// plain browser anchor plus the standalone handoff control, toggled by
// the display-mode media query. The spec-42 ?standalone=1 anchor is
// gone: standalone launches go through /auth/handoff/start instead.

import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { LoginButton } from "@/app/login/login-button";

const STANDALONE_HIDDEN = "[@media(display-mode:standalone)]:hidden";
const STANDALONE_SHOWN = "[@media(display-mode:standalone)]:block";

describe("LoginButton", () => {
  it("renders the browser anchor, hidden in standalone display-mode", () => {
    render(<LoginButton />);
    const anchor = screen.getByRole("link", { name: "เข้าสู่ระบบด้วย LINE" });
    expect(anchor).toHaveAttribute("href", "/auth/line/start");
    expect(anchor.className).toContain(STANDALONE_HIDDEN);
  });

  it("renders the standalone handoff button, shown only in standalone", () => {
    render(<LoginButton />);
    const button = screen.getByRole("button", { name: "เข้าสู่ระบบด้วย LINE" });
    // The client control sits in a CSS-toggled wrapper above it.
    const wrapper = button.closest('[class*="standalone)]:block"]');
    expect(wrapper).not.toBeNull();
    expect(wrapper?.className).toContain("hidden");
    expect(wrapper?.className).toContain(STANDALONE_SHOWN);
  });

  it("no longer renders the dead ?standalone=1 anchor (spec 42 → 43)", () => {
    render(<LoginButton />);
    const links = screen.getAllByRole("link");
    expect(links.map((a) => a.getAttribute("href"))).not.toContain("/auth/line/start?standalone=1");
  });
});

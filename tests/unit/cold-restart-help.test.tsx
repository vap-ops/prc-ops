// Writing failing test first.
//
// Spec 339 U1 — the "ปิดแอปสนิท" card on /settings → เกี่ยวกับ. A zero-JS <details>
// that (a) pre-empts the wrong action (the in-app รีเฟรช button, which is
// router.refresh() and cannot swap the JS bundle), (b) shows the app-switcher
// flick, (c) names how to reach that screen on each platform, and (d) tells the
// user which version proves it worked — the version the page itself renders, so
// the instruction can never drift from the running build.

import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";

import { ColdRestartHelp } from "@/components/features/chrome/cold-restart-help";

describe("ColdRestartHelp — spec 339 U1", () => {
  it("warns that the in-app refresh button is not enough", () => {
    render(<ColdRestartHelp version="0.173.0" />);
    expect(screen.getByText(/รีเฟรช/)).toBeInTheDocument();
    expect(screen.getByText(/ไม่พอ/)).toBeInTheDocument();
  });

  it("names both platforms and their app-switcher gesture", () => {
    render(<ColdRestartHelp version="0.173.0" />);
    expect(screen.getByText(/iPhone/)).toBeInTheDocument();
    expect(screen.getByText(/ปุ่มโฮม/)).toBeInTheDocument();
    expect(screen.getByText(/Android/)).toBeInTheDocument();
    expect(screen.getByText(/บังคับหยุด/)).toBeInTheDocument();
  });

  it("shows the running version as the check, not a hardcoded one", () => {
    render(<ColdRestartHelp version="9.9.9" />);
    expect(screen.getByText(/9\.9\.9/)).toBeInTheDocument();
    expect(screen.queryByText(/0\.173\.0/)).toBeNull();
  });

  it("carries the anchor id so /settings#cold-restart deep-links", () => {
    const { container } = render(<ColdRestartHelp version="0.173.0" />);
    expect(container.querySelector("details#cold-restart")).not.toBeNull();
  });

  it("gives the illustration an accessible name and hides the decorative icon", () => {
    const { container } = render(<ColdRestartHelp version="0.173.0" />);
    const svgs = [...container.querySelectorAll("svg")];
    const illustration = svgs.find((s) => s.querySelector("title") !== null);
    expect(illustration).toBeDefined();
    expect(illustration?.getAttribute("role")).toBe("img");
    expect(illustration?.querySelector("title")?.textContent?.trim()).not.toBe("");
    // The refresh glyph beside "กดปุ่ม …" is decoration for a sentence that
    // already says the word — it must not be announced twice.
    for (const decorative of svgs.filter((s) => s !== illustration)) {
      expect(decorative.getAttribute("aria-hidden")).toBe("true");
    }
  });
});

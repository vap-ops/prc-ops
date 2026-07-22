// Writing failing test first.
//
// Spec 339 U1 — the "ปิดแอปสนิท" card on /settings → เกี่ยวกับ. A zero-JS <details>
// that (a) pre-empts the wrong action (the in-app รีเฟรช button, which is
// router.refresh() and cannot swap the JS bundle), (b) shows the app-switcher
// flick, (c) names how to reach that screen on each platform, and (d) tells the
// user which version proves it worked — the version the page itself renders, so
// the instruction can never drift from the running build.

import { readFileSync } from "node:fs";
import { join } from "node:path";

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
    // The home-button variant is the iPhone line's, not the Android line's (which
    // uses ปุ่มโฮม only as a landmark) — pin the wording unique to it.
    expect(screen.getByText(/รุ่นที่มีปุ่มโฮม/)).toBeInTheDocument();
    expect(screen.getByText(/Android/)).toBeInTheDocument();
    expect(screen.getByText(/ปุ่มแสดงแอปที่เปิดอยู่/)).toBeInTheDocument();
  });

  it("names the recents key by function, never by shape", () => {
    // "ปุ่มสี่เหลี่ยม" is wrong on Samsung One UI — the square-ish key there is
    // HOME and recents is the three-bar key, so shape wording sends the biggest
    // Android cohort in the field to background the app instead of killing it.
    const { container } = render(<ColdRestartHelp version="0.173.0" />);
    expect(container.textContent ?? "").not.toMatch(/ปุ่มสี่เหลี่ยม/);
  });

  it("delegates the freshness verdict instead of echoing the server version", () => {
    // The server's version is always current, so printing it as the "did it work?"
    // check is circular. AppVersionCheck compares the CLIENT bundle; with no
    // NEXT_PUBLIC_APP_VERSION in the test env it must state neither verdict.
    render(<ColdRestartHelp version="9.9.9" />);
    expect(screen.getByText(/เวอร์ชันล่าสุดคือ/)).toBeInTheDocument();
    expect(screen.getByText("9.9.9")).toBeInTheDocument();
    expect(screen.queryByText(/ใช้เวอร์ชันล่าสุดแล้ว/)).toBeNull();
  });

  it("carries the anchor id used by the /sa/help pointer", () => {
    const { container } = render(<ColdRestartHelp version="0.173.0" />);
    expect(container.querySelector("details#cold-restart")).not.toBeNull();
  });

  it("is actually mounted on /settings, fed the page's own version", () => {
    // Without this the whole suite stays green while the card is deleted from the
    // page — and /sa/help keeps sending SAs to a card that no longer exists.
    const page = readFileSync(join(process.cwd(), "src/app/settings/page.tsx"), "utf8");
    expect(page).toContain("<ColdRestartHelp version={pkg.version} />");
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

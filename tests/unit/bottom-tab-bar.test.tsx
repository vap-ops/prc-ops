// Component tests for the phone-first bottom tab bar (spec 19 §1).
// The load-bearing rule: longest matching prefix wins — exactly ONE
// active tab, ever (naive startsWith would double-light /pm and
// /pm/projects on every /pm/projects/* page). Cross-surface paths
// match no tab and that is accepted.

import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockUsePathname } = vi.hoisted(() => ({ mockUsePathname: vi.fn() }));

vi.mock("next/navigation", () => ({
  usePathname: mockUsePathname,
}));

import { BottomTabBar, PM_TABS, SA_TABS } from "@/components/features/bottom-tab-bar";

function activeTabs(container: HTMLElement) {
  return container.querySelectorAll('[aria-current="page"]');
}

describe("BottomTabBar", () => {
  beforeEach(() => {
    mockUsePathname.mockReturnValue("/pm");
  });

  it("pins the canonical tab sets (labels, hrefs, order)", () => {
    expect(PM_TABS.map((t) => [t.label, t.href])).toEqual([
      ["รอตรวจ", "/pm"],
      ["โครงการ", "/pm/projects"],
      ["คำขอซื้อ", "/requests"],
      ["โปรไฟล์", "/profile"],
    ]);
    expect(SA_TABS.map((t) => [t.label, t.href])).toEqual([
      ["โครงการ", "/sa"],
      ["คำขอซื้อ", "/requests"],
      ["โปรไฟล์", "/profile"],
    ]);
  });

  it("renders the PM set for project_manager with inactive tabs as links", () => {
    mockUsePathname.mockReturnValue("/pm");
    render(<BottomTabBar role="project_manager" />);
    expect(screen.getByRole("link", { name: /โครงการ/ })).toHaveAttribute("href", "/pm/projects");
    expect(screen.getByRole("link", { name: /คำขอซื้อ/ })).toHaveAttribute("href", "/requests");
    expect(screen.getByRole("link", { name: /โปรไฟล์/ })).toHaveAttribute("href", "/profile");
    expect(screen.queryByRole("link", { name: /รอตรวจ/ })).not.toBeInTheDocument();
  });

  it("lights exactly ONE tab on a nested project page (longest prefix wins)", () => {
    mockUsePathname.mockReturnValue("/pm/projects/abc/reports");
    const { container } = render(<BottomTabBar role="project_manager" />);
    const active = activeTabs(container);
    expect(active).toHaveLength(1);
    expect(active[0]?.textContent).toContain("โครงการ");
  });

  it("lights รอตรวจ on the PM review detail screen", () => {
    mockUsePathname.mockReturnValue("/pm/work-packages/xyz");
    const { container } = render(<BottomTabBar role="project_manager" />);
    const active = activeTabs(container);
    expect(active).toHaveLength(1);
    expect(active[0]?.textContent).toContain("รอตรวจ");
  });

  it("lights no tab on a cross-surface path (PM on /sa/...)", () => {
    mockUsePathname.mockReturnValue("/sa/projects/abc");
    const { container } = render(<BottomTabBar role="project_manager" />);
    expect(activeTabs(container)).toHaveLength(0);
  });

  it("renders the SA set for site_admin and super uses the PM set", () => {
    mockUsePathname.mockReturnValue("/sa");
    const { container, unmount } = render(<BottomTabBar role="site_admin" />);
    expect(activeTabs(container)[0]?.textContent).toContain("โครงการ");
    expect(screen.getByRole("link", { name: /คำขอซื้อ/ })).toHaveAttribute("href", "/requests");
    unmount();
    mockUsePathname.mockReturnValue("/pm");
    const { container: c2 } = render(<BottomTabBar role="super_admin" />);
    expect(activeTabs(c2)[0]?.textContent).toContain("รอตรวจ");
  });

  it("renders nothing for unserved roles", () => {
    const { container } = render(<BottomTabBar role="visitor" />);
    expect(container.firstChild).toBeNull();
  });

  it("clears the iOS safe area and hides on desktop", () => {
    mockUsePathname.mockReturnValue("/pm");
    render(<BottomTabBar role="project_manager" />);
    const nav = screen.getByRole("navigation", { name: "เมนูหลัก" });
    expect(nav.className).toContain("pb-[env(safe-area-inset-bottom)]");
    expect(nav.className).toContain("sm:hidden");
  });

  // Spec 20 sun-readable nav: light bar, blue active identity with a
  // visible top indicator, size-6 icons.
  it("renders the sun-mode bar: white ground, blue active tab with top indicator (spec 20)", () => {
    mockUsePathname.mockReturnValue("/pm");
    const { container } = render(<BottomTabBar role="project_manager" />);
    const nav = screen.getByRole("navigation", { name: "เมนูหลัก" });
    expect(nav.className).toContain("bg-white");
    const active = container.querySelector('[aria-current="page"]');
    expect(active).not.toBeNull();
    expect(active?.className).toContain("text-blue-700");
    // The active signal is a visible indicator bar, not just a tint.
    expect(active?.querySelector(".bg-blue-700")).not.toBeNull();
    // Icons step up to size-6 for sun/glove legibility.
    expect(container.querySelector("svg")?.getAttribute("class")).toContain("size-6");
  });
});

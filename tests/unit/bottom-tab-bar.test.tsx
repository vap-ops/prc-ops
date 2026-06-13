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

import {
  BottomTabBar,
  PM_TABS,
  PROCUREMENT_TABS,
  SA_TABS,
} from "@/components/features/bottom-tab-bar";

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
      // Spec 81: contacts management reachable on phones (was desktop-HubNav only).
      ["ติดต่อ", "/pm/contacts"],
      ["โปรไฟล์", "/profile"],
    ]);
    expect(SA_TABS.map((t) => [t.label, t.href])).toEqual([
      ["โครงการ", "/sa"],
      ["คำขอซื้อ", "/requests"],
      ["โปรไฟล์", "/profile"],
    ]);
    // Spec 70: procurement's worklist-only tab set — purchasing + profile.
    // No โครงการ (no project/WP hub in v1) and no รอตรวจ (not a decider).
    expect(PROCUREMENT_TABS.map((t) => [t.label, t.href])).toEqual([
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
    // Spec 82 Unit 2: reports lives at /projects/[id]/reports now.
    mockUsePathname.mockReturnValue("/projects/abc/reports");
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

  // UPDATED (operator report 2026-06-11, reverses the spec-19 "match no
  // tab" acceptance): PM/super browse the shared project surfaces routinely
  // (รายการงาน link, WP details, /requests back-targets) — the โครงการ tab
  // must stay lit there or the bar reads as "you are nowhere". Spec 82 moved
  // those surfaces from /sa/* to the content-named /projects/*.
  it("keeps โครงการ lit on cross-surface project paths (PM on /projects/...)", () => {
    mockUsePathname.mockReturnValue("/projects/abc");
    const { container } = render(<BottomTabBar role="project_manager" />);
    const active = activeTabs(container);
    expect(active).toHaveLength(1);
    expect(active[0]?.textContent).toContain("โครงการ");
  });

  it("keeps โครงการ lit for super_admin deep in a /projects work-package screen", () => {
    mockUsePathname.mockReturnValue("/projects/abc/work-packages/xyz");
    const { container } = render(<BottomTabBar role="super_admin" />);
    const active = activeTabs(container);
    expect(active).toHaveLength(1);
    expect(active[0]?.textContent).toContain("โครงการ");
  });

  // Spec 82: site_admin's hub tab is /sa, but the project surfaces it opens
  // now live at /projects/* — its tab claims /projects to stay lit there.
  it("keeps โครงการ lit for site_admin on a /projects path", () => {
    mockUsePathname.mockReturnValue("/projects/abc");
    const { container } = render(<BottomTabBar role="site_admin" />);
    const active = activeTabs(container);
    expect(active).toHaveLength(1);
    expect(active[0]?.textContent).toContain("โครงการ");
  });

  it("still lights exactly one tab when match prefixes overlap (/pm/projects beats /projects on /pm pages)", () => {
    mockUsePathname.mockReturnValue("/pm/projects");
    const { container } = render(<BottomTabBar role="project_manager" />);
    const active = activeTabs(container);
    expect(active).toHaveLength(1);
    expect(active[0]?.textContent).toContain("โครงการ");
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

  // Spec 70: procurement gets the worklist tab set — purchasing + profile,
  // and NEVER โครงการ or รอตรวจ (it has no project hub and is not a decider).
  it("renders the procurement set: คำขอซื้อ + โปรไฟล์, no โครงการ/รอตรวจ", () => {
    mockUsePathname.mockReturnValue("/requests");
    const { container } = render(<BottomTabBar role="procurement" />);
    expect(screen.getByRole("link", { name: /โปรไฟล์/ })).toHaveAttribute("href", "/profile");
    expect(screen.queryByRole("link", { name: /โครงการ/ })).not.toBeInTheDocument();
    expect(screen.queryByText("รอตรวจ")).not.toBeInTheDocument();
    // คำขอซื้อ is the active tab on /requests, so it renders as a span, not a link.
    const active = activeTabs(container);
    expect(active).toHaveLength(1);
    expect(active[0]?.textContent).toContain("คำขอซื้อ");
  });

  it("renders nothing for still-unserved roles", () => {
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

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
  COORDINATOR_TABS,
  PM_TABS,
  PROCUREMENT_TABS,
  SA_TABS,
} from "@/components/features/chrome/bottom-tab-bar";

function activeTabs(container: HTMLElement) {
  return container.querySelectorAll('[aria-current="page"]');
}

describe("BottomTabBar", () => {
  beforeEach(() => {
    mockUsePathname.mockReturnValue("/review");
  });

  it("pins the canonical tab sets (labels, hrefs, order)", () => {
    expect(PM_TABS.map((t) => [t.label, t.href])).toEqual([
      // Spec 183 U2: รอตรวจ dropped — the review queue moved off the tab bar
      // into a dashboard card; ภาพรวม carries the pending count + lights on
      // /review (the queue is now a sub-surface of ภาพรวม).
      // Spec 82 Unit 3: the project hub folded to /projects.
      ["โครงการ", "/projects"],
      ["คำขอซื้อ", "/requests"],
      // Spec 100: ภาพรวม is the live dashboard tab (last content tab).
      ["ภาพรวม", "/dashboard"],
      // Spec 93: contacts/payroll/workers/account moved into the ตั้งค่า hub.
      ["ตั้งค่า", "/settings"],
    ]);
    expect(SA_TABS.map((t) => [t.label, t.href])).toEqual([
      ["โครงการ", "/projects"],
      ["คำขอซื้อ", "/requests"],
      // Spec 100: ภาพรวม is the live dashboard tab (last content tab).
      ["ภาพรวม", "/dashboard"],
      ["ตั้งค่า", "/settings"],
    ]);
    // procurement's back-office tab set: คำขอซื้อ (spec 70), โครงการ read-only
    // (spec 102), ผู้ขาย suppliers master (spec 101), ตั้งค่า. No รอตรวจ (not a
    // decider) and no ภาพรวม (money, spec 100).
    expect(PROCUREMENT_TABS.map((t) => [t.label, t.href])).toEqual([
      ["คำขอซื้อ", "/requests"],
      ["โครงการ", "/projects"],
      ["ผู้ขาย", "/contacts/vendors"],
      ["ตั้งค่า", "/settings"],
    ]);
    // Spec 143 U2: the coordinator is a see-all oversight role — projects + the
    // universal settings hub only (no /review, /requests, or /dashboard, which
    // don't admit it).
    expect(COORDINATOR_TABS.map((t) => [t.label, t.href])).toEqual([
      ["โครงการ", "/projects"],
      ["ตั้งค่า", "/settings"],
    ]);
  });

  // Spec 100: ภาพรวม graduated from a coming-soon placeholder to a live tab —
  // a real link that lights on /dashboard like any other.
  it("renders ภาพรวม as a live link that lights on /dashboard", () => {
    mockUsePathname.mockReturnValue("/review");
    const { unmount } = render(<BottomTabBar role="project_manager" />);
    expect(screen.getByRole("link", { name: /ภาพรวม/ })).toHaveAttribute("href", "/dashboard");
    unmount();

    mockUsePathname.mockReturnValue("/dashboard");
    const { container } = render(<BottomTabBar role="project_manager" />);
    const active = activeTabs(container);
    expect(active).toHaveLength(1);
    expect(active[0]?.textContent).toContain("ภาพรวม");
  });

  it("gives procurement no ภาพรวม tab (lean worklist)", () => {
    mockUsePathname.mockReturnValue("/requests");
    render(<BottomTabBar role="procurement" />);
    expect(screen.queryByText("ภาพรวม")).not.toBeInTheDocument();
  });

  it("renders the PM set for project_manager, every tab a link to its root", () => {
    mockUsePathname.mockReturnValue("/dashboard");
    render(<BottomTabBar role="project_manager" />);
    expect(screen.getByRole("link", { name: /โครงการ/ })).toHaveAttribute("href", "/projects");
    expect(screen.getByRole("link", { name: /คำขอซื้อ/ })).toHaveAttribute("href", "/requests");
    expect(screen.getByRole("link", { name: /ตั้งค่า/ })).toHaveAttribute("href", "/settings");
    expect(screen.getByRole("link", { name: /ภาพรวม/ })).toHaveAttribute("href", "/dashboard");
    // Spec 183 U2: there is no longer a รอตรวจ tab.
    expect(screen.queryByText("รอตรวจ")).not.toBeInTheDocument();
  });

  // Operator 2026-06-21: "all the tabs on the bottom must be treated as first
  // layer." From a sub-page the section's (active) tab must still navigate to its
  // root, not render as an inert span — otherwise you cannot one-tap back to the
  // top of the section.
  it("renders the active tab as a tappable link to its root (return to first layer)", () => {
    mockUsePathname.mockReturnValue("/projects/abc/work-packages/xyz");
    const { container } = render(<BottomTabBar role="project_manager" />);
    const active = container.querySelector('[aria-current="page"]');
    expect(active?.tagName).toBe("A"); // a real anchor, not an inert span
    expect(active).toHaveAttribute("href", "/projects");
  });

  it("lights exactly ONE tab on a nested project page (longest prefix wins)", () => {
    // Spec 82 Unit 2: reports lives at /projects/[id]/reports now.
    mockUsePathname.mockReturnValue("/projects/abc/reports");
    const { container } = render(<BottomTabBar role="project_manager" />);
    const active = activeTabs(container);
    expect(active).toHaveLength(1);
    expect(active[0]?.textContent).toContain("โครงการ");
  });

  // Spec 183 U2: the review queue is now a sub-surface of ภาพรวม — the dashboard
  // tab claims /review via its match prefix, so it lights on the queue + its
  // detail screens (there is no longer a รอตรวจ tab of its own).
  it("lights ภาพรวม on the review queue + its detail screens", () => {
    for (const path of ["/review", "/review/work-packages/xyz"]) {
      mockUsePathname.mockReturnValue(path);
      const { container, unmount } = render(<BottomTabBar role="project_manager" />);
      const active = activeTabs(container);
      expect(active).toHaveLength(1);
      expect(active[0]?.textContent).toContain("ภาพรวม");
      unmount();
    }
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

  // Spec 82 Unit 3: site_admin's hub tab points straight at the folded
  // /projects hub and lights on it and every /projects/* detail screen.
  it("keeps โครงการ lit for site_admin on a /projects path", () => {
    mockUsePathname.mockReturnValue("/projects/abc");
    const { container } = render(<BottomTabBar role="site_admin" />);
    const active = activeTabs(container);
    expect(active).toHaveLength(1);
    expect(active[0]?.textContent).toContain("โครงการ");
  });

  it("lights exactly one tab on the folded /projects hub itself", () => {
    mockUsePathname.mockReturnValue("/projects");
    const { container } = render(<BottomTabBar role="project_manager" />);
    const active = activeTabs(container);
    expect(active).toHaveLength(1);
    expect(active[0]?.textContent).toContain("โครงการ");
  });

  it("renders the SA set for site_admin and super uses the PM set", () => {
    mockUsePathname.mockReturnValue("/projects");
    const { container, unmount } = render(<BottomTabBar role="site_admin" />);
    expect(activeTabs(container)[0]?.textContent).toContain("โครงการ");
    expect(screen.getByRole("link", { name: /คำขอซื้อ/ })).toHaveAttribute("href", "/requests");
    unmount();
    // Spec 183 U2: super (PM set) on /review lights ภาพรวม (the queue's home),
    // not a รอตรวจ tab — that tab is gone.
    mockUsePathname.mockReturnValue("/review");
    const { container: c2 } = render(<BottomTabBar role="super_admin" />);
    expect(activeTabs(c2)[0]?.textContent).toContain("ภาพรวม");
  });

  // Spec 70/101/102: procurement gets คำขอซื้อ + โครงการ + ผู้ขาย + ตั้งค่า, and
  // NEVER รอตรวจ (not a decider). โครงการ is read-only project browse (spec 102).
  it("renders the procurement set: คำขอซื้อ + โครงการ + ผู้ขาย + ตั้งค่า, no รอตรวจ", () => {
    mockUsePathname.mockReturnValue("/requests");
    const { container } = render(<BottomTabBar role="procurement" />);
    expect(screen.getByRole("link", { name: /โครงการ/ })).toHaveAttribute("href", "/projects");
    expect(screen.getByRole("link", { name: /ผู้ขาย/ })).toHaveAttribute(
      "href",
      "/contacts/vendors",
    );
    expect(screen.getByRole("link", { name: /ตั้งค่า/ })).toHaveAttribute("href", "/settings");
    expect(screen.queryByText("รอตรวจ")).not.toBeInTheDocument();
    // คำขอซื้อ is the active tab on /requests — now a link to its root, marked by
    // aria-current (every bottom tab is a first-layer destination).
    const active = activeTabs(container);
    expect(active).toHaveLength(1);
    expect(active[0]?.textContent).toContain("คำขอซื้อ");
  });

  // Spec 101: ผู้ขาย lights on the suppliers screen (longest-prefix beats the
  // ตั้งค่า /contacts match).
  it("lights ผู้ขาย for procurement on /contacts/vendors", () => {
    mockUsePathname.mockReturnValue("/contacts/vendors");
    const { container } = render(<BottomTabBar role="procurement" />);
    const active = activeTabs(container);
    expect(active).toHaveLength(1);
    expect(active[0]?.textContent).toContain("ผู้ขาย");
  });

  // Spec 143 U2: the coordinator gets a focused set — โครงการ (sees all) + ตั้งค่า.
  it("renders the coordinator set: โครงการ + ตั้งค่า, lights โครงการ on /projects", () => {
    mockUsePathname.mockReturnValue("/projects");
    const { container } = render(<BottomTabBar role="project_coordinator" />);
    expect(screen.getByText("ตั้งค่า")).toBeInTheDocument();
    expect(screen.queryByText("รอตรวจ")).not.toBeInTheDocument();
    expect(screen.queryByText("คำขอซื้อ")).not.toBeInTheDocument();
    const active = activeTabs(container);
    expect(active).toHaveLength(1);
    expect(active[0]?.textContent).toContain("โครงการ");
  });

  it("renders nothing for still-unserved roles", () => {
    const { container } = render(<BottomTabBar role="visitor" />);
    expect(container.firstChild).toBeNull();
  });

  it("clears the iOS safe area and hides on desktop", () => {
    mockUsePathname.mockReturnValue("/review");
    render(<BottomTabBar role="project_manager" />);
    const nav = screen.getByRole("navigation", { name: "เมนูหลัก" });
    expect(nav.className).toContain("pb-[env(safe-area-inset-bottom)]");
    expect(nav.className).toContain("sm:hidden");
  });

  // Spec 20 sun-readable nav: light bar, blue active identity with a
  // visible top indicator, size-6 icons.
  it("renders the sun-mode bar: card ground, action active tab with top indicator (spec 20)", () => {
    mockUsePathname.mockReturnValue("/review");
    const { container } = render(<BottomTabBar role="project_manager" />);
    const nav = screen.getByRole("navigation", { name: "เมนูหลัก" });
    expect(nav.className).toContain("bg-card");
    const active = container.querySelector('[aria-current="page"]');
    expect(active).not.toBeNull();
    expect(active?.className).toContain("text-action");
    // The active signal is a visible indicator bar, not just a tint.
    expect(active?.querySelector(".bg-action")).not.toBeNull();
    // Icons step up to size-6 for sun/glove legibility.
    expect(container.querySelector("svg")?.getAttribute("class")).toContain("size-6");
  });
});

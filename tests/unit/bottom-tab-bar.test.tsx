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
  PROCUREMENT_MANAGER_TABS,
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
      ["จัดซื้อ", "/requests"],
      // Spec 100: ภาพรวม is the live dashboard tab (last content tab).
      ["ภาพรวม", "/dashboard"],
      // Spec 263 follow-up / spec 264 G4: the staff-registration approval queue
      // (role-neutral) — was reachable on desktop (HubNav) only; mobile had no
      // way in at all.
      ["คำขอสมัคร", "/registrations"],
      // Spec 93: contacts/payroll/workers/account moved into the ตั้งค่า hub.
      ["ตั้งค่า", "/settings"],
    ]);
    expect(SA_TABS.map((t) => [t.label, t.href])).toEqual([
      // Spec 192 U4: the SA lands on the daily home หน้าหลัก (/sa); ภาพรวม dropped
      // from the SA bar (the home supersedes it).
      ["หน้าหลัก", "/sa"],
      ["โครงการ", "/projects"],
      // Spec 313 D2 (nav-coherence audit 2026-07): ทีมงาน is an SA bottom tab — it
      // was a hub reachable only from a home tile, so /team stranded the phone user
      // (no lit tab, no back chip). Its own tab fixes the strand; position 3 per
      // the spec-313 people-before-purchasing order.
      ["ทีมงาน", "/team"],
      ["จัดซื้อ", "/requests"],
      ["ตั้งค่า", "/settings"],
    ]);
    // Spec 323 U3b (decision A): procurement's six scattered tabs collapse to
    // the STR spine — the /procurement hub + its three section sub-routes
    // (distinct PATHNAMES, not ?section=, because the active rule above is
    // query-blind). Every old destination is one tap in via a hub door.
    expect(PROCUREMENT_TABS.map((t) => [t.label, t.href])).toEqual([
      ["หน้าหลัก", "/procurement"],
      ["ขอบเขต", "/procurement/scope"],
      ["เวลา", "/procurement/time"],
      ["ทรัพยากร", "/procurement/resources"],
      ["ตั้งค่า", "/settings"],
    ]);
    // Spec 143 U2: the coordinator is a see-all oversight role — projects + the
    // universal settings hub only (no /review, /requests, or /dashboard, which
    // don't admit it).
    expect(COORDINATOR_TABS.map((t) => [t.label, t.href])).toEqual([
      ["โครงการ", "/projects"],
      ["ตั้งค่า", "/settings"],
    ]);
    // Spec 323 U3b: procurement_manager collapses to the SAME STR spine — its
    // extra คำขอสมัคร tab is DROPPED because the approval queue re-homed as the
    // /procurement hub's nudge + count (U3a), so the queue keeps its phone path
    // without a seventh tab.
    expect(PROCUREMENT_MANAGER_TABS.map((t) => [t.label, t.href])).toEqual([
      ["หน้าหลัก", "/procurement"],
      ["ขอบเขต", "/procurement/scope"],
      ["เวลา", "/procurement/time"],
      ["ทรัพยากร", "/procurement/resources"],
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

  it("gives procurement no ภาพรวม tab (money surface, spec 100)", () => {
    mockUsePathname.mockReturnValue("/procurement");
    render(<BottomTabBar role="procurement" />);
    expect(screen.queryByText("ภาพรวม")).not.toBeInTheDocument();
  });

  it("renders the PM set for project_manager, every tab a link to its root", () => {
    mockUsePathname.mockReturnValue("/dashboard");
    render(<BottomTabBar role="project_manager" />);
    expect(screen.getByRole("link", { name: /โครงการ/ })).toHaveAttribute("href", "/projects");
    expect(screen.getByRole("link", { name: /จัดซื้อ/ })).toHaveAttribute("href", "/requests");
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

  // Spec 192 U4: the SA daily home is the landing — its หน้าหลัก tab lights on /sa.
  it("lights หน้าหลัก for site_admin on the daily home /sa", () => {
    mockUsePathname.mockReturnValue("/sa");
    const { container } = render(<BottomTabBar role="site_admin" />);
    const active = activeTabs(container);
    expect(active).toHaveLength(1);
    expect(active[0]?.textContent).toContain("หน้าหลัก");
  });

  it("renders the SA set for site_admin and super uses the PM set", () => {
    mockUsePathname.mockReturnValue("/projects");
    const { container, unmount } = render(<BottomTabBar role="site_admin" />);
    expect(activeTabs(container)[0]?.textContent).toContain("โครงการ");
    expect(screen.getByRole("link", { name: /จัดซื้อ/ })).toHaveAttribute("href", "/requests");
    unmount();
    // Spec 183 U2: super (PM set) on /review lights ภาพรวม (the queue's home),
    // not a รอตรวจ tab — that tab is gone.
    mockUsePathname.mockReturnValue("/review");
    const { container: c2 } = render(<BottomTabBar role="super_admin" />);
    expect(activeTabs(c2)[0]?.textContent).toContain("ภาพรวม");
  });

  // Spec 323 U3b: procurement's STR spine — หน้าหลัก lights on the /procurement
  // hub itself; each section tab is a real link to its sub-route. Never รอตรวจ
  // (not a decider).
  it("renders the procurement STR spine and lights หน้าหลัก on /procurement", () => {
    mockUsePathname.mockReturnValue("/procurement");
    const { container } = render(<BottomTabBar role="procurement" />);
    expect(screen.getByRole("link", { name: /ขอบเขต/ })).toHaveAttribute(
      "href",
      "/procurement/scope",
    );
    expect(screen.getByRole("link", { name: /เวลา/ })).toHaveAttribute("href", "/procurement/time");
    expect(screen.getByRole("link", { name: /ทรัพยากร/ })).toHaveAttribute(
      "href",
      "/procurement/resources",
    );
    expect(screen.getByRole("link", { name: /ตั้งค่า/ })).toHaveAttribute("href", "/settings");
    expect(screen.queryByText("รอตรวจ")).not.toBeInTheDocument();
    const active = activeTabs(container);
    expect(active).toHaveLength(1);
    expect(active[0]?.textContent).toContain("หน้าหลัก");
  });

  // The whole reason the sections are distinct SUB-ROUTES (not ?section=): the
  // active rule is a query-blind longest-PATHNAME-prefix, so /procurement/scope
  // (len 18) beats /procurement (len 12) and exactly one tab lights.
  it("lights exactly the section tab on each /procurement/<section> route", () => {
    for (const [path, label] of [
      ["/procurement/scope", "ขอบเขต"],
      ["/procurement/time", "เวลา"],
      ["/procurement/resources", "ทรัพยากร"],
    ] as const) {
      mockUsePathname.mockReturnValue(path);
      const { container, unmount } = render(<BottomTabBar role="procurement" />);
      const active = activeTabs(container);
      expect(active).toHaveLength(1);
      expect(active[0]?.textContent).toContain(label);
      unmount();
    }
  });

  // Door surfaces are reached THROUGH the hub, not pinned as tabs — on a leaf
  // like /requests no procurement tab claims the path (the spec-19 acceptance:
  // a cross-surface path matches no tab; the bar still renders for navigation).
  it("lights no tab for procurement on a hub-door leaf like /requests", () => {
    mockUsePathname.mockReturnValue("/requests");
    const { container } = render(<BottomTabBar role="procurement" />);
    expect(activeTabs(container)).toHaveLength(0);
    // The bar itself still renders — it is the way back to the hub.
    expect(screen.getByRole("link", { name: /หน้าหลัก/ })).toHaveAttribute("href", "/procurement");
  });

  // Spec 323 U4: for the procurement tiers the reference surfaces (/contacts,
  // /catalog, /equipment, /workers, /payroll) are STR hub DOORS now, not
  // settings sub-surfaces — their ตั้งค่า tab must NOT claim them (it would
  // light on doors that no longer exist in their settings). They are leaves
  // (the spec-19 acceptance), like /requests above.
  it("lights NO tab for procurement on /contacts/vendors (hub door, not a settings leaf)", () => {
    mockUsePathname.mockReturnValue("/contacts/vendors");
    const { container } = render(<BottomTabBar role="procurement" />);
    expect(activeTabs(container)).toHaveLength(0);
    // The bar still renders — the hub tabs are the way back.
    expect(screen.getByRole("link", { name: /หน้าหลัก/ })).toHaveAttribute("href", "/procurement");
  });

  // …while every OTHER role's SETTINGS_TAB keeps its match prefixes (the doors
  // still live in their ตั้งค่า — spec 93 unchanged outside procurement).
  it("keeps ตั้งค่า lit for project_manager on /contacts/vendors (settings match)", () => {
    mockUsePathname.mockReturnValue("/contacts/vendors");
    const { container } = render(<BottomTabBar role="project_manager" />);
    const active = activeTabs(container);
    expect(active).toHaveLength(1);
    expect(active[0]?.textContent).toContain("ตั้งค่า");
  });

  // /profile stays a settings sub-surface for EVERYONE (my-info is still in
  // procurement's ตั้งค่า) — the procurement settings tab keeps that one match.
  it("keeps ตั้งค่า lit for procurement on /profile", () => {
    mockUsePathname.mockReturnValue("/profile");
    const { container } = render(<BottomTabBar role="procurement" />);
    const active = activeTabs(container);
    expect(active).toHaveLength(1);
    expect(active[0]?.textContent).toContain("ตั้งค่า");
  });

  // Spec 143 U2: the coordinator gets a focused set — โครงการ (sees all) + ตั้งค่า.
  it("renders the coordinator set: โครงการ + ตั้งค่า, lights โครงการ on /projects", () => {
    mockUsePathname.mockReturnValue("/projects");
    const { container } = render(<BottomTabBar role="project_coordinator" />);
    expect(screen.getByText("ตั้งค่า")).toBeInTheDocument();
    expect(screen.queryByText("รอตรวจ")).not.toBeInTheDocument();
    expect(screen.queryByText("จัดซื้อ")).not.toBeInTheDocument();
    const active = activeTabs(container);
    expect(active).toHaveLength(1);
    expect(active[0]?.textContent).toContain("โครงการ");
  });

  it("renders nothing for still-unserved roles", () => {
    const { container } = render(<BottomTabBar role="visitor" />);
    expect(container.firstChild).toBeNull();
  });

  // Spec 323 U3b: procurement_manager rides the SAME STR spine — its old
  // คำขอสมัคร tab is gone because the approval queue re-homed as the
  // /procurement hub's nudge + count (U3a), keeping the phone path.
  it("gives procurement_manager the STR spine with NO คำขอสมัคร tab", () => {
    mockUsePathname.mockReturnValue("/procurement/time");
    const { container } = render(<BottomTabBar role="procurement_manager" />);
    expect(screen.getByRole("link", { name: /หน้าหลัก/ })).toHaveAttribute("href", "/procurement");
    expect(screen.getByRole("link", { name: /ขอบเขต/ })).toHaveAttribute(
      "href",
      "/procurement/scope",
    );
    expect(screen.queryByText("คำขอสมัคร")).not.toBeInTheDocument();
    const active = activeTabs(container);
    expect(active).toHaveLength(1);
    expect(active[0]?.textContent).toContain("เวลา");
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

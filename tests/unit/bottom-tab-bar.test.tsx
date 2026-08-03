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
  ACCOUNTING_TABS,
  BottomTabBar,
  COORDINATOR_TABS,
  LEGAL_TABS,
  PM_TABS,
  PROCUREMENT_TABS,
  PROCUREMENT_MANAGER_TABS,
  SA_TABS,
  SITE_OWNER_TABS,
  TECHNICIAN_TABS,
  tabsForRole,
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
      // Spec 313 U3: the /team people hub joins the PM bar, in the
      // people-before-purchasing position the SA bar already uses.
      ["ทีมงาน", "/team"],
      ["จัดซื้อ", "/requests"],
      // Spec 100: ภาพรวม is the live dashboard tab (last content tab).
      ["ภาพรวม", "/dashboard"],
      // Spec 313 U3: the คำขอสมัคร tab (spec 263 follow-up / 264 G4) FOLDED into
      // /team, which carries the same queue as an approver card + pending count.
      // The desktop hub strip keeps a direct คำขอสมัคร item, so only the phone
      // bar trades a tab for one extra tap.
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
    // Spec 313 U7: LEGAL_TABS was the one exported tab set with NO pin at all —
    // not even imported here. `legal` is absent from ASSUMABLE_ROLES so view-as
    // cannot reach it, and U5 promoted /legal to a hub (no back chip), which
    // makes this bar the role's only "you are here" on a phone. Pinned last
    // because it is the newest set (spec 284 U5).
    expect(LEGAL_TABS.map((t) => [t.label, t.href])).toEqual([
      ["กฎหมาย", "/legal"],
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
    // Writing failing test first.
    //
    // Spec 388 U3 (D1): 3 → 2. Spec 376 U3 gave the role its first bar; two days
    // of telemetry then said ประวัติ had NEVER been opened, and โปรไฟล์ is a
    // /settings leaf by its own back chip. So the ประวัติ tab goes (the page is
    // re-homed as a row on /technician — pinned in nav-law-strip-superset) and
    // SETTINGS_TAB takes its place, which is also D2: a ช่าง finally gets a
    // settings door. โปรไฟล์ keeps lighting a tab with NO new match entry —
    // SETTINGS_TAB.match already carries /profile, shared with every other role.
    expect(TECHNICIAN_TABS.map((t) => [t.label, t.href])).toEqual([
      ["หน้าหลัก", "/technician"],
      ["ตั้งค่า", "/settings"],
    ]);
    // D1 leans on the settings tab's `match` carrying /profile — that is what
    // keeps โปรไฟล์ lighting a tab after it left the bar. Asserted here (not just
    // read in the source) because a technician-shaped copy of SETTINGS_TAB
    // without the match would pass the label/href pin above and silently unlight
    // /profile for this role alone.
    expect(TECHNICIAN_TABS[1]?.match).toContain("/profile");
    // Spec 376 U5 (D2): the site owner's bar — the COORDINATOR_TABS shape, and a
    // SEPARATE array on purpose (members coincide, meanings differ: "the see-all
    // oversight role's bar" vs "the owner of ONE site's bar"), so a future
    // coordinator change cannot silently move a site owner's chrome. Two tabs
    // because those are the only surfaces U5 admits it to — every tab a live
    // destination, the COORDINATOR_TABS / LEGAL_TABS rule.
    expect(SITE_OWNER_TABS.map((t) => [t.label, t.href])).toEqual([
      ["โครงการ", "/projects"],
      ["ตั้งค่า", "/settings"],
    ]);
  });

  // Spec 376 U5: the role rendered NO bar before (tabsForRole → null), which is
  // why 313 U6's landing-without-chrome was refused. Pinned as identity (toBe),
  // not shape, so the arm cannot be re-pointed at COORDINATOR_TABS.
  it("maps site_owner to its own set and lights โครงการ on a project screen", () => {
    expect(tabsForRole("site_owner")).toBe(SITE_OWNER_TABS);
    mockUsePathname.mockReturnValue("/projects/abc/work-packages/def");
    const { container } = render(<BottomTabBar role="site_owner" />);
    expect(screen.queryByText("หน้าหลัก")).not.toBeInTheDocument();
    expect(screen.queryByText("จัดซื้อ")).not.toBeInTheDocument();
    const active = activeTabs(container);
    expect(active).toHaveLength(1);
    expect(active[0]?.textContent).toContain("โครงการ");
  });

  // Spec 376 U1 built the direct-resolve swap for the SA. site_owner redirects
  // from /projects too (PROJECT_LANDING_ROLES), but its tab keeps the STATIC
  // href — the U1 helper is site_admin-only by its own pin, and U5 does not
  // widen it. Pinned so the divergence is a recorded decision, not a surprise:
  // the owner pays one redirect hop, exactly as the SA did before U1.
  it("leaves site_owner's โครงการ tab on the static /projects href", () => {
    mockUsePathname.mockReturnValue("/projects/abc");
    render(<BottomTabBar role="site_owner" />);
    expect(screen.getByRole("link", { name: /โครงการ/ })).toHaveAttribute("href", "/projects");
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

  // Spec 313 U5: the promoted hubs lost their back chip, so for a role that does
  // NOT home there the tab bar is the only "you are here". /accounting was already
  // claimed by ตั้งค่า; /legal was claimed by nothing — super_admin is in
  // LEGAL_ROLES but gets PM_TABS, so it lit zero tabs on a page that no longer has
  // a chip either. Both are pinned here as a pair so the asymmetry cannot return.
  it.each(["/accounting", "/legal"])("lights ตั้งค่า for the PM tier on %s", (path) => {
    mockUsePathname.mockReturnValue(path);
    const { container } = render(<BottomTabBar role="super_admin" />);
    const active = activeTabs(container);
    expect(active).toHaveLength(1);
    expect(active[0]?.textContent).toContain("ตั้งค่า");
  });

  // …but the roles that HOME on those hubs must light their own tab, not ตั้งค่า.
  it("lights บัญชี for the accounting role on /accounting (its own tab wins)", () => {
    mockUsePathname.mockReturnValue("/accounting");
    const { container } = render(<BottomTabBar role="accounting" />);
    const active = activeTabs(container);
    expect(active).toHaveLength(1);
    expect(active[0]?.textContent).toContain("บัญชี");
  });

  // Spec 349 U1: accounting's bar goes work-queue-first — 4 destinations. Short
  // tab labels diverge from the page titles on purpose (the LEGAL_TABS
  // precedent): งานตรวจ for ตรวจเอกสารการเงิน, เอกสาร for เอกสารบริษัท.
  it("pins the accounting tab set (labels, hrefs, order)", () => {
    expect(ACCOUNTING_TABS.map((t) => [t.label, t.href])).toEqual([
      ["งานตรวจ", "/accounting/review"],
      ["บัญชี", "/accounting"],
      ["เอกสาร", "/settings/company-docs"],
      ["ตั้งค่า", "/settings"],
    ]);
  });

  // Spec 349 U1: /accounting/review is prefix-claimed by BOTH งานตรวจ (own href)
  // and บัญชี (/accounting) — longest wins, exactly one lights.
  it("lights งานตรวจ (not บัญชี) for accounting on /accounting/review", () => {
    mockUsePathname.mockReturnValue("/accounting/review");
    const { container } = render(<BottomTabBar role="accounting" />);
    const active = activeTabs(container);
    expect(active).toHaveLength(1);
    expect(active[0]?.textContent).toContain("งานตรวจ");
  });

  // Spec 349 U1: /settings/company-docs is prefix-claimed by BOTH เอกสาร (own
  // href) and ตั้งค่า (/settings) — longest wins, exactly one lights.
  it("lights เอกสาร (not ตั้งค่า) for accounting on /settings/company-docs", () => {
    mockUsePathname.mockReturnValue("/settings/company-docs");
    const { container } = render(<BottomTabBar role="accounting" />);
    const active = activeTabs(container);
    expect(active).toHaveLength(1);
    expect(active[0]?.textContent).toContain("เอกสาร");
  });

  it("lights ตั้งค่า for accounting on /settings itself", () => {
    mockUsePathname.mockReturnValue("/settings");
    const { container } = render(<BottomTabBar role="accounting" />);
    const active = activeTabs(container);
    expect(active).toHaveLength(1);
    expect(active[0]?.textContent).toContain("ตั้งค่า");
  });

  it("lights กฎหมาย for the legal role on /legal (its own tab wins)", () => {
    mockUsePathname.mockReturnValue("/legal");
    const { container } = render(<BottomTabBar role="legal" />);
    const active = activeTabs(container);
    expect(active).toHaveLength(1);
    expect(active[0]?.textContent).toContain("กฎหมาย");
  });

  // Spec 313 U5: /expenses is a /settings drill-down for every role that does not
  // home there, so the ตั้งค่า tab lights on it — before this it lit nothing and
  // the page read as belonging to no section at all.
  it("lights ตั้งค่า for the PM tier on /expenses", () => {
    mockUsePathname.mockReturnValue("/expenses");
    const { container } = render(<BottomTabBar role="project_manager" />);
    const active = activeTabs(container);
    expect(active).toHaveLength(1);
    expect(active[0]?.textContent).toContain("ตั้งค่า");
  });

  // Spec 323 U4's unlit-leaf rule still governs the procurement tiers: their
  // settings tab deliberately matches only /profile, so a door like /expenses
  // lights nothing for them and the STR hub tab is the way back.
  it("keeps /expenses unlit for procurement (spec 323 U4 unlit-leaf rule)", () => {
    mockUsePathname.mockReturnValue("/expenses");
    const { container } = render(<BottomTabBar role="procurement" />);
    expect(activeTabs(container)).toHaveLength(0);
  });

  // Spec 313 U3: the ทีมงาน tab lights across the /team hub and its sub-screens.
  it("lights ทีมงาน for the PM tier on /team and /team/badges", () => {
    for (const path of ["/team", "/team/badges"]) {
      mockUsePathname.mockReturnValue(path);
      const { container, unmount } = render(<BottomTabBar role="project_manager" />);
      const active = activeTabs(container);
      expect(active).toHaveLength(1);
      expect(active[0]?.textContent).toContain("ทีมงาน");
      unmount();
    }
  });

  // Spec 313 U3: /registrations lost its PM tab (folded into /team). It is now an
  // unlit leaf — the deliberate cost of the fold, pinned so it reads as intended
  // rather than as a regression.
  it("lights NO tab for the PM tier on /registrations after the fold", () => {
    mockUsePathname.mockReturnValue("/registrations");
    const { container } = render(<BottomTabBar role="project_manager" />);
    expect(activeTabs(container)).toHaveLength(0);
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

  // Spec 327 U6b: /requests was a STRAND for the procurement tiers since the
  // จัดซื้อ tab dropped (323 U3b) — no lit tab, no back chip. The หน้าหลัก tab
  // claims it via match (the queue is part of home's ทุกโครงการ world), so the
  // bar shows where you are and IS the way back.
  it("lights หน้าหลัก on /requests for the procurement tiers (the queue strand fix)", () => {
    mockUsePathname.mockReturnValue("/requests");
    const { container } = render(<BottomTabBar role="procurement" />);
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

  // SUPERSEDED (spec 327 U6b, checkpoint-2): /requests as a lights-nothing leaf
  // was the 323-U3b acceptance, but with no back chip either it was a genuine
  // STRAND — the operator's back-button audit reversed it. The หน้าหลัก tab now
  // claims the queue family (see the spine's match). Other door leaves
  // (/catalog, /contacts/…) keep the lights-nothing acceptance below.
  it("lights no tab for procurement on a non-queue door leaf like /catalog", () => {
    mockUsePathname.mockReturnValue("/catalog");
    const { container } = render(<BottomTabBar role="procurement" />);
    expect(activeTabs(container)).toHaveLength(0);
    // The bar itself still renders — it is the way back to the hub.
    expect(screen.getByRole("link", { name: /หน้าหลัก/ })).toHaveAttribute("href", "/procurement");
  });

  // Spec 323 U4: for the procurement tiers the reference surfaces (/contacts,
  // /catalog, /equipment, /workers, /payroll) are STR hub DOORS now, not
  // settings sub-surfaces — their ตั้งค่า tab must NOT claim them (it would
  // light on doors that no longer exist in their settings). They are leaves
  // (the spec-19 acceptance), like /catalog above.
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

// Writing failing test first.
//
// Spec 376 U1 — the SA's โครงการ tab points AT her project, not at the /projects
// hub that redirects her there (one tap = two route_views, the refuted-#846
// artifact). The swap is render-only: SA_TABS above stays static, so every guard
// and lighting pin keyed on the constant still holds. Non-SA roles never swap.
describe("BottomTabBar — SA โครงการ tab direct-resolve (spec 376 U1)", () => {
  const UUID = "0a1b2c3d-4e5f-6071-8293-a4b5c6d7e8f9";

  function projectsHref(): string | null {
    return screen.getByRole("link", { name: /โครงการ/ }).getAttribute("href");
  }

  it("swaps in the /sa-resolved href for site_admin", () => {
    mockUsePathname.mockReturnValue("/sa");
    render(<BottomTabBar role="site_admin" projectsTabHref={`/projects/${UUID}`} />);
    expect(projectsHref()).toBe(`/projects/${UUID}`);
  });

  it("leaves the static /projects href for a non-SA role given the same prop", () => {
    mockUsePathname.mockReturnValue("/dashboard");
    render(<BottomTabBar role="project_manager" projectsTabHref={`/projects/${UUID}`} />);
    expect(projectsHref()).toBe("/projects");
  });

  it("derives the project root from the pathname when no prop is passed", () => {
    mockUsePathname.mockReturnValue(`/projects/${UUID}/work-packages/${UUID}`);
    const { container } = render(<BottomTabBar role="site_admin" />);
    expect(projectsHref()).toBe(`/projects/${UUID}`);
    // Longest-prefix still lights exactly one tab, and it is this one.
    const active = container.querySelectorAll('[aria-current="page"]');
    expect(active).toHaveLength(1);
    expect(active[0]?.textContent).toContain("โครงการ");
  });

  it("keeps the swapped tab lit on the bare /projects hub (?view=all)", () => {
    mockUsePathname.mockReturnValue("/projects");
    const { container } = render(
      <BottomTabBar role="site_admin" projectsTabHref={`/projects/${UUID}`} />,
    );
    const active = container.querySelectorAll('[aria-current="page"]');
    expect(active).toHaveLength(1);
    expect(active[0]?.textContent).toContain("โครงการ");
  });
});

// Writing failing test first.
//
// Spec 376 U3 (D3) — the technician arm. `tabsForRole("technician")` returned
// null, so a ช่าง navigated one long scroll page with no bar at all (13 views /
// 14d, spec §1). Three tabs now: the daily home, the new ประวัติ money route,
// and the universal profile. The ประวัติ href lives UNDER /technician, so the
// longest-prefix rule is what keeps exactly one tab lit on it.
// Writing failing test first.
//
// Spec 388 U3 (D1): the 3-tab set of spec 376 U3 becomes two. What matters
// behaviourally is not the count but that NOTHING went dark: every route the
// retired tabs used to light must still light exactly one tab, or the role gets
// a bar that says "you are nowhere" on a page it can reach.
describe("BottomTabBar — technician 2-tab set (spec 388 U3)", () => {
  it("maps the technician role to TECHNICIAN_TABS", () => {
    expect(tabsForRole("technician")).toBe(TECHNICIAN_TABS);
  });

  it("renders both tabs as links to their roots", () => {
    mockUsePathname.mockReturnValue("/technician");
    render(<BottomTabBar role="technician" />);
    expect(screen.getByRole("link", { name: /หน้าหลัก/ })).toHaveAttribute("href", "/technician");
    expect(screen.getByRole("link", { name: /ตั้งค่า/ })).toHaveAttribute("href", "/settings");
  });

  it("no longer renders ประวัติ or โปรไฟล์ tabs", () => {
    mockUsePathname.mockReturnValue("/technician");
    render(<BottomTabBar role="technician" />);
    expect(screen.queryByRole("link", { name: /ประวัติ/ })).toBeNull();
    expect(screen.queryByRole("link", { name: /โปรไฟล์/ })).toBeNull();
  });

  it("lights หน้าหลัก on /technician", () => {
    mockUsePathname.mockReturnValue("/technician");
    const { container } = render(<BottomTabBar role="technician" />);
    const active = activeTabs(container);
    expect(active).toHaveLength(1);
    expect(active[0]?.textContent).toContain("หน้าหลัก");
  });

  it("lights หน้าหลัก on /technician/history — the drill-down keeps its section", () => {
    // The row that reaches it lives on หน้าหลัก, so the tab that stays lit is the
    // section the page belongs to. Under the 3-tab set ประวัติ won this by
    // longest prefix; with that tab gone the /technician prefix must take it,
    // rather than the bar going blank on a page a ช่าง can still open.
    mockUsePathname.mockReturnValue("/technician/history");
    const { container } = render(<BottomTabBar role="technician" />);
    const active = activeTabs(container);
    expect(active).toHaveLength(1);
    expect(active[0]?.textContent).toContain("หน้าหลัก");
  });

  it("lights ตั้งค่า on /profile — D1's whole premise, asserted behaviourally", () => {
    // โปรไฟล์ left the bar; SETTINGS_TAB.match carries /profile, so the route
    // still belongs to a visible section. If this ever went dark, a ช่าง on
    // /profile would see a bar claiming they are on neither of their two tabs.
    mockUsePathname.mockReturnValue("/profile");
    const { container } = render(<BottomTabBar role="technician" />);
    const active = activeTabs(container);
    expect(active).toHaveLength(1);
    expect(active[0]?.textContent).toContain("ตั้งค่า");
  });

  it("lights ตั้งค่า on /settings — the new door (D2)", () => {
    mockUsePathname.mockReturnValue("/settings");
    const { container } = render(<BottomTabBar role="technician" />);
    const active = activeTabs(container);
    expect(active).toHaveLength(1);
    expect(active[0]?.textContent).toContain("ตั้งค่า");
  });
});

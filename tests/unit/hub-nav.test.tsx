// Component tests for the shared hub nav strip (spec 18 item B): one
// consistent item set per role surface, current page rendered as a
// non-link span, no directional arrow glyphs, taller tap targets.

import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import {
  HubNav,
  PM_HUB_NAV,
  SA_HUB_NAV,
  PROCUREMENT_HUB_NAV,
  PROCUREMENT_MANAGER_HUB_NAV,
  COORDINATOR_HUB_NAV,
  ACCOUNTING_HUB_NAV,
  hubNavForRole,
} from "@/components/features/chrome/hub-nav";
import { PAGE_MAX_W } from "@/lib/ui/page-width";

// Spec 93: desktop mirrors the bottom bar — daily deciders + a ตั้งค่า entry;
// payroll/contacts/workers/account moved into the /settings hub.
// Spec 183 U2: รายการรอตรวจ dropped — the review queue moved off the nav into a
// dashboard card; ภาพรวม leads the PM strip and carries the pending count.
// Spec 263 U3 / spec 264 G4: คำขอสมัคร (the staff-registration approval queue,
// role-neutral) added before ตั้งค่า.
// Operator report 2026-07-06 ("cannot find menu about technicians' information"):
// ทีมงาน → /workers added to the PM strip — the roster was reachable only via the
// /settings hub for the PM tier while both procurement strips had a direct item.
// Same label/href as those strips; placed before คำขอสมัคร, mirroring
// PROCUREMENT_MANAGER_HUB_NAV's ordering. Access unchanged (PM tier is already
// in WORKER_ROSTER_ROLES).
const PM_ITEMS = [
  { label: "โครงการและรายงาน", href: "/projects" },
  { label: "จัดซื้อ", href: "/requests" },
  { label: "ภาพรวม", href: "/dashboard" },
  { label: "ทีมงาน", href: "/workers" },
  { label: "คำขอสมัคร", href: "/registrations" },
  { label: "ตั้งค่า", href: "/settings" },
];

describe("canonical nav sets", () => {
  it("pins the PM set's destinations and order", () => {
    expect(PM_HUB_NAV).toEqual(PM_ITEMS);
  });

  it("pins the SA set's destinations and order", () => {
    expect(SA_HUB_NAV).toEqual([
      // Spec 192 U4: the daily home leads; ภาพรวม dropped from the SA strip.
      { label: "หน้าหลัก", href: "/sa" },
      { label: "โครงการ", href: "/projects" },
      { label: "จัดซื้อ", href: "/requests" },
      { label: "ตั้งค่า", href: "/settings" },
    ]);
  });

  // Spec 323 U3b: procurement's desktop strip mirrors the STR bottom-tab spine
  // exactly (nav-law rule 2 — the strip carries every bottom-tab destination;
  // the old strip-only supersets ทีมงาน/ผู้รับเหมาช่วง are now hub doors under
  // ทรัพยากร, one click in via the /procurement hub).
  it("pins the procurement set's destinations and order (STR spine)", () => {
    expect(PROCUREMENT_HUB_NAV).toEqual([
      { label: "หน้าหลัก", href: "/procurement" },
      { label: "ขอบเขต", href: "/procurement/scope" },
      { label: "เวลา", href: "/procurement/time" },
      { label: "ทรัพยากร", href: "/procurement/resources" },
      { label: "ตั้งค่า", href: "/settings" },
    ]);
  });

  // Spec 153: accounting's desktop strip — the ledger surface + settings,
  // mirroring ACCOUNTING_TABS (the phone bottom bar).
  it("pins the accounting set's destinations and order", () => {
    expect(ACCOUNTING_HUB_NAV).toEqual([
      { label: "บัญชี", href: "/accounting" },
      { label: "ตั้งค่า", href: "/settings" },
    ]);
  });

  // Spec 323 U3b: procurement_manager rides the SAME STR spine — its old
  // คำขอสมัคร strip item is gone because the approval queue re-homed as the
  // /procurement hub's nudge + count (U3a).
  it("pins the procurement_manager set's destinations and order (STR spine)", () => {
    expect(PROCUREMENT_MANAGER_HUB_NAV).toEqual([
      { label: "หน้าหลัก", href: "/procurement" },
      { label: "ขอบเขต", href: "/procurement/scope" },
      { label: "เวลา", href: "/procurement/time" },
      { label: "ทรัพยากร", href: "/procurement/resources" },
      { label: "ตั้งค่า", href: "/settings" },
    ]);
  });
});

// Spec 153: hubNavForRole is the single role→strip selector (mirrors tabsForRole),
// so the same strip renders on every hub page including /settings + /dashboard.
describe("hubNavForRole", () => {
  it("maps each served role to its set", () => {
    expect(hubNavForRole("site_admin")).toBe(SA_HUB_NAV);
    // PM tier (pm / super_admin / project_director) all share PM_HUB_NAV.
    expect(hubNavForRole("project_manager")).toBe(PM_HUB_NAV);
    expect(hubNavForRole("super_admin")).toBe(PM_HUB_NAV);
    expect(hubNavForRole("project_director")).toBe(PM_HUB_NAV);
    expect(hubNavForRole("procurement")).toBe(PROCUREMENT_HUB_NAV);
    // Spec 263 follow-up: procurement_manager previously fell through to null.
    expect(hubNavForRole("procurement_manager")).toBe(PROCUREMENT_MANAGER_HUB_NAV);
    expect(hubNavForRole("project_coordinator")).toBe(COORDINATOR_HUB_NAV);
    expect(hubNavForRole("accounting")).toBe(ACCOUNTING_HUB_NAV);
  });

  it("returns null for an unserved role (render nothing, like the bottom bar)", () => {
    expect(hubNavForRole("visitor")).toBeNull();
  });
});

describe("HubNav", () => {
  // Spec 169: every item is a link to its root (first-layer destination); the
  // current page is marked by aria-current, not demoted to an inert span — so a
  // click from a sub-page returns to the section top, like the bottom tab bar.
  it("renders every item as a link; the current page carries aria-current", () => {
    render(<HubNav maxWidthClass={PAGE_MAX_W} items={PM_ITEMS} currentHref="/projects" />);
    const current = screen.getByRole("link", { name: "โครงการและรายงาน" });
    expect(current).toHaveAttribute("href", "/projects");
    expect(current).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: "จัดซื้อ" })).toHaveAttribute("href", "/requests");
  });

  it("renders no directional arrow glyphs", () => {
    const { container } = render(
      <HubNav maxWidthClass={PAGE_MAX_W} items={PM_ITEMS} currentHref="/review" />,
    );
    expect(container.textContent).not.toMatch(/[→←]/);
  });

  it("gives links a min-h-11 tap target", () => {
    render(<HubNav maxWidthClass={PAGE_MAX_W} items={PM_ITEMS} currentHref="/review" />);
    expect(screen.getByRole("link", { name: "จัดซื้อ" }).className).toContain("min-h-11");
  });

  // Spec 100/169: ภาพรวม is a live link; on /dashboard it stays a link, marked
  // current by aria-current (no longer demoted to a span).
  it("renders ภาพรวม as a link, current-marked on /dashboard", () => {
    const { unmount } = render(
      <HubNav maxWidthClass={PAGE_MAX_W} items={PM_ITEMS} currentHref="/review" />,
    );
    const link = screen.getByRole("link", { name: "ภาพรวม" });
    expect(link).toHaveAttribute("href", "/dashboard");
    expect(link).not.toHaveAttribute("aria-current");
    unmount();
    render(<HubNav maxWidthClass={PAGE_MAX_W} items={PM_ITEMS} currentHref="/dashboard" />);
    expect(screen.getByRole("link", { name: "ภาพรวม" })).toHaveAttribute("aria-current", "page");
  });
});

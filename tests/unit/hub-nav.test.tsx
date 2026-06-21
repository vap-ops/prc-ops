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
  COORDINATOR_HUB_NAV,
  ACCOUNTING_HUB_NAV,
  hubNavForRole,
} from "@/components/features/chrome/hub-nav";
import { PAGE_MAX_W } from "@/lib/ui/page-width";

// Spec 93: desktop mirrors the bottom bar — daily deciders + a ตั้งค่า entry;
// payroll/contacts/workers/account moved into the /settings hub.
const PM_ITEMS = [
  { label: "รายการรอตรวจ", href: "/review" },
  { label: "โครงการและรายงาน", href: "/projects" },
  { label: "คำขอซื้อ", href: "/requests" },
  // Spec 100: ภาพรวม is the live dashboard, before ตั้งค่า.
  { label: "ภาพรวม", href: "/dashboard" },
  { label: "ตั้งค่า", href: "/settings" },
];

describe("canonical nav sets", () => {
  it("pins the PM set's destinations and order", () => {
    expect(PM_HUB_NAV).toEqual(PM_ITEMS);
  });

  it("pins the SA set's destinations and order", () => {
    expect(SA_HUB_NAV).toEqual([
      { label: "โครงการ", href: "/projects" },
      { label: "คำขอซื้อ", href: "/requests" },
      // Spec 100: ภาพรวม is the live dashboard, before ตั้งค่า.
      { label: "ภาพรวม", href: "/dashboard" },
      { label: "ตั้งค่า", href: "/settings" },
    ]);
  });

  // Spec 101: procurement's desktop strip — worklist + suppliers + settings.
  // Spec 172 Phase B added ผู้รับเหมาช่วง (subcontractor curation); Phase C added
  // ทีมงาน → /workers (DC onboarding). Both back-office domains procurement owns.
  it("pins the procurement set's destinations and order", () => {
    expect(PROCUREMENT_HUB_NAV).toEqual([
      { label: "คำขอซื้อ", href: "/requests" },
      { label: "โครงการ", href: "/projects" },
      { label: "ผู้ขาย", href: "/contacts/vendors" },
      { label: "ผู้รับเหมาช่วง", href: "/contacts/subcontractors" },
      { label: "ทีมงาน", href: "/workers" },
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
    expect(screen.getByRole("link", { name: "รายการรอตรวจ" })).toHaveAttribute("href", "/review");
    expect(screen.getByRole("link", { name: "คำขอซื้อ" })).toHaveAttribute("href", "/requests");
  });

  it("renders no directional arrow glyphs", () => {
    const { container } = render(
      <HubNav maxWidthClass={PAGE_MAX_W} items={PM_ITEMS} currentHref="/review" />,
    );
    expect(container.textContent).not.toMatch(/[→←]/);
  });

  it("gives links a min-h-11 tap target", () => {
    render(<HubNav maxWidthClass={PAGE_MAX_W} items={PM_ITEMS} currentHref="/review" />);
    expect(screen.getByRole("link", { name: "คำขอซื้อ" }).className).toContain("min-h-11");
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

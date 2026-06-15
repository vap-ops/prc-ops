// Component tests for the shared hub nav strip (spec 18 item B): one
// consistent item set per role surface, current page rendered as a
// non-link span, no directional arrow glyphs, taller tap targets.

import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { HubNav, PM_HUB_NAV, SA_HUB_NAV, PROCUREMENT_HUB_NAV } from "@/components/features/hub-nav";
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
  it("pins the procurement set's destinations and order", () => {
    expect(PROCUREMENT_HUB_NAV).toEqual([
      { label: "คำขอซื้อ", href: "/requests" },
      { label: "ผู้ขาย", href: "/contacts/vendors" },
      { label: "ตั้งค่า", href: "/settings" },
    ]);
  });
});

describe("HubNav", () => {
  it("renders every item, with the current page as a span and the rest as links", () => {
    render(<HubNav maxWidthClass={PAGE_MAX_W} items={PM_ITEMS} currentHref="/projects" />);
    const current = screen.getByText("โครงการและรายงาน");
    expect(current.tagName).toBe("SPAN");
    expect(screen.queryByRole("link", { name: "โครงการและรายงาน" })).not.toBeInTheDocument();
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

  // Spec 100: ภาพรวม is a live link that becomes the current span on /dashboard.
  it("renders ภาพรวม as a link, and as the current span on /dashboard", () => {
    const { unmount } = render(
      <HubNav maxWidthClass={PAGE_MAX_W} items={PM_ITEMS} currentHref="/review" />,
    );
    expect(screen.getByRole("link", { name: "ภาพรวม" })).toHaveAttribute("href", "/dashboard");
    unmount();
    render(<HubNav maxWidthClass={PAGE_MAX_W} items={PM_ITEMS} currentHref="/dashboard" />);
    expect(screen.getByText("ภาพรวม").tagName).toBe("SPAN");
    expect(screen.queryByRole("link", { name: "ภาพรวม" })).not.toBeInTheDocument();
  });
});

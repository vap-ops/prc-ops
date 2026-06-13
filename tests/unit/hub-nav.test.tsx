// Component tests for the shared hub nav strip (spec 18 item B): one
// consistent item set per role surface, current page rendered as a
// non-link span, no directional arrow glyphs, taller tap targets.

import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { HubNav, PM_HUB_NAV, SA_HUB_NAV } from "@/components/features/hub-nav";
import { PAGE_MAX_W } from "@/lib/ui/page-width";

// Spec 19 §4: /pm/requests merged into /requests — one purchasing entry.
// Spec 69: a fourth item, the PM-only DC payroll surface.
// Spec 81: a fifth item, contacts management.
const PM_ITEMS = [
  // Spec 82 Unit 4: review queue /review, payroll /payroll, contacts /contacts.
  { label: "รายการรอตรวจ", href: "/review" },
  // Spec 82 Unit 3: the project hub folded to /projects.
  { label: "โครงการและรายงาน", href: "/projects" },
  { label: "คำขอซื้อ", href: "/requests" },
  { label: "ค่าจ้าง", href: "/payroll" },
  { label: "รายชื่อติดต่อ", href: "/contacts" },
];

describe("canonical nav sets", () => {
  it("pins the PM set's destinations and order", () => {
    expect(PM_HUB_NAV).toEqual(PM_ITEMS);
  });

  it("pins the SA set's destinations and order", () => {
    expect(SA_HUB_NAV).toEqual([
      { label: "โครงการ", href: "/projects" },
      { label: "คำขอซื้อ", href: "/requests" },
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
});

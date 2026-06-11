// Component tests for the shared hub nav strip (spec 18 item B): one
// consistent item set per role surface, current page rendered as a
// non-link span, no directional arrow glyphs, taller tap targets.

import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { HubNav, PM_HUB_NAV, SA_HUB_NAV } from "@/components/features/hub-nav";

const PM_ITEMS = [
  { label: "รายการรอตรวจ", href: "/pm" },
  { label: "โครงการและรายงาน", href: "/pm/projects" },
  { label: "คำขอซื้อ", href: "/pm/requests" },
  { label: "คำขอซื้อของฉัน", href: "/requests" },
];

describe("canonical nav sets", () => {
  it("pins the PM set's destinations and order", () => {
    expect(PM_HUB_NAV).toEqual(PM_ITEMS);
  });

  it("pins the SA set's destinations and order", () => {
    expect(SA_HUB_NAV).toEqual([
      { label: "โครงการ", href: "/sa" },
      { label: "คำขอซื้อของฉัน", href: "/requests" },
    ]);
  });
});

describe("HubNav", () => {
  it("renders every item, with the current page as a span and the rest as links", () => {
    render(<HubNav maxWidthClass="max-w-2xl" items={PM_ITEMS} currentHref="/pm/projects" />);
    const current = screen.getByText("โครงการและรายงาน");
    expect(current.tagName).toBe("SPAN");
    expect(screen.queryByRole("link", { name: "โครงการและรายงาน" })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "รายการรอตรวจ" })).toHaveAttribute("href", "/pm");
    expect(screen.getByRole("link", { name: "คำขอซื้อ" })).toHaveAttribute("href", "/pm/requests");
    expect(screen.getByRole("link", { name: "คำขอซื้อของฉัน" })).toHaveAttribute(
      "href",
      "/requests",
    );
  });

  it("renders no directional arrow glyphs", () => {
    const { container } = render(
      <HubNav maxWidthClass="max-w-2xl" items={PM_ITEMS} currentHref="/pm" />,
    );
    expect(container.textContent).not.toMatch(/[→←]/);
  });

  it("gives links a min-h-11 tap target", () => {
    render(<HubNav maxWidthClass="max-w-2xl" items={PM_ITEMS} currentHref="/pm" />);
    expect(screen.getByRole("link", { name: "คำขอซื้อ" }).className).toContain("min-h-11");
  });
});

// Spec 211 U6b — the PO-detail breadcrumb makes the level legible: you are in
// the จัดซื้อ area, viewing one ใบสั่งซื้อ (PO-####). Load-bearing rules: the
// area crumb (จัดซื้อ) is the ONLY link (back to /requests); the current order
// crumb is plain text + the typed PO chip, never a link.

import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { PoBreadcrumb } from "@/components/features/purchasing/po-breadcrumb";

describe("PoBreadcrumb (spec 211 U6b)", () => {
  it("links the จัดซื้อ area crumb back to the worklist", () => {
    render(<PoBreadcrumb poNumber={12} />);
    const link = screen.getByRole("link", { name: "จัดซื้อ" });
    expect(link).toHaveAttribute("href", "/requests");
  });

  it("shows the ใบสั่งซื้อ level word and the zero-padded PO number", () => {
    render(<PoBreadcrumb poNumber={12} />);
    expect(screen.getByText("ใบสั่งซื้อ")).toBeInTheDocument();
    expect(screen.getByText("PO-0012")).toBeInTheDocument();
  });

  it("makes ONLY the area crumb a link — the current order is not navigable", () => {
    render(<PoBreadcrumb poNumber={3} />);
    // The จัดซื้อ parent is the single crumb-link; the current PO is terminal.
    expect(screen.getAllByRole("link")).toHaveLength(1);
  });
});

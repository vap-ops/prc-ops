// Writing failing test first.
//
// Spec 197 U3 — empty-คลัง state. A brand-new project's store is empty; a bare
// "no stock" line is a dead end. The empty state should instead lead with the
// รับเข้าสต๊อก action and point at the two ways to fill the store — รับเข้า
// directly or via the project's แผนจัดหา (supply plan). The แผนจัดหา portion is a
// link to the supply-plan chip ONLY when the viewer can reach it (site_admin
// can't plan supply, so for them it stays plain text, not a dead link).

import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));
vi.mock("@/app/store/actions", () => ({
  recordStockIn: vi.fn(),
  issueStock: vi.fn(),
  recordStockCount: vi.fn(),
  reverseStockReceipt: vi.fn(),
  reverseStockIssue: vi.fn(),
  confirmStockIssueOnBehalf: vi.fn(),
}));

import { StoreManager } from "@/components/features/store/store-manager";

const base = {
  projects: [{ id: "p1", code: "PRC-2026-001", name: "บ้านคุณเอ" }],
  selectedProjectId: "p1",
  onHand: [],
  catalogItems: [],
  suppliers: [],
  canIssue: false,
  workPackages: [],
  workers: [],
  receipts: [],
  counts: [],
  hidePicker: true,
};

describe("spec 197 U3 — empty คลัง state", () => {
  it("leads with รับเข้า and links แผนจัดหา when the viewer can plan supply", () => {
    render(<StoreManager {...base} emptyStateSupplyPlanHref="/projects/p1/supply-plan" />);
    expect(screen.getByText(/ยังไม่มีของในคลัง/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /รับเข้าสต๊อก/ })).toBeInTheDocument();
    const link = screen.getByRole("link", { name: "แผนจัดหา" });
    expect(link).toHaveAttribute("href", "/projects/p1/supply-plan");
  });

  it("shows แผนจัดหา as plain text (no link) when the viewer cannot plan supply", () => {
    render(<StoreManager {...base} emptyStateSupplyPlanHref={null} />);
    expect(screen.getByText(/ยังไม่มีของในคลัง/)).toBeInTheDocument();
    expect(screen.getByText(/แผนจัดหา/)).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "แผนจัดหา" })).toBeNull();
  });
});

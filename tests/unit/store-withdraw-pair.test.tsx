// Writing failing test first.
//
// Spec 375 U3 — the `เบิกจากคลังหน้างาน` custody pair.
//
// Operator: "why not have เบิกวัสดุ next to เบิกอุปกรณ์?" The SA has custody of
// BOTH and both are withdrawals from the same physical store (SA-custody +
// store-first doctrine), so they read as one category rather than two loose tiles.
// Live grounding: `/equipment*` drew 4 site_admin route events in 7 days against
// 21 on the project store, and `equipment_usage_logs` is still 0 rows across 64
// items — the equipment half is the one with no traffic, and pairing it with the
// known door is what teaches it.
//
// ⚠️ ONE materials door only. The pair REPLACES the generic คลัง tile; shipping
// both would be the duplicate-door defect that retired the ทีมงาน tile in spec
// 313 U3. คลัง survives as the destination noun in the hub row and bottom tab.

import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { StoreWithdrawPair } from "@/components/features/sa/store-withdraw-pair";

describe("<StoreWithdrawPair> (spec 375 U3)", () => {
  it("names the pair once, over both halves", () => {
    render(<StoreWithdrawPair projectId="p1" from="/sa" />);
    expect(screen.getByRole("heading", { name: /เบิกจากคลังหน้างาน/ })).toBeInTheDocument();
  });

  it("sends เบิกวัสดุ to the project store", () => {
    render(<StoreWithdrawPair projectId="p1" from="/sa" />);
    expect(screen.getByRole("link", { name: /เบิกวัสดุ/ })).toHaveAttribute(
      "href",
      "/projects/p1/store",
    );
  });

  it("sends เบิกอุปกรณ์ to the scan door, carrying the back href", () => {
    render(<StoreWithdrawPair projectId="p1" from="/sa" />);
    const link = screen.getByRole("link", { name: /เบิกอุปกรณ์/ });
    // /equipment/scan runs `from` through safeBackHref, so a missing value lands
    // the SA on a default instead of back where she came from.
    expect(link.getAttribute("href")).toBe("/equipment/scan?from=%2Fsa");
  });

  it("falls back to the project picker when the SA has no resolved project", () => {
    // Mirrors SaTools: the materials half is project-scoped, so with no project
    // it must still offer a way forward rather than a dead or absent link.
    render(<StoreWithdrawPair projectId={null} from="/sa" />);
    expect(screen.getByRole("link", { name: /เบิกวัสดุ/ })).toHaveAttribute("href", "/projects");
    // Equipment is ONE company-wide registry (spec 367 D1) — not project-scoped,
    // so its half is unaffected by a missing project.
    expect(screen.getByRole("link", { name: /เบิกอุปกรณ์/ })).toHaveAttribute(
      "href",
      "/equipment/scan?from=%2Fsa",
    );
  });

  it("shows no counts on either half", () => {
    // Deliberate narrowing of spec §2.4, recorded in the spec: a CORRECT
    // open-loan count needs the supersede ANTI-JOIN (candidates minus rows
    // pointed at by another row's superseded_by, ADR 0009) — two row-reads plus
    // in-memory filtering, which is exactly the cost spec 370 refused on the
    // app's heaviest page. The naive `superseded_by is null` form is the WRONG
    // read and would resurrect closed loans as open. A wrong number here is
    // worse than none; the store page already shows the real figures.
    render(<StoreWithdrawPair projectId="p1" from="/sa" />);
    expect(screen.queryByText(/ยืมอยู่/)).not.toBeInTheDocument();
    expect(screen.queryByText(/\d+\s*(ชิ้น|รายการ)/)).not.toBeInTheDocument();
  });

  it("gives both halves a real tap target", () => {
    render(<StoreWithdrawPair projectId="p1" from="/sa" />);
    for (const link of screen.getAllByRole("link")) {
      // The 44px floor is a CI-guarded house rule; min-h-16 clears it.
      expect(link.className).toMatch(/min-h-16/);
    }
  });
});

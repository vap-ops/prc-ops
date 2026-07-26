// Spec 361 U4 — the procurement master-data hub (ข้อมูลหลัก).
//
// Two things under test: the pure group SSOT (what lists exist, where each is
// edited, which have no editor yet) and the board that renders it. The hub is
// the operator's ask 2026-07-26 — "group catalog settings for her, like
// materials/staffs on-site/rentals/other expenses" — so the GROUP ORDER is a
// pinned contract, not decoration: it mirrors the order she named them in.

import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import {
  MASTER_DATA_GROUPS,
  masterDataEntries,
  type MasterDataCounts,
} from "@/lib/purchasing/master-data";
import { MasterDataBoard } from "@/components/features/purchasing/master-data-board";
import { PROCUREMENT_STR_SECTIONS } from "@/lib/purchasing/procurement-home";
import { MASTER_DATA_LABEL } from "@/lib/i18n/labels";

const ALL_COUNTS: MasterDataCounts = {
  catalogItems: 556,
  catalogCategories: 15,
  catalogUnits: 25,
  orderingTemplates: 28,
  equipmentItems: 63,
  equipmentCategories: 9,
  workCategories: 52,
  workerLevelRates: 4,
  expenseCategories: 8,
  suppliers: 54,
  contractors: 10,
};

describe("master-data group SSOT (spec 361 U4)", () => {
  it("groups follow the order the operator named them in", () => {
    expect(MASTER_DATA_GROUPS.map((g) => g.key)).toEqual([
      "materials",
      "rentals",
      "people",
      "expenses",
      "partners",
    ]);
  });

  it("every entry names a count key and is either editable somewhere or explicitly not yet", () => {
    for (const entry of masterDataEntries()) {
      expect(entry.label.length, entry.key).toBeGreaterThan(0);
      expect(entry.countKey, entry.key).toBeTruthy();
      // An entry with no href MUST say so deliberately — a silently dead tile
      // is the affordance-then-refuse shape (doctrine §3).
      if (entry.href === null) expect(entry.editorPending, entry.key).toBe(true);
      else expect(entry.editorPending, entry.key).toBe(false);
    }
  });

  it("hrefs are unique — one door per destination", () => {
    const hrefs = masterDataEntries()
      .map((e) => e.href)
      .filter((h): h is string => h !== null);
    expect(new Set(hrefs).size).toBe(hrefs.length);
  });

  it("keys are unique across groups", () => {
    const keys = masterDataEntries().map((e) => e.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("covers the four lists the operator named plus the three the audit found", () => {
    const keys = masterDataEntries().map((e) => e.key);
    // Operator's four
    expect(keys).toContain("catalog-items");
    expect(keys).toContain("worker-level-rates");
    expect(keys).toContain("equipment-items");
    expect(keys).toContain("expense-categories");
    // The audit's three (spec 361 §1.3)
    expect(keys).toContain("work-categories");
    expect(keys).toContain("catalog-units");
    expect(keys).toContain("equipment-categories");
  });

  it("the lists with no in-app editor today are exactly the ones spec 361 says", () => {
    const pending = masterDataEntries()
      .filter((e) => e.editorPending)
      .map((e) => e.key)
      .sort();
    expect(pending).toEqual([
      "catalog-units",
      "equipment-categories",
      "expense-categories",
      "work-categories",
    ]);
  });
});

describe("the Resources door (spec 361 U4)", () => {
  it("Resources carries a ข้อมูลหลัก door pointing at the hub", () => {
    const resources = PROCUREMENT_STR_SECTIONS.find((s) => s.key === "resources")!;
    const door = resources.doors.find((d) => d.key === "master-data");
    expect(door).toBeDefined();
    expect(door?.href).toBe("/procurement/master-data");
    expect(door?.label).toBe(MASTER_DATA_LABEL);
    expect(door?.scope).toBe("shared");
  });
});

describe("MasterDataBoard", () => {
  it("renders every group heading and every entry label", () => {
    render(<MasterDataBoard counts={ALL_COUNTS} from="/procurement/resources" isManager />);
    for (const group of MASTER_DATA_GROUPS) {
      expect(screen.getByRole("heading", { name: group.label })).toBeInTheDocument();
    }
    for (const entry of masterDataEntries()) {
      expect(screen.getAllByText(entry.label).length).toBeGreaterThan(0);
    }
  });

  it("an editable list is a link carrying the back referrer; a pending one is not a link", () => {
    render(<MasterDataBoard counts={ALL_COUNTS} from="/procurement/resources" isManager />);
    const catalog = screen.getByRole("link", { name: /ทะเบียนวัสดุ/ });
    expect(catalog).toHaveAttribute("href", expect.stringContaining("/catalog"));
    expect(catalog).toHaveAttribute("href", expect.stringContaining("from=%2Fprocurement%2F"));
    expect(screen.queryByRole("link", { name: /หน่วยนับ/ })).toBeNull();
  });

  it("a pending list still shows its count and says it cannot be edited in the app yet", () => {
    render(<MasterDataBoard counts={ALL_COUNTS} from="/procurement/resources" isManager />);
    const units = screen.getByTestId("master-data-catalog-units");
    expect(within(units).getByText("25")).toBeInTheDocument();
    expect(within(units).getByText(/ยังแก้ไขในแอปไม่ได้/)).toBeInTheDocument();
  });

  it("an unknown count renders no number at all — never a misleading 0", () => {
    render(
      <MasterDataBoard
        counts={{ ...ALL_COUNTS, suppliers: null }}
        from="/procurement/resources"
        isManager
      />,
    );
    const suppliers = screen.getByTestId("master-data-suppliers");
    expect(within(suppliers).queryByText("0")).toBeNull();
    expect(within(suppliers).queryByText("54")).toBeNull();
  });

  // ค่าแรงมาตรฐาน is money-set: /settings/labor-rates admits procurement_manager
  // + super_admin only. Showing plain procurement a tile she cannot open is the
  // affordance-then-refuse shape the spec-348 U3 finding names.
  it("hides the manager-only list from plain procurement", () => {
    render(<MasterDataBoard counts={ALL_COUNTS} from="/procurement/resources" isManager={false} />);
    expect(screen.queryByTestId("master-data-worker-level-rates")).toBeNull();
    expect(screen.getByTestId("master-data-catalog-items")).toBeInTheDocument();
  });
});

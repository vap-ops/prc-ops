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
import { PROCUREMENT_TABS } from "@/components/features/chrome/bottom-tab-bar";
import { MASTER_DATA_LABEL } from "@/lib/i18n/labels";

const ALL_COUNTS: MasterDataCounts = {
  catalogItems: 556,
  catalogCategories: 15,
  catalogUnits: 25,
  orderingTemplates: 28,
  equipmentCatalogItems: 39,
  equipmentItems: 63,
  equipmentCategories: 13,
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

  it("every entry is either editable somewhere or explicitly not yet", () => {
    for (const entry of masterDataEntries()) {
      // An entry with no href MUST say so deliberately — a silently dead tile
      // is the affordance-then-refuse shape (doctrine §3).
      if (entry.href === null) expect(entry.editorPending, entry.key).toBe(true);
      else expect(entry.editorPending, entry.key).toBe(false);
    }
  });

  // Exact hrefs, not `stringContaining` — a substring assertion survives
  // repointing วัสดุ at /catalog/boq-templates, which is precisely the kind of
  // silent mis-link this table exists to prevent. Two rows may share a
  // destination (/equipment hosts both the registry and the category quick-add).
  it("every entry points exactly where its list is curated", () => {
    const actual = Object.fromEntries(masterDataEntries().map((e) => [e.key, e.href]));
    expect(actual).toEqual({
      "catalog-items": "/catalog",
      "catalog-categories": "/catalog/subcategories",
      "catalog-units": "/catalog/units",
      "ordering-templates": "/settings/ordering-templates",
      // Spec 385 U3a: the ทะเบียน is the SKU catalog page; the per-unit registry
      // keeps /equipment; categories are curated on the catalog page (a category
      // is a property of the TYPE).
      "equipment-catalog": "/equipment/catalog",
      "equipment-items": "/equipment",
      "equipment-categories": "/equipment/catalog",
      "worker-level-rates": "/settings/labor-rates",
      "work-categories": null,
      "expense-categories": null,
      suppliers: "/contacts/vendors",
      contractors: "/contacts/subcontractors",
    });
  });

  // Every row must read its OWN count — one shared key would show the same
  // number on every list and no other assertion here would notice.
  it("count keys are one-to-one with the counts contract", () => {
    const used = masterDataEntries().map((e) => e.countKey);
    expect(new Set(used).size).toBe(used.length);
    expect([...used].sort()).toEqual(Object.keys(ALL_COUNTS).sort());
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
    // หมวดอุปกรณ์ is NOT here: /equipment's QuickAddCategory can add one
    // (createEquipmentCategory, BACK_OFFICE_ROLES), so claiming otherwise would
    // be a false statement to the reader — only rename/deactivate are missing,
    // which the hint says instead.
    expect(pending).toEqual(["expense-categories", "work-categories"]);
  });
});

describe("the Resources door (spec 361 U4)", () => {
  it("Resources carries a ข้อมูลหลัก door pointing at the hub", () => {
    const resources = PROCUREMENT_STR_SECTIONS.find((s) => s.key === "resources")!;
    const door = resources.doors.find((d) => d.key === "master-data");
    expect(door).toBeDefined();
    expect(door?.href).toBe("/procurement/master-data");
    // The literal, not the imported constant — comparing the constant to itself
    // is green for any string, including an accidental rename.
    expect(door?.label).toBe("ข้อมูลหลัก");
    expect(MASTER_DATA_LABEL).toBe("ข้อมูลหลัก");
    expect(door?.scope).toBe("shared");
  });

  // The route lives under /procurement, so the query-blind longest-prefix rule
  // would light หน้าหลัก while the page's back chip returns to ทรัพยากร. The
  // tab must claim the path or the two disagree.
  it("the ทรัพยากร tab claims the hub path so tab and back chip agree", () => {
    const resourcesTab = PROCUREMENT_TABS.find((t) => t.href === "/procurement/resources");
    expect(resourcesTab?.match).toContain("/procurement/master-data");
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

  it("an editable list is a link carrying the exact back referrer; a pending one is not a link", () => {
    render(<MasterDataBoard counts={ALL_COUNTS} from="/procurement/master-data" isManager />);
    const catalog = screen.getByRole("link", { name: /ทะเบียนวัสดุ/ });
    // Full href — a `stringContaining("/catalog")` survives repointing this row
    // at /catalog/boq-templates, and a loose ?from survives passing the wrong page.
    expect(catalog).toHaveAttribute("href", "/catalog?from=%2Fprocurement%2Fmaster-data");
    expect(screen.queryByRole("link", { name: /สายงาน/ })).toBeNull();
  });

  it("a pending list still shows its count and says it cannot be edited in the app yet", () => {
    render(<MasterDataBoard counts={ALL_COUNTS} from="/procurement/resources" isManager />);
    const trades = screen.getByTestId("master-data-work-categories");
    expect(within(trades).getByText("52")).toBeInTheDocument();
    expect(within(trades).getByText(/ยังแก้ไขในแอปไม่ได้/)).toBeInTheDocument();
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

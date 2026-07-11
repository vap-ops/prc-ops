// Spec 214 follow-up — the PR-creation catalog picker searches and shows the
// product code, so procurement can type a code prefix (0101) to find an item.
//
// Spec 221 cleanup — the picker groups + labels by the MANAGED category (the
// `categories` prop, id + name from catalog_categories), NOT the vestigial
// item_category enum, so user-created categories (categoryId set, enum NULL)
// appear as chips and per-item labels.
//
// Spec 228 (ADR 0066 / S7) — the picker is refactored into ScopedCatalogItemPicker:
// an optional `scopedCategoryIds` (the WP work-category's Relation-R material
// categories) + the item membership union surface the relevant items FIRST without
// ever hiding the rest (D8 show-all-default + always-present แสดงทั้งหมด escape).

import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ScopedCatalogItemPicker } from "@/components/features/purchasing/catalog-item-picker";
import type { PurchaseRequestCatalogItem } from "@/components/features/purchasing/purchase-request-form";

const STEEL = "cat-steel";
const ELEC = "cat-elec";
const categories = [
  { id: STEEL, name: "เหล็กเสริม" },
  { id: ELEC, name: "งานไฟฟ้า" },
];

const items: PurchaseRequestCatalogItem[] = [
  {
    id: "s1",
    categoryId: STEEL,
    categoryName: "เหล็กเสริม",
    baseItem: "เหล็กข้ออ้อย",
    specAttrs: "12 มิล",
    unit: "ท่อน",
    thumbnailUrl: null,
    productCode: "010120",
  },
  {
    id: "e1",
    categoryId: ELEC,
    categoryName: "งานไฟฟ้า",
    baseItem: "สายไฟ NYY",
    specAttrs: "2x4",
    unit: "ม้วน",
    thumbnailUrl: null,
    productCode: "060150",
  },
];

function openPicker(opts?: {
  items?: PurchaseRequestCatalogItem[];
  scopedCategoryIds?: string[];
  membershipsByItem?: Map<string, Set<string>>;
}) {
  render(
    <ScopedCatalogItemPicker
      items={opts?.items ?? items}
      categories={categories}
      selectedId=""
      onSelect={vi.fn()}
      onClear={vi.fn()}
      {...(opts?.scopedCategoryIds ? { scopedCategoryIds: opts.scopedCategoryIds } : {})}
      {...(opts?.membershipsByItem ? { membershipsByItem: opts.membershipsByItem } : {})}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: /เลือกวัสดุจากแคตตาล็อก/ }));
}

describe("ScopedCatalogItemPicker product code (spec 214)", () => {
  it("filters results by a product-code prefix", () => {
    openPicker();
    fireEvent.change(screen.getByLabelText("ค้นหาวัสดุ"), { target: { value: "0101" } });
    expect(screen.getByText(/เหล็กข้ออ้อย/)).toBeInTheDocument();
    expect(screen.queryByText(/สายไฟ NYY/)).toBeNull();
  });

  it("shows the product code on a result row", () => {
    openPicker();
    expect(screen.getByText("010120")).toBeInTheDocument();
    expect(screen.getByText("060150")).toBeInTheDocument();
  });
});

describe("ScopedCatalogItemPicker managed category (spec 221)", () => {
  it("builds chips from the managed category names (in the prop order), not the enum", () => {
    openPicker();
    // Chips: ทั้งหมด + each managed category that has items, by name.
    expect(screen.getByRole("radio", { name: "ทั้งหมด" })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "เหล็กเสริม" })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "งานไฟฟ้า" })).toBeInTheDocument();
  });

  it("filters by a managed category chip (group by categoryId)", () => {
    openPicker();
    fireEvent.click(screen.getByRole("radio", { name: "งานไฟฟ้า" }));
    expect(screen.getByRole("button", { name: /สายไฟ NYY/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /เหล็กข้ออ้อย/ })).toBeNull();
  });

  it("shows the managed category name on a result row", () => {
    openPicker();
    // The name appears as a filter chip AND on each item's row — both present.
    expect(screen.getAllByText("เหล็กเสริม").length).toBeGreaterThan(0);
    expect(screen.getAllByText("งานไฟฟ้า").length).toBeGreaterThan(0);
    // The steel item's row carries its managed name (scoped to the result button).
    const steelRow = screen.getByRole("button", { name: /เหล็กข้ออ้อย/ });
    expect(steelRow).toHaveTextContent("เหล็กเสริม");
  });

  it("shows the selected item's managed category name", () => {
    render(
      <ScopedCatalogItemPicker
        items={items}
        categories={categories}
        selectedId="s1"
        onSelect={vi.fn()}
        onClear={vi.fn()}
      />,
    );
    // The chosen chip shows "<categoryName> · <unit>".
    expect(screen.getByText(/เหล็กเสริม · ท่อน/)).toBeInTheDocument();
  });

  it("surfaces a ไม่ระบุหมวด chip + group only when some item has no category", () => {
    const withUncat: PurchaseRequestCatalogItem[] = [
      ...items,
      {
        id: "u1",
        categoryId: null,
        categoryName: "",
        baseItem: "ของเบ็ดเตล็ด",
        specAttrs: null,
        unit: "ชิ้น",
        thumbnailUrl: null,
        productCode: null,
      },
    ];
    openPicker({ items: withUncat });
    expect(screen.getByRole("radio", { name: "ไม่ระบุหมวด" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("radio", { name: "ไม่ระบุหมวด" }));
    expect(screen.getByRole("button", { name: /ของเบ็ดเตล็ด/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /เหล็กข้ออ้อย/ })).toBeNull();
  });
});

describe("ScopedCatalogItemPicker scope (spec 228 / ADR 0066 D8)", () => {
  it("shows the FULL catalog when the scope is empty (show-all fallback)", () => {
    // An uncategorised WP / whole-project row → no scope → every item present.
    openPicker({ scopedCategoryIds: [] });
    expect(screen.getByRole("button", { name: /เหล็กข้ออ้อย/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /สายไฟ NYY/ })).toBeInTheDocument();
    // No scope → no clear-scope escape needed.
    expect(screen.queryByRole("button", { name: /แสดงทั้งหมด/ })).toBeNull();
  });

  it("shows the full catalog by default (off-category included), narrowable to ตรงกับงาน", () => {
    // Spec 297 U2: the default is show-all incl. off-category — both items
    // visible; the เฉพาะที่ตรงกับงาน toggle narrows to the in-scope set.
    openPicker({ scopedCategoryIds: [ELEC] });
    expect(screen.getByRole("button", { name: /สายไฟ NYY/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /เหล็กข้ออ้อย/ })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /เฉพาะที่ตรงกับงาน/ }));
    expect(screen.getByRole("button", { name: /สายไฟ NYY/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /เหล็กข้ออ้อย/ })).toBeNull();
  });

  it("flags an in-scope row as relevant to the งาน", () => {
    openPicker({ scopedCategoryIds: [ELEC] });
    const elecRow = screen.getByRole("button", { name: /สายไฟ NYY/ });
    expect(elecRow).toHaveTextContent("ตรงกับงาน");
  });

  it("counts a SECONDARY membership as in-scope (survives the ตรงกับงาน narrow)", () => {
    // The steel item is also a secondary member of ELEC → in-scope, so it stays
    // even when narrowed to เฉพาะที่ตรงกับงาน (canonical∪secondary union).
    openPicker({
      scopedCategoryIds: [ELEC],
      membershipsByItem: new Map([["s1", new Set([ELEC])]]),
    });
    fireEvent.click(screen.getByRole("button", { name: /เฉพาะที่ตรงกับงาน/ }));
    expect(screen.getByRole("button", { name: /สายไฟ NYY/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /เหล็กข้ออ้อย/ })).toBeInTheDocument();
  });

  it("shows everything when the scope matches no catalog item (never empty)", () => {
    openPicker({ scopedCategoryIds: ["cat-none"] });
    expect(screen.getByRole("button", { name: /เหล็กข้ออ้อย/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /สายไฟ NYY/ })).toBeInTheDocument();
  });
});

describe("ScopedCatalogItemPicker off-category warning (spec 297)", () => {
  function renderSelected(selectedId: string, scopedCategoryIds?: string[]) {
    render(
      <ScopedCatalogItemPicker
        items={items}
        categories={categories}
        selectedId={selectedId}
        onSelect={vi.fn()}
        onClear={vi.fn()}
        {...(scopedCategoryIds ? { scopedCategoryIds } : {})}
      />,
    );
  }

  it("marks an OFF-scope row as นอกหมวดงาน (shown by default)", () => {
    // Spec 297 U2: off-scope rows are visible by default (show-all).
    openPicker({ scopedCategoryIds: [ELEC] });

    const steelRow = screen.getByRole("button", { name: /เหล็กข้ออ้อย/ });
    const elecRow = screen.getByRole("button", { name: /สายไฟ NYY/ });
    // Off-scope steel → the amber mismatch flag (mirror of ตรงกับงาน).
    expect(steelRow).toHaveTextContent("นอกหมวดงาน");
    // In-scope elec → the positive flag, never the mismatch one.
    expect(elecRow).toHaveTextContent("ตรงกับงาน");
    expect(elecRow).not.toHaveTextContent("นอกหมวดงาน");
  });

  it("shows NO row flag (positive or negative) when there is no scope", () => {
    openPicker({ scopedCategoryIds: [] });
    const steelRow = screen.getByRole("button", { name: /เหล็กข้ออ้อย/ });
    const elecRow = screen.getByRole("button", { name: /สายไฟ NYY/ });
    expect(steelRow).not.toHaveTextContent("นอกหมวดงาน");
    expect(elecRow).not.toHaveTextContent("นอกหมวดงาน");
    expect(elecRow).not.toHaveTextContent("ตรงกับงาน");
  });

  it("warns on the SELECTED item when it is off the WP work-category", () => {
    // Steel picked while the WP is scoped to {ELEC} → passive off-category warning.
    renderSelected("s1", [ELEC]);
    expect(screen.getByText(/ไม่อยู่ในหมวดงาน/)).toBeInTheDocument();
  });

  it("does NOT warn when the selected item IS in the work-category", () => {
    renderSelected("e1", [ELEC]);
    expect(screen.queryByText(/ไม่อยู่ในหมวดงาน/)).toBeNull();
  });

  it("does NOT warn on the selected item when the WP has no work-category scope", () => {
    renderSelected("s1");
    expect(screen.queryByText(/ไม่อยู่ในหมวดงาน/)).toBeNull();
  });
});

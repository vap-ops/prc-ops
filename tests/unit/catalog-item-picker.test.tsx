// Spec 214 follow-up — the PR-creation catalog picker searches and shows the
// product code, so procurement can type a code prefix (0101) to find an item.
//
// Spec 221 cleanup — the picker groups + labels by the MANAGED category (the
// `categories` prop, id + name from catalog_categories), NOT the vestigial
// item_category enum, so user-created categories (categoryId set, enum NULL)
// appear as chips and per-item labels.

import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { CatalogItemPicker } from "@/components/features/purchasing/catalog-item-picker";
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

function openPicker(opts?: { items?: PurchaseRequestCatalogItem[] }) {
  render(
    <CatalogItemPicker
      items={opts?.items ?? items}
      categories={categories}
      selectedId=""
      onSelect={vi.fn()}
      onClear={vi.fn()}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: /เลือกวัสดุจากแคตตาล็อก/ }));
}

describe("CatalogItemPicker product code (spec 214)", () => {
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

describe("CatalogItemPicker managed category (spec 221)", () => {
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
      <CatalogItemPicker
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

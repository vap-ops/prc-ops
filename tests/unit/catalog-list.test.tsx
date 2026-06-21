// Spec 175 U1 — CatalogList renders the item master grouped by category.
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { CatalogList, type CatalogItem } from "@/components/features/catalog/catalog-list";
import {
  ITEM_CATEGORY_LABEL,
  CATALOG_STOCKABLE_LABEL,
  CATALOG_NON_STOCKABLE_LABEL,
} from "@/lib/i18n/labels";

const items: CatalogItem[] = [
  // deliberately out of enum order — the list must re-sort to enum order
  {
    id: "e1",
    category: "electrical",
    baseItem: "สายไฟ NYY 450/750V",
    specAttrs: "2x4 sqmm Yazaki 100m",
    unit: "ม้วน",
    stockable: true,
  },
  {
    id: "s1",
    category: "steel_fixing",
    baseItem: "เหล็กข้ออ้อย",
    specAttrs: "12 มิล",
    unit: "ท่อน",
    stockable: true,
  },
  {
    id: "r1",
    category: "roofing",
    baseItem: "แผ่นหลังคาลอนตรง CC/760",
    specAttrs: "สีขาว / ตัดตามแบบ",
    unit: "แผ่น",
    stockable: false,
  },
];

describe("CatalogList (spec 175)", () => {
  it("renders a section header only for categories that have items", () => {
    render(<CatalogList items={items} />);
    expect(screen.getByText(ITEM_CATEGORY_LABEL.steel_fixing)).toBeInTheDocument();
    expect(screen.getByText(ITEM_CATEGORY_LABEL.electrical)).toBeInTheDocument();
    expect(screen.getByText(ITEM_CATEGORY_LABEL.roofing)).toBeInTheDocument();
    // a category with no items must NOT render
    expect(screen.queryByText(ITEM_CATEGORY_LABEL.paint)).not.toBeInTheDocument();
  });

  it("orders sections by the item_category enum order, not input order", () => {
    const { container } = render(<CatalogList items={items} />);
    const text = container.textContent ?? "";
    // enum order is steel_fixing → roofing → electrical (input order was scrambled)
    expect(text.indexOf(ITEM_CATEGORY_LABEL.steel_fixing)).toBeLessThan(
      text.indexOf(ITEM_CATEGORY_LABEL.roofing),
    );
    expect(text.indexOf(ITEM_CATEGORY_LABEL.roofing)).toBeLessThan(
      text.indexOf(ITEM_CATEGORY_LABEL.electrical),
    );
  });

  it("shows each item's base name, spec and unit", () => {
    render(<CatalogList items={items} />);
    expect(screen.getByText("เหล็กข้ออ้อย")).toBeInTheDocument();
    expect(screen.getByText(/12 มิล/)).toBeInTheDocument();
    expect(screen.getAllByText(/ท่อน/).length).toBeGreaterThan(0);
  });

  it("badges stockable vs direct-to-WP items", () => {
    render(<CatalogList items={items} />);
    // two stockable + one non-stockable in the fixture
    expect(screen.getAllByText(CATALOG_STOCKABLE_LABEL).length).toBe(2);
    expect(screen.getAllByText(CATALOG_NON_STOCKABLE_LABEL).length).toBe(1);
  });

  it("renders an empty state when there are no items", () => {
    render(<CatalogList items={[]} />);
    expect(screen.getByText(/ยังไม่มีรายการวัสดุ/)).toBeInTheDocument();
  });
});

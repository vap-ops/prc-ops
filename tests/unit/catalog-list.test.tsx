// Spec 175 U1 / 221 U3c — CatalogList renders the item master grouped by the
// managed main category (category_id + names from the `categories` prop).
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@/app/catalog/actions", () => ({
  createCatalogItem: vi.fn(),
  updateCatalogItem: vi.fn(),
  setCatalogItemActive: vi.fn(),
  setCatalogItemImage: vi.fn(),
  createCatalogCategory: vi.fn(),
}));

import {
  CatalogList,
  type CatalogItem,
  type CatalogCategoryOption,
} from "@/components/features/catalog/catalog-list";

// The managed categories (id + name), in display order (sort_order, code).
const CATS: CatalogCategoryOption[] = [
  { id: "cat-steel", code: "01", name: "เหล็ก / อุปกรณ์ยึด" },
  { id: "cat-roof", code: "04", name: "หลังคา / ครอบ" },
  { id: "cat-elec", code: "06", name: "ไฟฟ้า" },
];
const STEEL = "เหล็ก / อุปกรณ์ยึด";
const ELEC = "ไฟฟ้า";
const ROOF = "หลังคา / ครอบ";

// Spec 224 — facet defaults for the list/display fixtures (the loader always
// provides these NOT-NULL columns; not exercised by the grouping/drill here).
const FACETS = {
  kind: "material",
  fulfillmentMode: "off_shelf",
  ownerSupplied: false,
} as const;

const items: CatalogItem[] = [
  // deliberately out of order — the list re-sorts to the categories prop order
  {
    id: "e1",
    categoryId: "cat-elec",
    baseItem: "สายไฟ NYY 450/750V",
    specAttrs: "2x4 sqmm Yazaki 100m",
    unit: "ม้วน",
    productCode: "060150",
  },
  {
    id: "s1",
    categoryId: "cat-steel",
    baseItem: "เหล็กข้ออ้อย",
    specAttrs: "12 มิล",
    unit: "ท่อน",
    productCode: "010120",
  },
  {
    id: "r1",
    categoryId: "cat-roof",
    baseItem: "แผ่นหลังคาลอนตรง CC/760",
    specAttrs: "สีขาว / ตัดตามแบบ",
    unit: "แผ่น",
  },
].map((it): CatalogItem => ({ ...FACETS, ...it }));

describe("CatalogList (spec 175 / 221)", () => {
  it("renders a section header only for categories that have items", () => {
    render(<CatalogList items={items} categories={CATS} />);
    // Target the section headings specifically — the category name also appears as a
    // per-row badge (spec 230), so a bare getByText would be ambiguous.
    expect(screen.getByRole("heading", { name: new RegExp(STEEL) })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: new RegExp(ELEC) })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: new RegExp(ROOF) })).toBeInTheDocument();
    // a category with no items must NOT render (no heading, no badge)
    expect(screen.queryByText("สี")).not.toBeInTheDocument();
  });

  it("orders sections by the categories prop order, not input order", () => {
    const { container } = render(<CatalogList items={items} categories={CATS} />);
    const text = container.textContent ?? "";
    // categories order is steel → roof → electrical (input order was scrambled)
    expect(text.indexOf(STEEL)).toBeLessThan(text.indexOf(ROOF));
    expect(text.indexOf(ROOF)).toBeLessThan(text.indexOf(ELEC));
  });

  it("shows each item's base name, spec and unit", () => {
    render(<CatalogList items={items} categories={CATS} />);
    expect(screen.getByText("เหล็กข้ออ้อย")).toBeInTheDocument();
    expect(screen.getByText(/12 มิล/)).toBeInTheDocument();
    expect(screen.getAllByText(/ท่อน/).length).toBeGreaterThan(0);
  });

  it("does not show a stockable badge (carve-out retired)", () => {
    render(<CatalogList items={items} categories={CATS} />);
    expect(screen.queryByText("เก็บสต๊อก")).toBeNull();
    expect(screen.queryByText("สั่งตรงเข้างาน")).toBeNull();
  });

  it("renders an empty state when there are no items", () => {
    render(<CatalogList items={[]} categories={CATS} />);
    expect(screen.getByText(/ยังไม่มีรายการวัสดุ/)).toBeInTheDocument();
  });

  // Spec 230 (ADR 0066 / S9) — each row carries a material-category badge so a row is
  // self-describing (the category name comes from the loadCatalogCategories `categories`
  // prop). The badge sits inside the row, distinct from the section heading above it.
  it("renders a material-category badge inside each item row", () => {
    render(<CatalogList items={items} categories={CATS} />);
    const row = screen.getByText("เหล็กข้ออ้อย").closest("li");
    expect(row).not.toBeNull();
    expect(within(row as HTMLElement).getByText(STEEL)).toBeInTheDocument();
  });

  it("renders a consistent placeholder slot for items without an image", () => {
    render(<CatalogList items={items} categories={CATS} />);
    expect(screen.getAllByRole("img", { name: "ไม่มีรูปภาพ" })).toHaveLength(items.length);
  });

  it("renders the thumbnail (and no placeholder) when the item has an image", () => {
    const withImg: CatalogItem[] = [
      { ...items[1]!, thumbnailUrl: "https://img.example/steel.jpg" },
    ];
    const { container } = render(<CatalogList items={withImg} categories={CATS} />);
    expect(container.querySelector('img[src="https://img.example/steel.jpg"]')).not.toBeNull();
    expect(screen.queryByRole("img", { name: "ไม่มีรูปภาพ" })).toBeNull();
  });

  it("shows a category filter — ทั้งหมด plus a chip per present category", () => {
    render(<CatalogList items={items} categories={CATS} />);
    expect(screen.getByRole("radio", { name: /ทั้งหมด/ })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: new RegExp(STEEL) })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: new RegExp(ELEC) })).toBeInTheDocument();
    // a category with no items gets no chip
    expect(screen.queryByRole("radio", { name: /สี/ })).toBeNull();
  });

  it("selecting a category shows only that category's items", () => {
    render(<CatalogList items={items} categories={CATS} />);
    fireEvent.click(screen.getByRole("radio", { name: new RegExp(STEEL) }));
    expect(screen.getByText("เหล็กข้ออ้อย")).toBeInTheDocument();
    expect(screen.queryByText("สายไฟ NYY 450/750V")).toBeNull(); // electrical hidden
    expect(screen.queryByText("แผ่นหลังคาลอนตรง CC/760")).toBeNull(); // roofing hidden
  });

  it("ทั้งหมด restores every category", () => {
    render(<CatalogList items={items} categories={CATS} />);
    fireEvent.click(screen.getByRole("radio", { name: new RegExp(STEEL) }));
    fireEvent.click(screen.getByRole("radio", { name: /ทั้งหมด/ }));
    expect(screen.getByText("เหล็กข้ออ้อย")).toBeInTheDocument();
    expect(screen.getByText("สายไฟ NYY 450/750V")).toBeInTheDocument();
  });

  it("shows each item's product code", () => {
    render(<CatalogList items={items} categories={CATS} />);
    expect(screen.getByText("010120")).toBeInTheDocument();
    expect(screen.getByText("060150")).toBeInTheDocument();
  });

  it("filters by a product-code prefix typed in the search box", () => {
    render(<CatalogList items={items} categories={CATS} />);
    fireEvent.change(screen.getByLabelText("ค้นหาวัสดุ"), { target: { value: "0101" } });
    expect(screen.getByText("เหล็กข้ออ้อย")).toBeInTheDocument();
    expect(screen.queryByText("สายไฟ NYY 450/750V")).toBeNull();
    expect(screen.queryByText("แผ่นหลังคาลอนตรง CC/760")).toBeNull();
  });

  it("shows a no-match message when the search matches nothing", () => {
    render(<CatalogList items={items} categories={CATS} />);
    fireEvent.change(screen.getByLabelText("ค้นหาวัสดุ"), { target: { value: "999999" } });
    expect(screen.getByText(/ไม่พบวัสดุที่ค้นหา/)).toBeInTheDocument();
  });

  // Spec 239 U2 — search also matches the search_terms synonyms.
  it("finds an item by a search-term synonym, not just its name", () => {
    const withSynonym: CatalogItem[] = [
      { ...items[1]!, searchTerms: "rebar deformed bar เหล็กเส้น" },
    ];
    render(<CatalogList items={withSynonym} categories={CATS} />);
    fireEvent.change(screen.getByLabelText("ค้นหาวัสดุ"), { target: { value: "rebar" } });
    expect(screen.getByText("เหล็กข้ออ้อย")).toBeInTheDocument();
  });
});

// Spec 239 U2 (ADR 0066 / C1) — BROWSE-BY-UNION: an item appears under its primary
// category AND each secondary membership (catalog_item_categories).
describe("CatalogList — browse by union (spec 239 U2)", () => {
  const unionItems: CatalogItem[] = [
    {
      id: "s1",
      categoryId: "cat-steel",
      baseItem: "ลวดผูกเหล็ก",
      specAttrs: null,
      unit: "กก.",
      // primary steel, but ALSO appears under electrical
      secondaryCategoryIds: ["cat-elec"],
    },
    {
      id: "e1",
      categoryId: "cat-elec",
      baseItem: "สายไฟ",
      specAttrs: null,
      unit: "ม้วน",
    },
  ].map((it): CatalogItem => ({ ...FACETS, ...it }));

  it("lists a multi-category item under its primary AND its secondary category", () => {
    render(<CatalogList items={unionItems} categories={CATS} />);
    // steel section has the wire, electrical section has BOTH the wire and the cable
    const steelHeading = screen.getByRole("heading", { name: new RegExp(STEEL) });
    const elecHeading = screen.getByRole("heading", { name: new RegExp(ELEC) });
    const steelSection = steelHeading.closest("section") as HTMLElement;
    const elecSection = elecHeading.closest("section") as HTMLElement;
    expect(within(steelSection).getByText("ลวดผูกเหล็ก")).toBeInTheDocument();
    expect(within(elecSection).getByText("ลวดผูกเหล็ก")).toBeInTheDocument();
    expect(within(elecSection).getByText("สายไฟ")).toBeInTheDocument();
  });

  it("counts the multi-category item under both category chips", () => {
    render(<CatalogList items={unionItems} categories={CATS} />);
    // steel chip counts 1 (the wire); electrical chip counts 2 (wire + cable)
    expect(screen.getByRole("radio", { name: `${STEEL} (1)` })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: `${ELEC} (2)` })).toBeInTheDocument();
  });

  it("filtering to the secondary category still shows the item", () => {
    render(<CatalogList items={unionItems} categories={CATS} />);
    fireEvent.click(screen.getByRole("radio", { name: `${ELEC} (2)` }));
    expect(screen.getByText("ลวดผูกเหล็ก")).toBeInTheDocument(); // secondary membership
    expect(screen.getByText("สายไฟ")).toBeInTheDocument();
  });
});

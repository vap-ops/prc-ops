// Spec 175 U1 — CatalogList renders the item master grouped by category.
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

// CatalogList now (U6) imports EditCatalogItem (a client component that imports
// the "use server" actions) for its per-row edit control. Mock the actions +
// router so the module graph loads in jsdom (the edit control is only rendered
// when editable; these tests don't pass it, but the import still resolves).
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@/app/catalog/actions", () => ({
  createCatalogItem: vi.fn(),
  updateCatalogItem: vi.fn(),
  setCatalogItemActive: vi.fn(),
  setCatalogItemImage: vi.fn(),
}));

import { CatalogList, type CatalogItem } from "@/components/features/catalog/catalog-list";
import { ITEM_CATEGORY_LABEL } from "@/lib/i18n/labels";

const items: CatalogItem[] = [
  // deliberately out of enum order — the list must re-sort to enum order
  {
    id: "e1",
    category: "electrical",
    baseItem: "สายไฟ NYY 450/750V",
    specAttrs: "2x4 sqmm Yazaki 100m",
    unit: "ม้วน",
    productCode: "060150",
  },
  {
    id: "s1",
    category: "steel_fixing",
    baseItem: "เหล็กข้ออ้อย",
    specAttrs: "12 มิล",
    unit: "ท่อน",
    productCode: "010120",
  },
  {
    id: "r1",
    category: "roofing",
    baseItem: "แผ่นหลังคาลอนตรง CC/760",
    specAttrs: "สีขาว / ตัดตามแบบ",
    unit: "แผ่น",
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

  it("does not show a stockable badge (carve-out retired — everything routes through the store)", () => {
    render(<CatalogList items={items} />);
    expect(screen.queryByText("เก็บสต๊อก")).toBeNull();
    expect(screen.queryByText("สั่งตรงเข้างาน")).toBeNull();
  });

  it("renders an empty state when there are no items", () => {
    render(<CatalogList items={[]} />);
    expect(screen.getByText(/ยังไม่มีรายการวัสดุ/)).toBeInTheDocument();
  });

  it("renders a consistent placeholder slot for items without an image", () => {
    render(<CatalogList items={items} />);
    // none of the fixture items has a thumbnail → every row shows a placeholder
    expect(screen.getAllByRole("img", { name: "ไม่มีรูปภาพ" })).toHaveLength(items.length);
  });

  it("renders the thumbnail (and no placeholder) when the item has an image", () => {
    const withImg: CatalogItem[] = [
      { ...items[1]!, thumbnailUrl: "https://img.example/steel.jpg" },
    ];
    const { container } = render(<CatalogList items={withImg} />);
    expect(container.querySelector('img[src="https://img.example/steel.jpg"]')).not.toBeNull();
    expect(screen.queryByRole("img", { name: "ไม่มีรูปภาพ" })).toBeNull();
  });

  it("shows a category filter — ทั้งหมด plus a chip per present category", () => {
    render(<CatalogList items={items} />);
    expect(screen.getByRole("radio", { name: /ทั้งหมด/ })).toBeInTheDocument();
    expect(
      screen.getByRole("radio", { name: new RegExp(ITEM_CATEGORY_LABEL.steel_fixing) }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("radio", { name: new RegExp(ITEM_CATEGORY_LABEL.electrical) }),
    ).toBeInTheDocument();
    // a category with no items gets no chip
    expect(screen.queryByRole("radio", { name: new RegExp(ITEM_CATEGORY_LABEL.paint) })).toBeNull();
  });

  it("selecting a category shows only that category's items", () => {
    render(<CatalogList items={items} />);
    fireEvent.click(
      screen.getByRole("radio", { name: new RegExp(ITEM_CATEGORY_LABEL.steel_fixing) }),
    );
    expect(screen.getByText("เหล็กข้ออ้อย")).toBeInTheDocument();
    expect(screen.queryByText("สายไฟ NYY 450/750V")).toBeNull(); // electrical hidden
    expect(screen.queryByText("แผ่นหลังคาลอนตรง CC/760")).toBeNull(); // roofing hidden
  });

  it("ทั้งหมด restores every category", () => {
    render(<CatalogList items={items} />);
    fireEvent.click(
      screen.getByRole("radio", { name: new RegExp(ITEM_CATEGORY_LABEL.steel_fixing) }),
    );
    fireEvent.click(screen.getByRole("radio", { name: /ทั้งหมด/ }));
    expect(screen.getByText("เหล็กข้ออ้อย")).toBeInTheDocument();
    expect(screen.getByText("สายไฟ NYY 450/750V")).toBeInTheDocument();
  });

  // Spec 214 — the product code shows as a chip and is searchable by prefix.
  it("shows each item's product code", () => {
    render(<CatalogList items={items} />);
    expect(screen.getByText("010120")).toBeInTheDocument();
    expect(screen.getByText("060150")).toBeInTheDocument();
  });

  it("filters by a product-code prefix typed in the search box", () => {
    render(<CatalogList items={items} />);
    fireEvent.change(screen.getByLabelText("ค้นหาวัสดุ"), { target: { value: "0101" } });
    // 010120 = steel → shown; the others (no 0101 prefix) → hidden.
    expect(screen.getByText("เหล็กข้ออ้อย")).toBeInTheDocument();
    expect(screen.queryByText("สายไฟ NYY 450/750V")).toBeNull();
    expect(screen.queryByText("แผ่นหลังคาลอนตรง CC/760")).toBeNull();
  });

  it("shows a no-match message when the search matches nothing", () => {
    render(<CatalogList items={items} />);
    fireEvent.change(screen.getByLabelText("ค้นหาวัสดุ"), { target: { value: "999999" } });
    expect(screen.getByText(/ไม่พบวัสดุที่ค้นหา/)).toBeInTheDocument();
  });
});

// Spec 219 U3 — the 2-level drill (category → subcategory). Selecting a category
// reveals a subcategory strip (real names + a ยังไม่มีหมวดย่อย bucket); a
// breadcrumb pops levels.
describe("CatalogList — 2-level drill (spec 219 U3)", () => {
  const SUBS = [
    { id: "sub-struct", category: "steel_fixing", code: "01", name: "วัสดุโครงสร้าง" },
    { id: "sub-fasten", category: "steel_fixing", code: "02", name: "อุปกรณ์ยึด" },
  ];
  const drillItems: CatalogItem[] = [
    {
      id: "s1",
      category: "steel_fixing",
      baseItem: "เหล็กข้ออ้อย",
      specAttrs: "12 มิล",
      unit: "ท่อน",
      subcategoryId: "sub-struct",
    },
    {
      id: "s2",
      category: "steel_fixing",
      baseItem: "ลวดผูกเหล็ก",
      specAttrs: null,
      unit: "กก.",
      subcategoryId: "sub-fasten",
    },
    {
      id: "s3",
      category: "steel_fixing",
      baseItem: "ตะปูเหล็ก",
      specAttrs: null,
      unit: "กล่อง",
      subcategoryId: null,
    },
    {
      id: "e1",
      category: "electrical",
      baseItem: "สายไฟ",
      specAttrs: null,
      unit: "ม้วน",
      subcategoryId: null,
    },
  ];

  function selectSteel() {
    render(<CatalogList items={drillItems} subcategories={SUBS} />);
    fireEvent.click(
      screen.getByRole("radio", { name: new RegExp(ITEM_CATEGORY_LABEL.steel_fixing) }),
    );
  }

  it("no subcategory strip until a category is chosen", () => {
    render(<CatalogList items={drillItems} subcategories={SUBS} />);
    expect(screen.queryByRole("radio", { name: /ทุกหมวดย่อย/ })).toBeNull();
  });

  it("reveals a subcategory strip (names + an uncoded bucket) when a category is selected", () => {
    selectSteel();
    expect(screen.getByRole("radio", { name: /ทุกหมวดย่อย/ })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: /วัสดุโครงสร้าง/ })).toBeInTheDocument();
    // anchored: the category chip "เหล็ก / อุปกรณ์ยึด" also contains "อุปกรณ์ยึด"
    expect(screen.getByRole("radio", { name: /^อุปกรณ์ยึด/ })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: /ยังไม่มีหมวดย่อย/ })).toBeInTheDocument();
  });

  it("filtering by a subcategory shows only that subcategory's items", () => {
    selectSteel();
    fireEvent.click(screen.getByRole("radio", { name: /วัสดุโครงสร้าง/ }));
    expect(screen.getByText("เหล็กข้ออ้อย")).toBeInTheDocument();
    expect(screen.queryByText("ลวดผูกเหล็ก")).toBeNull();
    expect(screen.queryByText("ตะปูเหล็ก")).toBeNull();
  });

  it("the uncoded bucket filters to items with no subcategory", () => {
    selectSteel();
    fireEvent.click(screen.getByRole("radio", { name: /ยังไม่มีหมวดย่อย/ }));
    expect(screen.getByText("ตะปูเหล็ก")).toBeInTheDocument();
    expect(screen.queryByText("เหล็กข้ออ้อย")).toBeNull();
  });

  it("shows a breadcrumb whose ทั้งหมด crumb restores all categories", () => {
    selectSteel();
    // electrical is hidden while drilled into the steel category
    expect(screen.queryByText("สายไฟ")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "ทั้งหมด" }));
    expect(screen.getByText("สายไฟ")).toBeInTheDocument();
  });
});

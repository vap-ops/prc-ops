// Spec 175 U1 / 221 U3c — CatalogList renders the item master grouped by the
// managed main category (category_id + names from the `categories` prop).
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@/app/catalog/actions", () => ({
  createCatalogItem: vi.fn(),
  updateCatalogItem: vi.fn(),
  setCatalogItemActive: vi.fn(),
  setCatalogItemImage: vi.fn(),
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
];

describe("CatalogList (spec 175 / 221)", () => {
  it("renders a section header only for categories that have items", () => {
    render(<CatalogList items={items} categories={CATS} />);
    expect(screen.getByText(STEEL)).toBeInTheDocument();
    expect(screen.getByText(ELEC)).toBeInTheDocument();
    expect(screen.getByText(ROOF)).toBeInTheDocument();
    // a category with no items must NOT render
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
});

// Spec 219 U3 / 221 U3c — the 2-level drill (category → subcategory), now keyed
// on category_id.
describe("CatalogList — 2-level drill", () => {
  const SUBS = [
    { id: "sub-struct", categoryId: "cat-steel", code: "01", name: "วัสดุโครงสร้าง" },
    { id: "sub-fasten", categoryId: "cat-steel", code: "02", name: "อุปกรณ์ยึด" },
  ];
  const drillItems: CatalogItem[] = [
    {
      id: "s1",
      categoryId: "cat-steel",
      baseItem: "เหล็กข้ออ้อย",
      specAttrs: "12 มิล",
      unit: "ท่อน",
      subcategoryId: "sub-struct",
    },
    {
      id: "s2",
      categoryId: "cat-steel",
      baseItem: "ลวดผูกเหล็ก",
      specAttrs: null,
      unit: "กก.",
      subcategoryId: "sub-fasten",
    },
    {
      id: "s3",
      categoryId: "cat-steel",
      baseItem: "ตะปูเหล็ก",
      specAttrs: null,
      unit: "กล่อง",
      subcategoryId: null,
    },
    {
      id: "e1",
      categoryId: "cat-elec",
      baseItem: "สายไฟ",
      specAttrs: null,
      unit: "ม้วน",
      subcategoryId: null,
    },
  ];

  function selectSteel() {
    render(<CatalogList items={drillItems} categories={CATS} subcategories={SUBS} />);
    fireEvent.click(screen.getByRole("radio", { name: new RegExp(STEEL) }));
  }

  it("no subcategory strip until a category is chosen", () => {
    render(<CatalogList items={drillItems} categories={CATS} subcategories={SUBS} />);
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
    expect(screen.queryByText("สายไฟ")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "ทั้งหมด" }));
    expect(screen.getByText("สายไฟ")).toBeInTheDocument();
  });
});

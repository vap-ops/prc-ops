// Feedback 1c700df6 (procurement) — the material register (ทะเบียนวัสดุ) needs a
// group for machinery / general tools (e.g. grinders, drills), separate from the
// existing เครื่องมืองานปูน (masonry_tools) group. A reply was published promising
// it, so this guards the fulfilment: the item_category SSOT must carry the new
// `machinery_tools` group, and the catalog list must surface it like any other.
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@/app/catalog/actions", () => ({
  createCatalogItem: vi.fn(),
  updateCatalogItem: vi.fn(),
  setCatalogItemActive: vi.fn(),
  setCatalogItemImage: vi.fn(),
}));

import { CatalogList, type CatalogItem } from "@/components/features/catalog/catalog-list";
import { ITEM_CATEGORY_LABEL } from "@/lib/i18n/labels";

describe("catalog machinery / tools category (feedback 1c700df6)", () => {
  it("registers a machinery_tools group in the item_category SSOT", () => {
    // Existence guarded by string key (compiles regardless of the enum union);
    // the exhaustive Record<item_category, string> type enforces the rest.
    expect(ITEM_CATEGORY_LABEL).toHaveProperty("machinery_tools");
    const label = (ITEM_CATEGORY_LABEL as Record<string, string>)["machinery_tools"];
    expect(label).toBeTruthy();
    // The promised framing: เครื่องจักร (machinery) + เครื่องมือ (tools).
    expect(label).toContain("เครื่องจักร");
    expect(label).toContain("เครื่องมือ");
  });

  it("keeps it distinct from the existing masonry-tools group", () => {
    const machinery = (ITEM_CATEGORY_LABEL as Record<string, string>)["machinery_tools"];
    expect(machinery).not.toBe(ITEM_CATEGORY_LABEL.masonry_tools);
  });

  it("surfaces the group as a section + filter chip in the catalog list", () => {
    const label = (ITEM_CATEGORY_LABEL as Record<string, string>)["machinery_tools"]!;
    const items: CatalogItem[] = [
      {
        id: "m1",
        categoryId: "cat-mach",
        baseItem: "สว่านไฟฟ้า",
        specAttrs: "18V",
        unit: "ตัว",
      },
    ];
    render(
      <CatalogList items={items} categories={[{ id: "cat-mach", code: "10", name: label }]} />,
    );
    expect(screen.getByRole("heading", { name: new RegExp(label) })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: new RegExp(label) })).toBeInTheDocument();
  });
});

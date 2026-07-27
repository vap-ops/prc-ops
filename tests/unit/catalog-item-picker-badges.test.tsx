// Writing failing test first.
//
// Spec 363 U4 slice 1 — the เบิก picker moves off a native <select> onto
// ScopedCatalogItemPicker, the same component ขอซื้อ and ซื้อเอง already use.
// Field report 2026-07-27 (screenshot): 369 on-hand items, labels up to 118
// chars, no search, and the OS draws the sheet so no styling reaches it.
//
// Two additions, both optional so the three existing callers are untouched:
//
//  1. `badgeByItem` — a right-aligned per-item badge. เบิก shows on-hand
//     ("6 ม้วน") so the quantity stops being trailing text inside a sentence.
//  2. `inScopeIds` — a CALLER-SUPPLIED scope decision. The picker's own
//     scopeCatalogItems matches on category only, but เบิก scopes with
//     scopeStockRows, which ALSO narrows by kind (tools vs materials, spec 229).
//     Without this the swap would silently downgrade that to category-only.

import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ScopedCatalogItemPicker } from "@/components/features/purchasing/catalog-item-picker";
import type { PurchaseRequestCatalogItem } from "@/components/features/purchasing/purchase-request-form";

const CAT_ELEC = "11111111-1111-1111-1111-111111111111";
const CAT_TOOL = "22222222-2222-2222-2222-222222222222";

function item(
  id: string,
  baseItem: string,
  specAttrs: string | null,
  categoryId: string,
): PurchaseRequestCatalogItem {
  return {
    id,
    categoryId,
    categoryName: categoryId === CAT_ELEC ? "ไฟฟ้า" : "เครื่องมือ",
    baseItem,
    specAttrs,
    unit: "ม้วน",
    thumbnailUrl: null,
  };
}

const ITEMS = [
  item("i1", "สายไฟ THW 450/750", "1x4 ตร.มม. สีน้ำตาล Yazaki 100 เมตร", CAT_ELEC),
  item("i2", "สายไฟ THW 450/750", "1x4 ตร.มม. สีฟ้า Yazaki 100 เมตร", CAT_ELEC),
  item("i3", "สว่านโรตารี่", "Bosch", CAT_TOOL),
];

const CATEGORIES = [
  { id: CAT_ELEC, name: "ไฟฟ้า" },
  { id: CAT_TOOL, name: "เครื่องมือ" },
];

function openSheet() {
  fireEvent.click(screen.getByRole("button", { name: /เลือก|ค้นหา|รายการวัสดุ/ }));
}

describe("ScopedCatalogItemPicker — เบิก additions", () => {
  it("renders a per-item badge when badgeByItem supplies one", () => {
    render(
      <ScopedCatalogItemPicker
        items={ITEMS}
        categories={CATEGORIES}
        selectedId=""
        onSelect={vi.fn()}
        onClear={vi.fn()}
        badgeByItem={
          new Map([
            ["i1", "6 ม้วน"],
            ["i2", "5 ม้วน"],
          ])
        }
      />,
    );
    openSheet();
    expect(screen.getByText("6 ม้วน")).toBeInTheDocument();
    expect(screen.getByText("5 ม้วน")).toBeInTheDocument();
  });

  it("shows no badge for items the map omits, and none at all without the prop", () => {
    const { unmount } = render(
      <ScopedCatalogItemPicker
        items={ITEMS}
        categories={CATEGORIES}
        selectedId=""
        onSelect={vi.fn()}
        onClear={vi.fn()}
        badgeByItem={new Map([["i1", "6 ม้วน"]])}
      />,
    );
    openSheet();
    expect(screen.getByText("6 ม้วน")).toBeInTheDocument();
    expect(screen.queryByText("5 ม้วน")).not.toBeInTheDocument();
    unmount();

    render(
      <ScopedCatalogItemPicker
        items={ITEMS}
        categories={CATEGORIES}
        selectedId=""
        onSelect={vi.fn()}
        onClear={vi.fn()}
      />,
    );
    openSheet();
    expect(screen.queryByText("6 ม้วน")).not.toBeInTheDocument();
  });

  it("honours a caller-supplied inScopeIds over its own category matching", () => {
    // The kind-narrowing case: i3 is a TOOL in a scoped category. scopeStockRows
    // would exclude it; the picker's own category matching would not. The caller
    // decides, and the picker must obey — otherwise the เบิก swap silently
    // downgrades spec 229's kind narrowing to category-only.
    render(
      <ScopedCatalogItemPicker
        items={ITEMS}
        categories={CATEGORIES}
        selectedId=""
        onSelect={vi.fn()}
        onClear={vi.fn()}
        scopedCategoryIds={[CAT_ELEC, CAT_TOOL]}
        inScopeIds={["i1", "i2"]}
      />,
    );
    openSheet();
    const list = screen.getByRole("list");
    const rows = within(list).getAllByRole("listitem");
    // Scoped items sort first; the tool is not in scope despite its category
    // being in scopedCategoryIds.
    expect(rows[0]!.textContent).toContain("สีน้ำตาล");
    expect(within(list).getAllByText("ตรงกับงาน")).toHaveLength(2);
  });
});

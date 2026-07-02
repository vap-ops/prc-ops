// Writing failing test first.
//
// Regression guard (feedback 65de06ca "Screen is too packed", screenshot: the
// ทะเบียนวัสดุ row's item NAME rendered one character per line). The row was a
// no-wrap flex line: name = `min-w-0 flex-1` next to a shrink-0 unit + the
// ตั้งราคาขาย + แก้ไข controls — on a phone width the fixed siblings ate the row
// and min-w-0 let the name collapse to ~1 character. The fix floors the name at
// a readable width (min-w-40, no min-w-0) and lets the row wrap, with the
// trailing unit/price/edit controls grouped into ONE shrink-0 cluster so they
// wrap below the name as a unit instead of squeezing it.
//
// Also pins the #235 pill guard on THIS file's category strip: the procurement
// grid's identical strip stacked vertically because its RadioChips lacked
// `shrink-0 whitespace-nowrap` (bug class from feedback bc6df601/703d7e91);
// catalog-list's strip carried the same latent gap.

import { describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@/app/catalog/actions", () => ({
  createCatalogItem: vi.fn(),
  updateCatalogItem: vi.fn(),
  setCatalogItemActive: vi.fn(),
  setCatalogItemImage: vi.fn(),
  createCatalogCategory: vi.fn(),
  setItemSellRate: vi.fn(),
}));

import {
  CatalogList,
  type CatalogItem,
  type CatalogCategoryOption,
} from "@/components/features/catalog/catalog-list";

const CATS: CatalogCategoryOption[] = [{ id: "cat-steel", code: "01", name: "เหล็ก / อุปกรณ์ยึด" }];

// The reported worst case: a long Thai name + unit + sell-rate + edit controls
// all on one phone-width row (super_admin sees every control at once).
const ITEMS: CatalogItem[] = [
  {
    id: "s1",
    categoryId: "cat-steel",
    baseItem: "ตะปูตีสังกะสี",
    specAttrs: "(ญ)",
    unit: "กิโลกรัม",
    kind: "material",
    fulfillmentMode: "off_shelf",
    ownerSupplied: false,
    sellRate: null,
  },
];

function renderWorstCase() {
  return render(<CatalogList items={ITEMS} categories={CATS} editable canSetSellRate units={[]} />);
}

describe("catalog-list row overflow containment (feedback 65de06ca)", () => {
  it("floors the item name at a readable width instead of letting it collapse", () => {
    renderWorstCase();
    const row = screen.getByText("ตะปูตีสังกะสี").closest("li")!;
    const name = screen.getByText("ตะปูตีสังกะสี").parentElement!;
    // The name block must have a real minimum width — min-w-0 is exactly the
    // bug (it let the fixed-width siblings squeeze the name to ~1 character).
    expect(name.className).toContain("min-w-40");
    expect(name.className).not.toContain("min-w-0");
    // ...and the row must be allowed to wrap so the floor has somewhere to push
    // the trailing controls (otherwise the floor would overflow the card).
    expect(row.className).toContain("flex-wrap");
  });

  it("groups unit + price + edit into one non-shrinking cluster that wraps as a unit", () => {
    renderWorstCase();
    const row = screen.getByText("ตะปูตีสังกะสี").closest("li")!;
    const unit = within(row).getByText("กิโลกรัม");
    const sell = within(row).getByRole("button", { name: /ตั้งราคาขาย/ });
    const edit = within(row).getByRole("button", { name: /แก้ไข/ });
    const cluster = unit.parentElement!;
    expect(cluster.className).toContain("shrink-0");
    expect(cluster.contains(sell)).toBe(true);
    expect(cluster.contains(edit)).toBe(true);
  });
});

describe("catalog-list category strip pill guard (#235 class)", () => {
  it("keeps every category pill on one horizontal row (shrink-0 + nowrap)", () => {
    const { container } = renderWorstCase();
    const strip = container.querySelector('[aria-label="กรองตามหมวดหมู่"]')!;
    expect(strip.className).toContain("overflow-x-auto");
    const pills = within(strip as HTMLElement).getAllByRole("radio");
    expect(pills.length).toBeGreaterThan(1);
    for (const pill of pills) {
      // RadioChip renders a label wrapping the sr-only radio input.
      const chip = pill.closest("label")!;
      expect(chip.className).toContain("shrink-0");
      expect(chip.className).toContain("whitespace-nowrap");
    }
  });
});

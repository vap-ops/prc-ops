// Spec 214 follow-up — the PR-creation catalog picker searches and shows the
// product code, so procurement can type a code prefix (0101) to find an item.

import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { CatalogItemPicker } from "@/components/features/purchasing/catalog-item-picker";
import type { PurchaseRequestCatalogItem } from "@/components/features/purchasing/purchase-request-form";

const items: PurchaseRequestCatalogItem[] = [
  {
    id: "s1",
    category: "steel_fixing",
    baseItem: "เหล็กข้ออ้อย",
    specAttrs: "12 มิล",
    unit: "ท่อน",
    thumbnailUrl: null,
    productCode: "010120",
  },
  {
    id: "e1",
    category: "electrical",
    baseItem: "สายไฟ NYY",
    specAttrs: "2x4",
    unit: "ม้วน",
    thumbnailUrl: null,
    productCode: "060150",
  },
];

function openPicker() {
  render(<CatalogItemPicker items={items} selectedId="" onSelect={vi.fn()} onClear={vi.fn()} />);
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

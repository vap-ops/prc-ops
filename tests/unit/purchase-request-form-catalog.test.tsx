// Spec 179 — the PR form gains a catalog picker so the requester selects an
// item from the master (spec 175) instead of free-typing. Load-bearing rules:
// the picker renders the grouped catalog options when `catalogItems` is supplied;
// selecting one prefills รายการวัสดุ + หน่วย (and links catalog_item_id, asserted
// at the action layer). When no catalogItems are supplied the picker is absent —
// the form behaves exactly as before (free-text only).

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", async () => await import("../helpers/router-refresh"));

vi.mock("@/app/requests/actions", () => ({
  createPurchaseRequest: vi.fn(async () => ({ ok: true, id: "x" })),
  decidePurchaseRequest: vi.fn(async () => ({ ok: true })),
}));

import {
  PurchaseRequestForm,
  type PurchaseRequestCatalogItem,
} from "@/components/features/purchasing/purchase-request-form";

const WP = { id: "00000000-0000-0000-0000-000000000001", code: "WP01", name: "งานปักฝัง" };
const PROJECT = "00000000-0000-0000-0000-000000000002";
const USER = "00000000-0000-0000-0000-0000000000aa";

const CATALOG: PurchaseRequestCatalogItem[] = [
  {
    id: "11111111-1111-1111-1111-111111111111",
    category: "steel_fixing",
    baseItem: "เหล็กข้ออ้อย",
    specAttrs: "12 มิล",
    unit: "ท่อน",
  },
  {
    id: "22222222-2222-2222-2222-222222222222",
    category: "paint",
    baseItem: "สีเคลือบกึ่งเงา",
    specAttrs: null,
    unit: "แกลลอน",
  },
];

describe("PurchaseRequestForm catalog picker (spec 179)", () => {
  it("renders no picker when catalogItems is omitted (free-text only, unchanged)", () => {
    render(<PurchaseRequestForm workPackage={WP} projectId={PROJECT} userId={USER} />);
    expect(screen.queryByLabelText("เลือกวัสดุจากแคตตาล็อก")).not.toBeInTheDocument();
  });

  it("renders the catalog options grouped, with a free-text fallback option", () => {
    render(
      <PurchaseRequestForm
        workPackage={WP}
        projectId={PROJECT}
        userId={USER}
        catalogItems={CATALOG}
      />,
    );
    const picker = screen.getByLabelText("เลือกวัสดุจากแคตตาล็อก") as HTMLSelectElement;
    expect(picker).toBeInTheDocument();
    expect(
      screen.getByRole("option", { name: "เหล็กข้ออ้อย · 12 มิล (ท่อน)" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "สีเคลือบกึ่งเงา (แกลลอน)" })).toBeInTheDocument();
    // The off-catalog escape hatch keeps the free-text path reachable.
    expect(screen.getByRole("option", { name: /นอกแคตตาล็อก/ })).toBeInTheDocument();
  });

  it("prefills รายการวัสดุ and หน่วย when a catalog item is picked", async () => {
    const user = userEvent.setup();
    render(
      <PurchaseRequestForm
        workPackage={WP}
        projectId={PROJECT}
        userId={USER}
        catalogItems={CATALOG}
      />,
    );

    await user.selectOptions(
      screen.getByLabelText("เลือกวัสดุจากแคตตาล็อก"),
      "11111111-1111-1111-1111-111111111111",
    );

    expect((screen.getByLabelText("รายการวัสดุ") as HTMLInputElement).value).toBe(
      "เหล็กข้ออ้อย 12 มิล",
    );
    expect((screen.getByLabelText("หน่วย") as HTMLSelectElement).value).toBe("ท่อน");
  });
});

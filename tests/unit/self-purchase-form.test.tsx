// Spec 211 U11c-B — the unified self-purchase form. Load-bearing contracts: a
// free-text buy routes to recordSitePurchase (and its success reveals the item +
// docs uploaders); a catalog item with "ใช้ที่งานนี้เลย" routes to
// sitePurchaseUseNow; and a tax-invoice toggle passes the VAT rate either way.

import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockRecord, mockUseNow, mockRefresh } = vi.hoisted(() => ({
  mockRecord: vi.fn(),
  mockUseNow: vi.fn(),
  mockRefresh: vi.fn(),
}));

vi.mock("@/app/requests/actions", () => ({ recordSitePurchase: mockRecord }));
vi.mock("@/app/store/actions", () => ({ sitePurchaseUseNow: mockUseNow }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: mockRefresh }) }));
vi.mock("@/components/features/purchasing/item-photo-uploader", () => ({
  ItemPhotoUploader: () => <div data-testid="item-photo-uploader" />,
}));
vi.mock("@/components/features/purchasing/invoice-uploader", () => ({
  InvoiceUploader: () => <div data-testid="invoice-uploader" />,
}));

import { SelfPurchaseForm } from "@/components/features/purchasing/self-purchase-form";

const WP = "00000000-0000-0000-0000-000000000001";
const PROJECT = "00000000-0000-0000-0000-000000000002";
const catalogItems = [
  {
    id: "ci-1",
    category: "electrical" as const,
    baseItem: "สายไฟ",
    specAttrs: "3x6",
    unit: "ม้วน",
    thumbnailUrl: null,
  },
];

beforeEach(() => {
  mockRecord.mockReset().mockResolvedValue({ ok: true, id: "rec-1" });
  mockUseNow.mockReset().mockResolvedValue({ ok: true });
  mockRefresh.mockReset();
});

function renderForm() {
  render(<SelfPurchaseForm projectId={PROJECT} workPackageId={WP} catalogItems={catalogItems} />);
}

describe("SelfPurchaseForm (spec 211 U11c-B)", () => {
  it("records a free-text VAT buy and reveals the uploaders", async () => {
    const user = userEvent.setup();
    renderForm();
    await user.click(screen.getByRole("button", { name: "พิมพ์เอง" }));
    await user.type(screen.getByLabelText("รายการที่ซื้อ"), "ปูน");
    await user.type(screen.getByLabelText("หน่วย"), "ถุง");
    await user.type(screen.getByLabelText("จำนวน"), "5");
    await user.type(screen.getByLabelText("จำนวนเงิน (บาท)"), "107");
    await user.click(screen.getByLabelText("มีใบกำกับภาษี (แยกภาษีซื้อ)"));
    await user.selectOptions(screen.getByLabelText("เหตุผลที่ต้องซื้อ"), "unplanned_miss");
    await user.click(screen.getByRole("button", { name: "บันทึกการซื้อ" }));

    await waitFor(() => expect(mockRecord).toHaveBeenCalledTimes(1));
    expect(mockRecord).toHaveBeenCalledWith(
      expect.objectContaining({
        workPackageId: WP,
        itemDescription: "ปูน",
        unit: "ถุง",
        quantity: 5,
        amount: 107,
        vatRate: 7,
      }),
    );
    expect(mockUseNow).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.getByTestId("item-photo-uploader")).toBeInTheDocument());
    expect(screen.getByTestId("invoice-uploader")).toBeInTheDocument();
  });

  it("buys-&-uses a catalog item now (routes to sitePurchaseUseNow at gross unit cost)", async () => {
    const user = userEvent.setup();
    renderForm();
    // Catalog selection is the same search picker as สร้างคำขอซื้อ (CatalogItemPicker):
    // open the sheet, pick the result row.
    await user.click(screen.getByRole("button", { name: "เลือกวัสดุจากแคตตาล็อก" }));
    await user.click(screen.getByRole("button", { name: /สายไฟ/ }));
    await user.click(screen.getByLabelText("ซื้อเข้าคลังแล้วใช้ที่งานนี้เลย"));
    await user.type(screen.getByLabelText("จำนวน"), "2");
    await user.type(screen.getByLabelText("จำนวนเงิน (บาท)"), "200");
    await user.click(screen.getByRole("button", { name: "ซื้อใช้ที่งานนี้เลย" }));

    await waitFor(() => expect(mockUseNow).toHaveBeenCalledTimes(1));
    expect(mockUseNow).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: PROJECT,
        workPackageId: WP,
        catalogItemId: "ci-1",
        qty: 2,
        unitCost: 100,
        vatRate: 0,
      }),
    );
    expect(mockRecord).not.toHaveBeenCalled();
  });

  it("offers ใช้ที่งานนี้เลย only for a catalog item, not free-text", async () => {
    const user = userEvent.setup();
    renderForm();
    await user.click(screen.getByRole("button", { name: "พิมพ์เอง" }));
    expect(screen.queryByLabelText("ซื้อเข้าคลังแล้วใช้ที่งานนี้เลย")).not.toBeInTheDocument();
  });
});

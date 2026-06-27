// Spec 211 U11b — a self-purchase carries TWO image types: the item photo and
// the receipt/invoice docs. After บันทึกการซื้อหน้างาน records the purchase, its
// success state must reveal BOTH uploaders — the item-photo uploader (new) and
// the invoice/docs uploader (existing) — for the new site_purchased PR.

import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/app/requests/actions", () => ({
  recordSitePurchase: vi.fn(async () => ({ ok: true as const, id: "rec-1" })),
}));
vi.mock("@/components/features/purchasing/invoice-uploader", () => ({
  InvoiceUploader: () => <div data-testid="invoice-uploader" />,
}));
vi.mock("@/components/features/purchasing/item-photo-uploader", () => ({
  ItemPhotoUploader: () => <div data-testid="item-photo-uploader" />,
}));

import { SitePurchaseForm } from "@/components/features/purchasing/site-purchase-form";

const WP_ID = "00000000-0000-0000-0000-000000000001";
const PROJECT_ID = "00000000-0000-0000-0000-000000000002";

async function recordAPurchase() {
  const user = userEvent.setup();
  render(<SitePurchaseForm workPackageId={WP_ID} projectId={PROJECT_ID} />);
  await user.type(screen.getByLabelText("รายการที่ซื้อ"), "ปูนถุง");
  await user.type(screen.getByLabelText("จำนวน"), "5");
  await user.type(screen.getByLabelText("หน่วย"), "ถุง");
  await user.selectOptions(screen.getByLabelText("เหตุผลที่ต้องสั่งซื้อ"), "unplanned_miss");
  await user.click(screen.getByRole("button", { name: "บันทึกการซื้อ" }));
}

describe("SitePurchaseForm image uploads (spec 211 U11b)", () => {
  it("reveals BOTH the item-photo and the docs uploader after recording", async () => {
    await recordAPurchase();
    await waitFor(() => {
      expect(screen.getByTestId("item-photo-uploader")).toBeInTheDocument();
    });
    expect(screen.getByTestId("invoice-uploader")).toBeInTheDocument();
  });
});

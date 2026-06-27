// Spec 176 U4 — the on-site quick-record (ซื้อหน้างาน) also carries a required
// reactive-reason code. Load-bearing: the reason <select> renders, a missing
// reason blocks the record call with a Thai error, and a chosen reason flows
// through to recordSitePurchase.

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

const recordSitePurchase = vi.fn(async (_input: { reasonCode?: string | null }) => ({
  ok: true as const,
  id: "rec-1",
}));

vi.mock("@/app/requests/actions", () => ({
  recordSitePurchase: (input: { reasonCode?: string | null }) => recordSitePurchase(input),
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

function renderForm() {
  render(<SitePurchaseForm workPackageId={WP_ID} projectId={PROJECT_ID} />);
}

describe("SitePurchaseForm reason code (spec 176 U4)", () => {
  it("renders the reason select with the five Thai-labelled codes", () => {
    renderForm();
    const reason = screen.getByLabelText("เหตุผลที่ต้องสั่งซื้อ") as HTMLSelectElement;
    expect(reason.value).toBe("");
    for (const label of [
      "วางแผนตกหล่น",
      "งานแก้ไข",
      "ของชำรุด/เสียหาย",
      "ขอบเขตงานเปลี่ยน",
      "เหตุสุดวิสัย",
    ]) {
      expect(screen.getByRole("option", { name: label })).toBeInTheDocument();
    }
  });

  it("blocks the record call until a reason is chosen, then passes it through", async () => {
    const user = userEvent.setup();
    renderForm();

    await user.type(screen.getByLabelText("รายการที่ซื้อ"), "ปูนถุง");
    await user.type(screen.getByLabelText("จำนวน"), "5");
    await user.type(screen.getByLabelText("หน่วย"), "ถุง");

    await user.click(screen.getByRole("button", { name: "บันทึกการซื้อ" }));
    expect(recordSitePurchase).not.toHaveBeenCalled();
    expect(screen.getByRole("alert").textContent).toMatch(/เหตุผล/);

    await user.selectOptions(screen.getByLabelText("เหตุผลที่ต้องสั่งซื้อ"), "breakage");
    await user.click(screen.getByRole("button", { name: "บันทึกการซื้อ" }));

    expect(recordSitePurchase).toHaveBeenCalledTimes(1);
    expect(recordSitePurchase.mock.calls[0]![0]).toMatchObject({ reasonCode: "breakage" });
  });
});

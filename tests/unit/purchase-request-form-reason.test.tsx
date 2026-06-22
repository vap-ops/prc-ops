// Spec 176 U4 — every purchase request carries a required reactive-reason
// code. The load-bearing rules: the form renders a reason <select> with the
// five Thai-labelled codes and a no-preselect placeholder, and submit stays
// disabled until a reason is chosen (the shared validator gates it).

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", async () => await import("../helpers/router-refresh"));

vi.mock("@/app/requests/actions", () => ({
  createPurchaseRequest: vi.fn(async () => ({ ok: true, id: "x" })),
  decidePurchaseRequest: vi.fn(async () => ({ ok: true })),
}));

import { PurchaseRequestForm } from "@/components/features/purchasing/purchase-request-form";
import { COMMON_UNITS } from "@/lib/purchasing/units";

const WP = { id: "00000000-0000-0000-0000-000000000001", code: "WP01", name: "งานปักฝัง" };

function renderForm() {
  render(
    <PurchaseRequestForm
      workPackage={WP}
      projectId="00000000-0000-0000-0000-000000000002"
      userId="00000000-0000-0000-0000-0000000000aa"
    />,
  );
}

describe("PurchaseRequestForm reason code (spec 176 U4)", () => {
  it("renders the five reason codes with Thai labels and no preselected value", () => {
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

  it("keeps submit disabled until a reason is chosen", async () => {
    const user = userEvent.setup();
    renderForm();

    await user.type(screen.getByLabelText("รายการวัสดุ"), "ปูนถุง");
    await user.type(screen.getByLabelText("จำนวน"), "10");
    await user.selectOptions(screen.getByLabelText("หน่วย"), COMMON_UNITS[0]!);

    const submit = screen.getByRole("button", { name: "ส่งคำขอซื้อ" });
    expect(submit).toBeDisabled();

    await user.selectOptions(screen.getByLabelText("เหตุผลที่ต้องสั่งซื้อ"), "unplanned_miss");
    expect(submit).toBeEnabled();
  });
});

// Spec 208 U3b — ซื้อใช้ที่งานนี้เลย (buy & use on this WP now): receive a
// catalogued item into the store + immediately issue it to the WP in one call.

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockUseNow, mockRefresh } = vi.hoisted(() => ({
  mockUseNow: vi.fn(),
  mockRefresh: vi.fn(),
}));

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: mockRefresh }) }));
vi.mock("@/app/store/actions", () => ({ sitePurchaseUseNow: mockUseNow }));

import {
  SitePurchaseUseNow,
  type CatalogPick,
} from "@/components/features/store/site-purchase-use-now";

const catalogItems: CatalogPick[] = [
  { id: "ci1", category: "electrical", baseItem: "สายไฟ NYY", specAttrs: "3x6", unit: "ม้วน" },
];

beforeEach(() => {
  mockUseNow.mockReset().mockResolvedValue({ ok: true });
  mockRefresh.mockReset();
});

function renderForm() {
  render(<SitePurchaseUseNow projectId="p1" workPackageId="wp1" catalogItems={catalogItems} />);
}

describe("SitePurchaseUseNow (spec 208 U3b)", () => {
  it("offers the ซื้อใช้ที่งานนี้เลย trigger", () => {
    renderForm();
    expect(screen.getByRole("button", { name: /ใช้ที่งานนี้เลย/ })).toBeInTheDocument();
  });

  it("buys-&-uses the chosen item into this work package", async () => {
    renderForm();
    fireEvent.click(screen.getByRole("button", { name: /ใช้ที่งานนี้เลย/ }));
    fireEvent.change(screen.getByLabelText("วัสดุ"), { target: { value: "ci1" } });
    fireEvent.change(screen.getByLabelText("จำนวน"), { target: { value: "3" } });
    fireEvent.change(screen.getByLabelText(/ราคาต้นทุน/), { target: { value: "120" } });
    fireEvent.change(screen.getByLabelText(/หมายเหตุ/), { target: { value: "ซื้อจากร้าน" } });
    fireEvent.click(screen.getByRole("button", { name: "บันทึก" }));

    await waitFor(() =>
      expect(mockUseNow).toHaveBeenCalledWith({
        projectId: "p1",
        workPackageId: "wp1",
        catalogItemId: "ci1",
        qty: 3,
        unitCost: 120,
        note: "ซื้อจากร้าน",
      }),
    );
    await waitFor(() => expect(mockRefresh).toHaveBeenCalled());
  });

  it("disables submit until item, qty and cost are set", () => {
    renderForm();
    fireEvent.click(screen.getByRole("button", { name: /ใช้ที่งานนี้เลย/ }));
    const submit = screen.getByRole("button", { name: "บันทึก" });
    expect(submit).toBeDisabled();
    fireEvent.change(screen.getByLabelText("วัสดุ"), { target: { value: "ci1" } });
    fireEvent.change(screen.getByLabelText("จำนวน"), { target: { value: "3" } });
    fireEvent.change(screen.getByLabelText(/ราคาต้นทุน/), { target: { value: "120" } });
    expect(submit).toBeEnabled();
  });
});

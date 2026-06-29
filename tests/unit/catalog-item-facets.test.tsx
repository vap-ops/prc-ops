// Spec 224 (ADR 0066 / S2) — the catalog item form gains three facet controls:
// a `kind` select, a `fulfillment_mode` select, and an `owner_supplied` checkbox.
// They thread through onSubmit as { kind, fulfillmentMode, ownerSupplied }; the
// existing unit picker keeps working (no regression). `stockable` is derived in
// the RPC from fulfillment_mode, so there is NO stockable input on the form.

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import {
  CatalogItemForm,
  EMPTY_CATALOG_VALUES,
} from "@/components/features/catalog/catalog-item-form";

const CATS = [{ id: "cat-elec", code: "06", name: "ไฟฟ้า" }];
const UNITS = [
  { code: "ชิ้น", displayName: "ชิ้น" },
  { code: "อัน", displayName: "อัน" },
];

function renderForm(onSubmit = vi.fn().mockResolvedValue({ ok: true } as const)) {
  render(
    <CatalogItemForm
      initial={EMPTY_CATALOG_VALUES}
      categories={CATS}
      units={UNITS}
      submitLabel="เพิ่มรายการ"
      submittingLabel="กำลังเพิ่ม…"
      onSubmit={onSubmit}
      onSuccess={vi.fn()}
      onCancel={vi.fn()}
    />,
  );
  return onSubmit;
}

describe("CatalogItemForm facets (spec 224)", () => {
  it("renders the kind / fulfillment / owner-supplied facet controls", () => {
    renderForm();
    expect(screen.getByLabelText("ประเภทรายการ")).toBeInTheDocument();
    expect(screen.getByLabelText("การจัดหา")).toBeInTheDocument();
    expect(screen.getByLabelText("เจ้าของโครงการจัดหาเอง")).toBeInTheDocument();
    // representative options from each facet
    expect(screen.getByRole("option", { name: "เครื่องมือ" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "สั่งทำ" })).toBeInTheDocument();
    // there is NO direct stockable control — it derives from fulfillment_mode.
    expect(screen.queryByLabelText("เก็บสต๊อกได้")).toBeNull();
  });

  it("defaults the facets to material / off_shelf / not-owner-supplied", () => {
    const onSubmit = renderForm();
    fireEvent.change(screen.getByLabelText("หมวดหมู่"), { target: { value: "cat-elec" } });
    fireEvent.change(screen.getByLabelText("ชื่อวัสดุ"), { target: { value: "ของปกติ" } });
    fireEvent.change(screen.getByLabelText("หน่วยนับ"), { target: { value: "ชิ้น" } });
    fireEvent.click(screen.getByRole("button", { name: "เพิ่มรายการ" }));
    return waitFor(() =>
      expect(onSubmit).toHaveBeenCalledWith(
        expect.objectContaining({
          kind: "material",
          fulfillmentMode: "off_shelf",
          ownerSupplied: false,
        }),
      ),
    );
  });

  it("submits the chosen facet values through onSubmit", async () => {
    const onSubmit = renderForm();
    fireEvent.change(screen.getByLabelText("หมวดหมู่"), { target: { value: "cat-elec" } });
    fireEvent.change(screen.getByLabelText("ชื่อวัสดุ"), { target: { value: "ของสั่งทำ" } });
    fireEvent.change(screen.getByLabelText("หน่วยนับ"), { target: { value: "อัน" } });
    fireEvent.change(screen.getByLabelText("ประเภทรายการ"), { target: { value: "tool" } });
    fireEvent.change(screen.getByLabelText("การจัดหา"), { target: { value: "made_to_order" } });
    fireEvent.click(screen.getByLabelText("เจ้าของโครงการจัดหาเอง"));
    fireEvent.click(screen.getByRole("button", { name: "เพิ่มรายการ" }));
    await waitFor(() =>
      expect(onSubmit).toHaveBeenCalledWith(
        expect.objectContaining({
          unit: "อัน",
          kind: "tool",
          fulfillmentMode: "made_to_order",
          ownerSupplied: true,
        }),
      ),
    );
  });
});

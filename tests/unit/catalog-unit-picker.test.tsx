// Spec 223 (ADR 0066 / S1) — the catalog item-form unit field is a STRUCTURED
// picker sourced from catalog_units (threaded as `units` from the page loader),
// replacing the COMMON_UNITS constant as the default path — while the
// `UNIT_OTHER_VALUE` (อื่น ๆ (ระบุเอง)) free-text escape hatch is RETAINED.

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import {
  CatalogItemForm,
  EMPTY_CATALOG_VALUES,
} from "@/components/features/catalog/catalog-item-form";

const CATS = [{ id: "cat-elec", code: "06", name: "ไฟฟ้า" }];
// Units as the loader threads them (code = the stored value). One synthetic unit
// (ZUNIT / หน่วยทดสอบ) that is NOT in COMMON_UNITS proves the options are driven
// by the threaded `units`, not the old constant.
const UNITS = [
  { code: "ถุง", displayName: "ถุง" },
  { code: "เมตร", displayName: "เมตร" },
  { code: "ZUNIT", displayName: "หน่วยทดสอบ" },
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

describe("CatalogItemForm unit picker (spec 223)", () => {
  it("renders the threaded catalog_units as the picker options", () => {
    renderForm();
    for (const u of UNITS) {
      expect(screen.getByRole("option", { name: u.displayName })).toBeInTheDocument();
    }
    // The escape-hatch option is still offered.
    expect(screen.getByRole("option", { name: "อื่น ๆ (ระบุเอง)" })).toBeInTheDocument();
  });

  it("submits the chosen structured unit value", async () => {
    const onSubmit = renderForm();
    fireEvent.change(screen.getByLabelText("หมวดหมู่"), { target: { value: "cat-elec" } });
    fireEvent.change(screen.getByLabelText("ชื่อวัสดุ"), { target: { value: "สายไฟ" } });
    fireEvent.change(screen.getByLabelText("หน่วยนับ"), { target: { value: "ZUNIT" } });
    fireEvent.click(screen.getByRole("button", { name: "เพิ่มรายการ" }));
    await waitFor(() =>
      expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ unit: "ZUNIT" })),
    );
  });

  it("retains the อื่น ๆ free-text escape hatch and submits the typed string", async () => {
    const onSubmit = renderForm();
    fireEvent.change(screen.getByLabelText("หมวดหมู่"), { target: { value: "cat-elec" } });
    fireEvent.change(screen.getByLabelText("ชื่อวัสดุ"), { target: { value: "ของแปลก" } });
    // No free-text input until the escape hatch is chosen.
    expect(screen.queryByLabelText("ระบุหน่วยนับ")).toBeNull();
    fireEvent.change(screen.getByLabelText("หน่วยนับ"), { target: { value: "__other__" } });
    const free = screen.getByLabelText("ระบุหน่วยนับ");
    expect(free).toBeInTheDocument();
    fireEvent.change(free, { target: { value: "เข่ง" } });
    fireEvent.click(screen.getByRole("button", { name: "เพิ่มรายการ" }));
    await waitFor(() =>
      expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ unit: "เข่ง" })),
    );
  });
});

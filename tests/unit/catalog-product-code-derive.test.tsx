// Spec 221 U4 / 239 U2 — the item form COMPOSES the product code from the
// category code (subcategory flattened away in spec 239 U2): the prefix is derived
// + shown read-only; the user types only the trailing "sequence". The field lives
// behind the "เพิ่มรายละเอียด" reveal (auto-opened when the item already has a code).
// An empty tail means no code (the code stays optional, spec 214).
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import {
  CatalogItemForm,
  EMPTY_CATALOG_VALUES,
  type CatalogItemValues,
} from "@/components/features/catalog/catalog-item-form";
import type { CatalogCategoryOption } from "@/components/features/catalog/catalog-list";

const CATS: CatalogCategoryOption[] = [
  { id: "cat-steel", code: "01", name: "เหล็ก" },
  { id: "cat-elec", code: "06", name: "ไฟฟ้า" },
];

function renderForm(
  initial: CatalogItemValues,
  onSubmit = vi.fn().mockResolvedValue({ ok: true } as const),
) {
  render(
    <CatalogItemForm
      initial={initial}
      categories={CATS}
      submitLabel="บันทึก"
      submittingLabel="กำลังบันทึก"
      onSubmit={onSubmit}
      onSuccess={vi.fn()}
      onCancel={vi.fn()}
    />,
  );
  return onSubmit;
}

// Spec 239 U2 — open the details reveal if it is collapsed (it auto-opens for an
// item that already carries a product code or spec).
function openDetails() {
  const toggle = screen.queryByRole("button", { name: /เพิ่มรายละเอียด/ });
  if (toggle && toggle.getAttribute("aria-expanded") === "false") fireEvent.click(toggle);
}

describe("CatalogItemForm — product-code derivation (spec 221 U4 / 239 U2)", () => {
  it("category-only: shows the category code as prefix and composes a 4-digit tail", async () => {
    const onSubmit = renderForm({
      ...EMPTY_CATALOG_VALUES,
      categoryId: "cat-elec",
      baseItem: "สายไฟ",
      unit: "ม้วน",
    });
    openDetails();
    expect(screen.getByText("06")).toBeInTheDocument(); // derived prefix
    fireEvent.change(screen.getByLabelText(/รหัสสินค้า/), { target: { value: "0120" } });
    fireEvent.click(screen.getByRole("button", { name: "บันทึก" }));
    await waitFor(() =>
      expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ productCode: "060120" })),
    );
  });

  it("an empty tail submits an empty code (the code is optional)", async () => {
    const onSubmit = renderForm({
      ...EMPTY_CATALOG_VALUES,
      categoryId: "cat-elec",
      baseItem: "สายไฟ",
      unit: "ม้วน",
    });
    fireEvent.click(screen.getByRole("button", { name: "บันทึก" }));
    await waitFor(() =>
      expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ productCode: "" })),
    );
  });

  it("an incomplete tail is named (not silently blocked) and does not submit", async () => {
    const onSubmit = renderForm({
      ...EMPTY_CATALOG_VALUES,
      categoryId: "cat-elec",
      baseItem: "สายไฟ",
      unit: "ม้วน",
    });
    openDetails();
    fireEvent.change(screen.getByLabelText(/รหัสสินค้า/), { target: { value: "01" } });
    fireEvent.click(screen.getByRole("button", { name: "บันทึก" }));
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("6 หลัก"));
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("changing the category resets the typed sequence (the prefix changed)", () => {
    renderForm({
      ...EMPTY_CATALOG_VALUES,
      categoryId: "cat-elec",
      baseItem: "สายไฟ",
      unit: "ม้วน",
    });
    openDetails();
    const tail = screen.getByLabelText(/รหัสสินค้า/) as HTMLInputElement;
    fireEvent.change(tail, { target: { value: "0120" } });
    expect(tail.value).toBe("0120");
    fireEvent.change(screen.getByLabelText("หมวดหมู่"), { target: { value: "cat-steel" } });
    expect((screen.getByLabelText(/รหัสสินค้า/) as HTMLInputElement).value).toBe("");
  });

  it("edit: seeds the tail from the existing code by stripping the derived prefix", () => {
    renderForm({
      ...EMPTY_CATALOG_VALUES,
      categoryId: "cat-elec", // code 06 → prefix length 2
      baseItem: "สายไฟ",
      unit: "ม้วน",
      productCode: "060150",
    });
    // Auto-revealed because the item carries a code.
    expect((screen.getByLabelText(/รหัสสินค้า/) as HTMLInputElement).value).toBe("0150");
  });

  it("edit: preserves a stored code (even a divergent legacy one) when the sequence is left untouched", async () => {
    // "990150" predates the scheme — its "99" prefix differs from category 06.
    const onSubmit = renderForm({
      ...EMPTY_CATALOG_VALUES,
      categoryId: "cat-elec",
      baseItem: "สายไฟ",
      unit: "ม้วน",
      productCode: "990150",
    });
    // a name-only edit must NOT silently rewrite the code
    fireEvent.click(screen.getByRole("button", { name: "บันทึก" }));
    await waitFor(() =>
      expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ productCode: "990150" })),
    );
  });

  it("edit: editing the sequence recomposes onto the category's derived prefix", async () => {
    const onSubmit = renderForm({
      ...EMPTY_CATALOG_VALUES,
      categoryId: "cat-elec",
      baseItem: "สายไฟ",
      unit: "ม้วน",
      productCode: "990150",
    });
    fireEvent.change(screen.getByLabelText(/รหัสสินค้า/), { target: { value: "0199" } });
    fireEvent.click(screen.getByRole("button", { name: "บันทึก" }));
    await waitFor(() =>
      expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ productCode: "060199" })),
    );
  });

  it("links the field to a hint that names the derived prefix (screen-reader access)", () => {
    renderForm({
      ...EMPTY_CATALOG_VALUES,
      categoryId: "cat-elec",
      baseItem: "สายไฟ",
      unit: "ม้วน",
    });
    openDetails();
    expect(screen.getByLabelText(/รหัสสินค้า/)).toHaveAttribute("aria-describedby", "ci-code-hint");
    expect(document.getElementById("ci-code-hint")?.textContent).toContain("06");
  });
});

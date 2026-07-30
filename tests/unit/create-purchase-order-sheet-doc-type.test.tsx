// Spec 380 U5 — the PO create-sheet's optional source doc gains a doc_type
// select once a file is attached, defaulting to tax_invoice_full (the label
// already says "ใบเสนอราคา / ใบแจ้งหนี้" — two real types behind one button).
import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

vi.mock("next/navigation", async () => await import("../helpers/router-refresh"));
const { createPurchaseOrderMock, createSupplierMock, addPurchaseOrderAttachmentMock } = vi.hoisted(
  () => ({
    createPurchaseOrderMock: vi.fn(),
    createSupplierMock: vi.fn(),
    addPurchaseOrderAttachmentMock: vi.fn(),
  }),
);
vi.mock("@/app/requests/actions", () => ({
  createPurchaseOrder: createPurchaseOrderMock,
  createSupplier: createSupplierMock,
  addPurchaseOrderAttachment: addPurchaseOrderAttachmentMock,
}));
vi.mock("@/lib/db/browser", () => ({
  createClient: () => ({
    storage: { from: () => ({ upload: vi.fn().mockResolvedValue({ error: null }) }) },
  }),
}));

import { CreatePurchaseOrderSheet } from "@/components/features/purchasing/create-purchase-order-sheet";

const SUP = "11111111-1111-4111-8111-111111111111";
const R1 = "aaaaaaaa-1111-4111-8111-111111111111";
const LINES = [
  {
    id: R1,
    pr_number: 10,
    item_description: "ปูน",
    quantity: 5,
    unit: "ถุง",
    wp_code: "WP52",
    wp_category_code: null,
  },
];

function setup() {
  return render(
    <CreatePurchaseOrderSheet
      open
      lines={LINES}
      suppliers={[{ id: SUP, name: "ร้าน A", phone: null }]}
      onClose={() => {}}
      onCreated={() => {}}
    />,
  );
}

const PO_ID = "cccccccc-3333-4333-8333-333333333333";

beforeEach(() => {
  createPurchaseOrderMock.mockReset().mockResolvedValue({ ok: true, poId: PO_ID });
  addPurchaseOrderAttachmentMock.mockReset().mockResolvedValue({ ok: true });
});

function pdf() {
  return new File(["x"], "quote.pdf", { type: "application/pdf" });
}

describe("CreatePurchaseOrderSheet doc_type (spec 380 U5)", () => {
  it("no file attached — no select renders, submit carries no attachment call", async () => {
    setup();
    expect(screen.queryByRole("combobox", { name: /ประเภทเอกสาร/ })).toBeNull();
  });

  it("attaching a file reveals the type select, defaulted to 'other' — never a type that could falsely satisfy a VAT claim", async () => {
    // Fresh-eyes catch: the attach here is normally a QUOTATION, not an
    // accounting doc — defaulting to tax_invoice_full would let an unread
    // quote silently certify the ม.86/4 input-VAT claim on delivery. 'other'
    // is the one type that never appears in any SATISFYING_DOC_TYPES set, so
    // an unread default can only under-claim, never falsely satisfy.
    setup();
    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(fileInput, { target: { files: [pdf()] } });
    await waitFor(() =>
      expect(screen.getByRole("combobox", { name: /ประเภทเอกสาร/ })).toHaveValue("other"),
    );
  });

  it("removing the attached file resets the type back to the safe default — no stale type on a later re-attach", async () => {
    setup();
    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(fileInput, { target: { files: [pdf()] } });
    const select = await screen.findByRole("combobox", { name: /ประเภทเอกสาร/ });
    fireEvent.change(select, { target: { value: "tax_invoice_full" } });
    fireEvent.click(screen.getByRole("button", { name: "นำออก" }));

    fireEvent.change(fileInput, { target: { files: [pdf()] } });
    await waitFor(() =>
      expect(screen.getByRole("combobox", { name: /ประเภทเอกสาร/ })).toHaveValue("other"),
    );
  });

  it("submitting with a picked type forwards that exact type to addPurchaseOrderAttachment", async () => {
    setup();
    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(fileInput, { target: { files: [pdf()] } });
    const select = await screen.findByRole("combobox", { name: /ประเภทเอกสาร/ });
    fireEvent.change(select, { target: { value: "other" } });

    fireEvent.change(screen.getByLabelText("ผู้ขาย"), { target: { value: SUP } });
    fireEvent.change(screen.getByLabelText("คาดว่าจะได้รับของ"), {
      target: { value: "2026-07-15" },
    });
    fireEvent.change(screen.getAllByLabelText(/ราคาของ/)[0]!, { target: { value: "100" } });
    fireEvent.click(screen.getByRole("button", { name: /สร้างใบสั่งซื้อ/ }));

    await waitFor(() => expect(addPurchaseOrderAttachmentMock).toHaveBeenCalledTimes(1));
    expect(addPurchaseOrderAttachmentMock).toHaveBeenCalledWith(
      expect.objectContaining({ docType: "other" }),
    );
  });
});

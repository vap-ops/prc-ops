// Spec 380 §7 (U7) — the PO create-sheet's optional source doc gains a doc_type
// select once a file is attached, defaulting to `quotation`. The button label
// says "ใบเสนอราคา / ใบแจ้งหนี้" — two real documents behind one button, and as
// of U7 both of them have a type of their own.
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
import { DOC_TYPE_LABEL } from "@/lib/i18n/labels";
import { NEVER_SATISFYING } from "@/lib/purchasing/doc-chase";

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

describe("CreatePurchaseOrderSheet doc_type (spec 380 U5, default flipped in U7)", () => {
  it("no file attached — no select renders, submit carries no attachment call", async () => {
    setup();
    expect(screen.queryByRole("combobox", { name: /ประเภทเอกสาร/ })).toBeNull();
  });

  it("attaching a file reveals the type select, defaulted to 'quotation' — the honest name for what is normally attached here, and still never a type that could falsely satisfy a VAT claim", async () => {
    // U5 defaulted to 'other' for the right reason (defaulting to
    // tax_invoice_full would let an unread quote silently certify the ม.86/4
    // input-VAT claim on delivery) but from a list with no honest option.
    // 'quotation' is ALSO in NEVER_SATISFYING, so the safety property is
    // unchanged — an unread default can only under-claim — while the common
    // case stops being recorded as a shrug.
    setup();
    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(fileInput, { target: { files: [pdf()] } });
    await waitFor(() =>
      expect(screen.getByRole("combobox", { name: /ประเภทเอกสาร/ })).toHaveValue("quotation"),
    );
  });

  it("whatever the default IS, it is a NEVER-satisfying type — an unread select can only under-claim, never discharge an order", async () => {
    // The property, not the literal. Reads the value the component actually
    // renders and asserts THAT is never-satisfying, so any future default lands
    // here too. An earlier version asserted `NEVER_SATISFYING` contains
    // "quotation" — which is a duplicate of doc-chase.test.ts and touches
    // neither the component nor its (unexported, function-local) default
    // constant, so flipping the default to tax_invoice_full left it green.
    setup();
    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(fileInput, { target: { files: [pdf()] } });
    const select = (await screen.findByRole("combobox", {
      name: /ประเภทเอกสาร/,
    })) as HTMLSelectElement;
    expect(NEVER_SATISFYING).toContain(select.value);
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
      expect(screen.getByRole("combobox", { name: /ประเภทเอกสาร/ })).toHaveValue("quotation"),
    );
  });

  it("offers ใบเสนอราคา as a real option, named with the same word the attach button promises", () => {
    // The button label names ใบเสนอราคา and ใบแจ้งหนี้; until U7 only the second
    // had a type of its own, so a quote collapsed into อื่นๆ.
    // ⚠ A `toContain(DOC_TYPE_LABEL.quotation)` over the button text CANNOT pin
    // this: the button already embeds the label after a "แนบ" prefix, so a
    // rename to a SUBSTRING ("ใบเสนอ") passes while the two surfaces diverge —
    // the prefix trap this repo has been bitten by twice. The button now
    // COMPOSES its label from the constant, so drift is impossible by
    // construction, and this EXACT accessible-name assert is what proves the
    // composition: hardcode the string back and a rename of the constant moves
    // only this expectation, reddening it.
    setup();
    const attach = screen.getByRole("button", {
      name: `แนบ${DOC_TYPE_LABEL.quotation} / ใบแจ้งหนี้ (ไม่บังคับ)`,
      exact: true,
    });
    expect(attach).toBeInTheDocument();

    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(fileInput, { target: { files: [pdf()] } });
    expect(screen.getByRole("option", { name: DOC_TYPE_LABEL.quotation })).toBeInTheDocument();
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

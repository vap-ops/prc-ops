// Spec 116 — the create-PO sheet: renders selected lines, computes a live total,
// and submits { supplierId, eta, lines } to the createPurchaseOrder action.

import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

vi.mock("next/navigation", async () => await import("../helpers/router-refresh"));
const { createPurchaseOrderMock, createSupplierMock } = vi.hoisted(() => ({
  createPurchaseOrderMock: vi.fn(),
  createSupplierMock: vi.fn(),
}));
vi.mock("@/app/requests/actions", () => ({
  createPurchaseOrder: createPurchaseOrderMock,
  createSupplier: createSupplierMock,
}));

import { CreatePurchaseOrderSheet } from "@/components/features/create-purchase-order-sheet";

const SUP = "11111111-1111-4111-8111-111111111111";
const NEW_SUP = "99999999-9999-4999-8999-999999999999";
const R1 = "aaaaaaaa-1111-4111-8111-111111111111";
const R2 = "bbbbbbbb-2222-4222-8222-222222222222";
const SUPPLIERS = [{ id: SUP, name: "ร้าน A", phone: null }];
const LINES = [
  { id: R1, pr_number: 10, item_description: "ปูน", quantity: 5, unit: "ถุง", wp_code: "WP52" },
  { id: R2, pr_number: 11, item_description: "ทราย", quantity: 2, unit: "คิว", wp_code: null },
];

function setup(props: Partial<React.ComponentProps<typeof CreatePurchaseOrderSheet>> = {}) {
  return render(
    <CreatePurchaseOrderSheet
      open
      lines={LINES}
      suppliers={SUPPLIERS}
      onClose={() => {}}
      onCreated={() => {}}
      {...props}
    />,
  );
}

describe("CreatePurchaseOrderSheet", () => {
  beforeEach(() => {
    createPurchaseOrderMock.mockReset();
    createSupplierMock.mockReset();
  });

  it("renders the selected lines and a live total of entered prices", () => {
    setup();
    expect(screen.getByText("ปูน")).toBeInTheDocument();
    expect(screen.getByText("ทราย")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("radio", { name: "ไม่มี VAT" }));
    const prices = screen.getAllByLabelText(/ราคาของ/);
    fireEvent.change(prices[0]!, { target: { value: "100" } });
    fireEvent.change(prices[1]!, { target: { value: "200" } });
    expect(screen.getByText("฿300")).toBeInTheDocument();
  });

  it("submits { supplierId, eta, lines } and calls onCreated on success", async () => {
    createPurchaseOrderMock.mockResolvedValue({ ok: true, poId: "po-1" });
    const onCreated = vi.fn();
    setup({ onCreated });
    fireEvent.change(screen.getByLabelText("ผู้ขาย"), { target: { value: SUP } });
    fireEvent.change(screen.getByLabelText("คาดว่าจะได้รับของ"), {
      target: { value: "2026-07-15" },
    });
    fireEvent.change(screen.getAllByLabelText(/ราคาของ/)[0]!, { target: { value: "100" } });
    fireEvent.click(screen.getByRole("button", { name: /สร้าง PO/ }));

    await waitFor(() =>
      expect(createPurchaseOrderMock).toHaveBeenCalledWith({
        supplierId: SUP,
        eta: "2026-07-15",
        lines: [
          { requestId: R1, amount: 107 },
          { requestId: R2, amount: null },
        ],
        // Default mode is exclusive (ก่อน VAT) → +7% → gross 107, rate 7.
        vatRate: 7,
        // Spec 120: order_ref carried (empty here).
        orderRef: "",
      }),
    );
    await waitFor(() => expect(onCreated).toHaveBeenCalled());
  });

  it("VAT inclusive: keeps the entered price as the gross", async () => {
    createPurchaseOrderMock.mockResolvedValue({ ok: true, poId: "po-2" });
    setup();
    fireEvent.change(screen.getByLabelText("ผู้ขาย"), { target: { value: SUP } });
    fireEvent.change(screen.getByLabelText("คาดว่าจะได้รับของ"), {
      target: { value: "2026-07-15" },
    });
    fireEvent.click(screen.getByRole("radio", { name: "รวม VAT แล้ว" }));
    fireEvent.change(screen.getAllByLabelText(/ราคาของ/)[0]!, { target: { value: "100" } });
    fireEvent.click(screen.getByRole("button", { name: /สร้าง PO/ }));

    await waitFor(() =>
      expect(createPurchaseOrderMock).toHaveBeenCalledWith({
        supplierId: SUP,
        eta: "2026-07-15",
        lines: [
          { requestId: R1, amount: 100 },
          { requestId: R2, amount: null },
        ],
        vatRate: 7,
        orderRef: "",
      }),
    );
  });

  it("surfaces the action error and does not call onCreated", async () => {
    createPurchaseOrderMock.mockResolvedValue({ ok: false, error: "บูม" });
    const onCreated = vi.fn();
    setup({ onCreated });
    fireEvent.change(screen.getByLabelText("ผู้ขาย"), { target: { value: SUP } });
    fireEvent.change(screen.getByLabelText("คาดว่าจะได้รับของ"), {
      target: { value: "2026-07-15" },
    });
    fireEvent.click(screen.getByRole("button", { name: /สร้าง PO/ }));

    expect(await screen.findByRole("alert")).toHaveTextContent("บูม");
    expect(onCreated).not.toHaveBeenCalled();
  });

  it("rejects an invalid line price client-side, before calling the action", () => {
    const onCreated = vi.fn();
    setup({ onCreated });
    fireEvent.change(screen.getByLabelText("ผู้ขาย"), { target: { value: SUP } });
    fireEvent.change(screen.getByLabelText("คาดว่าจะได้รับของ"), {
      target: { value: "2026-07-15" },
    });
    fireEvent.change(screen.getAllByLabelText(/ราคาของ/)[0]!, { target: { value: "-5" } });
    fireEvent.click(screen.getByRole("button", { name: /สร้าง PO/ }));

    expect(screen.getByRole("alert")).toBeInTheDocument();
    expect(createPurchaseOrderMock).not.toHaveBeenCalled();
  });

  it("adds a supplier inline and selects it (no dead-end)", async () => {
    createSupplierMock.mockResolvedValue({ ok: true, id: NEW_SUP });
    setup();
    fireEvent.change(screen.getByPlaceholderText("ชื่อผู้ขาย / ร้านค้า"), {
      target: { value: "ร้านใหม่" },
    });
    fireEvent.click(screen.getByRole("button", { name: "เพิ่มและเลือก" }));

    await waitFor(() =>
      expect(createSupplierMock).toHaveBeenCalledWith({ name: "ร้านใหม่", phone: "" }),
    );
    await waitFor(() =>
      expect((screen.getByLabelText("ผู้ขาย") as HTMLSelectElement).value).toBe(NEW_SUP),
    );
    expect(screen.getByText("ร้านใหม่")).toBeInTheDocument();
  });
});

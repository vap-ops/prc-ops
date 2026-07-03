// Spec 249 U2 — per-billing receipts drawer + coverage line on the billing
// register. Writing failing test first.

import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));

const recordClientReceipt = vi.fn().mockResolvedValue({ ok: true });
vi.mock("@/app/accounting/billings/actions", () => ({
  recordClientReceipt: (...args: unknown[]) => recordClientReceipt(...args),
}));

import { BillingReceipts } from "@/app/accounting/billings/billing-receipts";

const receipts = [
  {
    id: "r1",
    amount: 50000,
    receivedDate: "2026-07-01",
    method: "bank_transfer",
    note: null,
  },
  { id: "r2", amount: 19000, receivedDate: "2026-07-02", method: "cash", note: "งวดแรกบางส่วน" },
];

beforeEach(() => {
  recordClientReceipt.mockClear();
});

describe("BillingReceipts", () => {
  it("shows received + outstanding coverage", () => {
    render(
      <BillingReceipts
        billingId="b1"
        projectId="p1"
        receipts={receipts}
        received={69000}
        outstanding={30000}
        canWrite={false}
      />,
    );
    expect(screen.getByText(/รับแล้ว/)).toBeInTheDocument();
    expect(screen.getByText(/ค้างรับ/)).toBeInTheDocument();
  });

  it("opens the drawer listing receipts; no record form for readers", () => {
    render(
      <BillingReceipts
        billingId="b1"
        projectId="p1"
        receipts={receipts}
        received={69000}
        outstanding={30000}
        canWrite={false}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /เงินรับ \(2\)/ }));
    expect(screen.getByText("งวดแรกบางส่วน")).toBeInTheDocument();
    expect(screen.getByText(/โอนธนาคาร/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "บันทึกเงินรับ" })).not.toBeInTheDocument();
  });

  it("writer records a receipt with parsed amount", async () => {
    render(
      <BillingReceipts
        billingId="b1"
        projectId="p1"
        receipts={receipts}
        received={69000}
        outstanding={30000}
        canWrite={true}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /เงินรับ \(2\)/ }));
    fireEvent.change(screen.getByLabelText(/จำนวนเงิน/), { target: { value: "30000" } });
    fireEvent.change(screen.getByLabelText(/วันที่รับ/), { target: { value: "2026-07-03" } });
    fireEvent.change(screen.getByLabelText(/วิธีรับเงิน/), { target: { value: "cheque" } });
    fireEvent.submit(screen.getByRole("button", { name: "บันทึกเงินรับ" }).closest("form")!);
    await vi.waitFor(() => expect(recordClientReceipt).toHaveBeenCalledTimes(1));
    expect(recordClientReceipt).toHaveBeenCalledWith(
      expect.objectContaining({
        billingId: "b1",
        projectId: "p1",
        amount: 30000,
        receivedDate: "2026-07-03",
        method: "cheque",
      }),
    );
  });
});

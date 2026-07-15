// Writing failing test first.
//
// Spec 323 U1c — RentalSettlementForm extracted from RentalSettlementManager's
// record section so it can be hosted in a bottom sheet. Same fields (agreement ·
// invoice no/date · base + overtime + fees with a live net · VAT · deposit
// refunded/forfeited · method · note); on a clean save it calls
// recordRentalSettlement, refreshes, then onDone() to close the sheet. Mocked
// actions + router.

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockRecord, mockRefresh } = vi.hoisted(() => ({
  mockRecord: vi.fn(),
  mockRefresh: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: mockRefresh }),
}));
vi.mock("@/app/equipment/rentals/actions", () => ({
  recordRentalSettlement: mockRecord,
}));

import { RentalSettlementForm } from "@/components/features/equipment/rental-settlement-form";

const agreements = [
  { id: "b1", label: "บ.เครนไทย · ฿90,000.00/เดือน · เริ่ม 1 ก.ค. 2569 · ตลอดโครงการ" },
  { id: "b2", label: "บ.นั่งร้านสยาม · ฿3,500.00/วัน · 10 ก.ค. 2569 – 20 ก.ค. 2569" },
];

function renderForm(onDone?: () => void) {
  return render(
    <RentalSettlementForm
      agreements={agreements}
      defaultDate="2026-07-08"
      {...(onDone ? { onDone } : {})}
    />,
  );
}

describe("RentalSettlementForm", () => {
  beforeEach(() => {
    mockRecord.mockReset().mockResolvedValue({ ok: true });
    mockRefresh.mockReset();
  });

  it("defaults the payment method to bank transfer", () => {
    renderForm();
    expect(screen.getByRole("radio", { name: "โอนธนาคาร" })).toBeChecked();
  });

  it("shows the net as base + overtime + fees, updating live", () => {
    renderForm();
    fireEvent.change(screen.getByLabelText("ค่าเช่า (บาท)"), { target: { value: "90000" } });
    fireEvent.change(screen.getByLabelText("ค่าล่วงเวลา (บาท)"), { target: { value: "5000" } });
    fireEvent.change(screen.getByLabelText("ค่าบริการอื่น (บาท)"), { target: { value: "1500" } });
    expect(screen.getByText("฿96,500.00")).toBeInTheDocument();
  });

  it("submits a settlement, refreshes, then closes via onDone", async () => {
    const onDone = vi.fn();
    renderForm(onDone);
    fireEvent.change(screen.getByLabelText("สัญญาเช่า"), { target: { value: "b1" } });
    fireEvent.change(screen.getByLabelText("เลขที่ใบแจ้งหนี้"), { target: { value: "INV-77" } });
    fireEvent.change(screen.getByLabelText("วันที่ใบแจ้งหนี้"), {
      target: { value: "2026-07-08" },
    });
    fireEvent.change(screen.getByLabelText("ค่าเช่า (บาท)"), { target: { value: "90000" } });
    fireEvent.change(screen.getByLabelText("ค่าล่วงเวลา (บาท)"), { target: { value: "5000" } });
    fireEvent.change(screen.getByLabelText("ค่าบริการอื่น (บาท)"), { target: { value: "1500" } });
    fireEvent.change(screen.getByLabelText("ภาษีมูลค่าเพิ่ม (บาท)"), { target: { value: "6755" } });
    fireEvent.click(screen.getByRole("button", { name: "บันทึกการชำระ" }));
    await waitFor(() =>
      expect(mockRecord).toHaveBeenCalledWith({
        agreementId: "b1",
        invoiceNo: "INV-77",
        invoiceDate: "2026-07-08",
        base: 90000,
        overtime: 5000,
        fees: 1500,
        vat: 6755,
        depositRefunded: 0,
        depositForfeited: 0,
        method: "bank_transfer",
        note: "",
      }),
    );
    await waitFor(() => expect(mockRefresh).toHaveBeenCalled());
    await waitFor(() => expect(onDone).toHaveBeenCalled());
  });

  it("rejects a missing agreement client-side and does not close", async () => {
    const onDone = vi.fn();
    renderForm(onDone);
    fireEvent.change(screen.getByLabelText("เลขที่ใบแจ้งหนี้"), { target: { value: "INV-77" } });
    fireEvent.click(screen.getByRole("button", { name: "บันทึกการชำระ" }));
    await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());
    expect(mockRecord).not.toHaveBeenCalled();
    expect(onDone).not.toHaveBeenCalled();
  });

  it("surfaces the action error and keeps the sheet open", async () => {
    mockRecord.mockResolvedValue({ ok: false, error: "ไม่มีสิทธิ์บันทึกการชำระค่าเช่า" });
    const onDone = vi.fn();
    renderForm(onDone);
    fireEvent.change(screen.getByLabelText("สัญญาเช่า"), { target: { value: "b1" } });
    fireEvent.change(screen.getByLabelText("เลขที่ใบแจ้งหนี้"), { target: { value: "INV-77" } });
    fireEvent.change(screen.getByLabelText("วันที่ใบแจ้งหนี้"), {
      target: { value: "2026-07-08" },
    });
    fireEvent.change(screen.getByLabelText("ค่าเช่า (บาท)"), { target: { value: "90000" } });
    fireEvent.click(screen.getByRole("button", { name: "บันทึกการชำระ" }));
    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent("ไม่มีสิทธิ์บันทึกการชำระค่าเช่า"),
    );
    expect(onDone).not.toHaveBeenCalled();
  });
});

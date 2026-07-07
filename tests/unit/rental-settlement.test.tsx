// Writing failing test first.
//
// Spec 275 U3 — RentalSettlementManager on /equipment/rentals (BACK_OFFICE money
// audience only; the page gate keeps a field session out entirely). One form
// records a vendor invoice against a rental agreement: pick the agreement · invoice
// no/date · base + overtime + fees (net computed live) · VAT · deposit refunded /
// forfeited · payment method · note. The history lists live settlements; แก้ไข
// opens a prefilled correction form that supersedes via a new row. Mocked actions +
// router.

import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockRecord, mockSupersede, mockRefresh } = vi.hoisted(() => ({
  mockRecord: vi.fn(),
  mockSupersede: vi.fn(),
  mockRefresh: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: mockRefresh }),
}));
vi.mock("@/app/equipment/rentals/actions", () => ({
  recordRentalSettlement: mockRecord,
  supersedeRentalSettlement: mockSupersede,
}));

import { RentalSettlementManager } from "@/components/features/equipment/rental-settlement-manager";
import type { SettlementListItem } from "@/lib/equipment/rental-settlement-view";

const agreements = [
  {
    id: "b1",
    label: "บ.เครนไทย · ฿90,000.00/เดือน · เริ่ม 1 ก.ค. 2569 · ตลอดโครงการ (จนกว่าจะคืน)",
  },
  { id: "b2", label: "บ.นั่งร้านสยาม · ฿3,500.00/วัน · 10 ก.ค. 2569 – 20 ก.ค. 2569" },
];

const settlement: SettlementListItem = {
  id: "s1",
  agreementId: "b1",
  agreementLabel: agreements[0]!.label,
  invoiceNo: "INV-001",
  invoiceDate: "2026-07-01",
  base: 90000,
  overtime: 0,
  fees: 0,
  net: 90000,
  vat: 6300,
  depositRefunded: 0,
  depositForfeited: 0,
  method: "bank_transfer",
  note: null,
};

function renderManager(settlements: SettlementListItem[] = [settlement]) {
  return render(
    <RentalSettlementManager
      agreements={agreements}
      settlements={settlements}
      defaultDate="2026-07-08"
    />,
  );
}

beforeEach(() => {
  mockRecord.mockReset().mockResolvedValue({ ok: true });
  mockSupersede.mockReset().mockResolvedValue({ ok: true });
  mockRefresh.mockReset();
});

describe("RentalSettlementManager — record", () => {
  it("defaults the payment method to bank transfer", () => {
    renderManager();
    expect(screen.getByRole("radio", { name: "โอนธนาคาร" })).toBeChecked();
  });

  it("shows the net as base + overtime + fees, updating live", () => {
    renderManager();
    const form = within(screen.getByRole("region", { name: "บันทึกการชำระ" }));
    fireEvent.change(form.getByLabelText("ค่าเช่า (บาท)"), { target: { value: "90000" } });
    fireEvent.change(form.getByLabelText("ค่าล่วงเวลา (บาท)"), { target: { value: "5000" } });
    fireEvent.change(form.getByLabelText("ค่าบริการอื่น (บาท)"), { target: { value: "1500" } });
    expect(form.getByText("฿96,500.00")).toBeInTheDocument();
  });

  it("submits a settlement with the exact payload", async () => {
    renderManager([]);
    const form = within(screen.getByRole("region", { name: "บันทึกการชำระ" }));
    fireEvent.change(form.getByLabelText("สัญญาเช่า"), { target: { value: "b1" } });
    fireEvent.change(form.getByLabelText("เลขที่ใบแจ้งหนี้"), { target: { value: "INV-77" } });
    fireEvent.change(form.getByLabelText("วันที่ใบแจ้งหนี้"), { target: { value: "2026-07-08" } });
    fireEvent.change(form.getByLabelText("ค่าเช่า (บาท)"), { target: { value: "90000" } });
    fireEvent.change(form.getByLabelText("ค่าล่วงเวลา (บาท)"), { target: { value: "5000" } });
    fireEvent.change(form.getByLabelText("ค่าบริการอื่น (บาท)"), { target: { value: "1500" } });
    fireEvent.change(form.getByLabelText("ภาษีมูลค่าเพิ่ม (บาท)"), { target: { value: "6755" } });
    fireEvent.click(form.getByRole("button", { name: "บันทึกการชำระ" }));
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
  });

  it("rejects a missing agreement client-side before calling the action", async () => {
    renderManager([]);
    const form = within(screen.getByRole("region", { name: "บันทึกการชำระ" }));
    fireEvent.change(form.getByLabelText("เลขที่ใบแจ้งหนี้"), { target: { value: "INV-77" } });
    fireEvent.click(form.getByRole("button", { name: "บันทึกการชำระ" }));
    await waitFor(() => expect(form.getByRole("alert")).toBeInTheDocument());
    expect(mockRecord).not.toHaveBeenCalled();
  });

  it("surfaces the action error", async () => {
    mockRecord.mockResolvedValue({ ok: false, error: "ไม่มีสิทธิ์บันทึกการชำระค่าเช่า" });
    renderManager([]);
    const form = within(screen.getByRole("region", { name: "บันทึกการชำระ" }));
    fireEvent.change(form.getByLabelText("สัญญาเช่า"), { target: { value: "b1" } });
    fireEvent.change(form.getByLabelText("เลขที่ใบแจ้งหนี้"), { target: { value: "INV-77" } });
    fireEvent.change(form.getByLabelText("วันที่ใบแจ้งหนี้"), { target: { value: "2026-07-08" } });
    fireEvent.change(form.getByLabelText("ค่าเช่า (บาท)"), { target: { value: "90000" } });
    fireEvent.click(form.getByRole("button", { name: "บันทึกการชำระ" }));
    await waitFor(() =>
      expect(form.getByRole("alert")).toHaveTextContent("ไม่มีสิทธิ์บันทึกการชำระค่าเช่า"),
    );
  });
});

describe("RentalSettlementManager — history + correction", () => {
  it("lists recorded settlements with invoice no, net, and method", () => {
    renderManager();
    const list = within(screen.getByRole("region", { name: "ประวัติการชำระ" }));
    expect(list.getByText("INV-001")).toBeInTheDocument();
    // exact — the agreement label also carries "฿90,000.00/เดือน", so a substring
    // match is ambiguous; the net renders in its own node as "฿90,000.00".
    expect(list.getByText("฿90,000.00")).toBeInTheDocument();
    expect(list.getByText(/โอนธนาคาร/)).toBeInTheDocument();
  });

  it("shows an empty state when nothing is recorded yet", () => {
    renderManager([]);
    expect(screen.getByText(/ยังไม่มีการชำระ/)).toBeInTheDocument();
  });

  it("supersedes with the settlement id, correction reason, and prefilled fields", async () => {
    renderManager();
    fireEvent.click(screen.getByRole("button", { name: "แก้ไข" }));
    fireEvent.change(screen.getByLabelText("เหตุผลการแก้ไข"), {
      target: { value: "แก้ยอดค่าล่วงเวลา" },
    });
    fireEvent.click(screen.getByRole("button", { name: "ยืนยันการแก้ไข" }));
    await waitFor(() =>
      expect(mockSupersede).toHaveBeenCalledWith({
        settlementId: "s1",
        correctionReason: "แก้ยอดค่าล่วงเวลา",
        agreementId: "b1",
        invoiceNo: "INV-001",
        invoiceDate: "2026-07-01",
        base: 90000,
        overtime: 0,
        fees: 0,
        vat: 6300,
        depositRefunded: 0,
        depositForfeited: 0,
        method: "bank_transfer",
        note: "",
      }),
    );
    await waitFor(() => expect(mockRefresh).toHaveBeenCalled());
  });

  it("requires a correction reason before superseding", async () => {
    renderManager();
    fireEvent.click(screen.getByRole("button", { name: "แก้ไข" }));
    fireEvent.click(screen.getByRole("button", { name: "ยืนยันการแก้ไข" }));
    await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());
    expect(mockSupersede).not.toHaveBeenCalled();
  });
});

// Writing failing test first.
//
// Spec 275 U3 / 323 U1c — RentalSettlementManager is now the read-only settlement
// history list (recording moved into AddSettlementFab + a bottom sheet). The history
// lists live settlements; แก้ไข opens a prefilled correction form IN A BOTTOM SHEET
// that supersedes via a new row. Mocked actions + router.

import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockSupersede, mockRefresh } = vi.hoisted(() => ({
  mockSupersede: vi.fn(),
  mockRefresh: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: mockRefresh }),
}));
vi.mock("@/app/equipment/rentals/actions", () => ({
  supersedeRentalSettlement: mockSupersede,
}));

import { RentalSettlementManager } from "@/components/features/equipment/rental-settlement-manager";
import type { SettlementListItem } from "@/lib/equipment/rental-settlement-view";

const agreementLabel =
  "บ.เครนไทย · ฿90,000.00/เดือน · เริ่ม 1 ก.ค. 2569 · ตลอดโครงการ (จนกว่าจะคืน)";

const settlement: SettlementListItem = {
  id: "s1",
  agreementId: "b1",
  agreementLabel,
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
  return render(<RentalSettlementManager settlements={settlements} />);
}

beforeEach(() => {
  mockSupersede.mockReset().mockResolvedValue({ ok: true });
  mockRefresh.mockReset();
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

  it("does not render a record form (moved to the FAB sheet)", () => {
    renderManager();
    expect(screen.queryByLabelText("สัญญาเช่า")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "บันทึกการชำระ" })).not.toBeInTheDocument();
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
    // sheet closed on success
    await waitFor(() => expect(screen.queryByLabelText("เหตุผลการแก้ไข")).not.toBeInTheDocument());
  });

  it("requires a correction reason before superseding", async () => {
    renderManager();
    fireEvent.click(screen.getByRole("button", { name: "แก้ไข" }));
    fireEvent.click(screen.getByRole("button", { name: "ยืนยันการแก้ไข" }));
    await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());
    expect(mockSupersede).not.toHaveBeenCalled();
  });

  // Spec 312 follow-up 2 — surface that editing the amounts to 0 is how you cancel a
  // settlement. The hint shows only inside the open correction sheet, not the row.
  it("shows the zero-cancels hint only when the correction sheet is open", () => {
    renderManager();
    expect(screen.queryByText(/แก้ไขยอดเป็น 0/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "แก้ไข" }));
    expect(screen.getByText(/แก้ไขยอดเป็น 0/)).toBeInTheDocument();
  });

  // Spec 323 U1d — the receipt-documents sheet: lists the attached vendor documents
  // (with a signed view link) and hosts the two per-purpose uploaders.
  it("opens the receipts sheet with the attached documents and the uploaders", () => {
    render(
      <RentalSettlementManager
        settlements={[settlement]}
        receiptsBySettlement={{
          s1: [
            {
              id: "att-1",
              purpose: "tax_invoice",
              uploadedAt: "2026-07-06",
              url: "https://x/y.pdf",
            },
          ],
        }}
      />,
    );
    // the row button carries the count
    fireEvent.click(screen.getByRole("button", { name: "ใบเสร็จ/เอกสาร (1)" }));
    // the attached doc + its signed view link
    expect(screen.getByText(/ใบกำกับภาษี ·/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "ดูเอกสาร" })).toHaveAttribute(
      "href",
      "https://x/y.pdf",
    );
    // both uploaders present
    expect(screen.getByRole("button", { name: "แนบสลิปโอนเงิน" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "แนบใบกำกับภาษี" })).toBeInTheDocument();
  });

  it("shows an empty receipts state and the count-less label when nothing is attached", () => {
    renderManager();
    fireEvent.click(screen.getByRole("button", { name: "ใบเสร็จ/เอกสาร" }));
    expect(screen.getByText("ยังไม่มีเอกสารแนบ")).toBeInTheDocument();
  });
});

// Spec 253 U1 — drill revenue forms: the quotation sheet submits parsed values
// through the server action. Writing failing test first (component + action
// threading; the RPC-side validation is pgTAP 253's job).

import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));

const createQuotation = vi.fn().mockResolvedValue({ ok: true });
vi.mock("@/app/accounting/projects/actions", () => ({
  createQuotation: (...args: unknown[]) => createQuotation(...args),
  createClientPo: vi.fn(),
  upsertContract: vi.fn(),
  addInstallment: vi.fn(),
  recordAdvanceReceipt: vi.fn(),
}));

import { QuotationSheet } from "@/app/accounting/projects/revenue-forms";

beforeEach(() => createQuotation.mockClear());

describe("QuotationSheet", () => {
  it("submits parsed quotation fields", async () => {
    render(<QuotationSheet projectId="p1" />);
    fireEvent.click(screen.getByRole("button", { name: "+ ใบเสนอราคา" }));
    fireEvent.change(screen.getByLabelText("เลขที่ใบเสนอราคา"), {
      target: { value: "Q-2026-009" },
    });
    fireEvent.change(screen.getByLabelText("มูลค่า (บาท)"), { target: { value: "450000" } });
    fireEvent.change(screen.getByLabelText("วันที่เสนอ"), { target: { value: "2026-07-03" } });
    fireEvent.submit(screen.getByRole("button", { name: "บันทึกใบเสนอราคา" }).closest("form")!);
    await vi.waitFor(() => expect(createQuotation).toHaveBeenCalledTimes(1));
    expect(createQuotation).toHaveBeenCalledWith({
      projectId: "p1",
      quotationNo: "Q-2026-009",
      amount: 450000,
      quoteDate: "2026-07-03",
    });
  });

  it("keeps submit disabled until the required fields are set", () => {
    render(<QuotationSheet projectId="p1" />);
    fireEvent.click(screen.getByRole("button", { name: "+ ใบเสนอราคา" }));
    expect(screen.getByRole("button", { name: "บันทึกใบเสนอราคา" })).toBeDisabled();
  });
});

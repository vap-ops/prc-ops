// Spec 182 U1 — the price-comparison table on an approved PR. Back-office records
// supplier quotes; the table ranks them cheapest-first, shows total (unit ×
// qty) + % over the cheapest, and lets a quote be added/removed.

import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockAdd, mockRemove, mockRefresh } = vi.hoisted(() => ({
  mockAdd: vi.fn(),
  mockRemove: vi.fn(),
  mockRefresh: vi.fn(),
}));

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: mockRefresh }) }));
vi.mock("@/app/requests/actions", () => ({
  addPurchaseQuote: mockAdd,
  removePurchaseQuote: mockRemove,
}));

import { PriceComparison } from "@/components/features/purchasing/price-comparison";

const quotes = [
  { id: "q2", supplierId: "s2", supplierName: "ไทยวัสดุ", unitPrice: 98, note: null },
  { id: "q1", supplierId: "s1", supplierName: "ส.รุ่งเรือง", unitPrice: 92, note: "ส่งฟรี" },
];
const suppliers = [
  { id: "s1", name: "ส.รุ่งเรือง" },
  { id: "s2", name: "ไทยวัสดุ" },
  { id: "s3", name: "โฮมโปร" },
];

function renderPC(opts?: { quotes?: typeof quotes }) {
  render(
    <PriceComparison
      purchaseRequestId="pr1"
      quantity={50}
      unit="ท่อน"
      quotes={opts?.quotes ?? quotes}
      suppliers={suppliers}
    />,
  );
}

beforeEach(() => {
  mockAdd.mockReset().mockResolvedValue({ ok: true, id: "qx" });
  mockRemove.mockReset().mockResolvedValue({ ok: true });
  mockRefresh.mockReset();
});

describe("PriceComparison (spec 182 U1)", () => {
  it("ranks cheapest-first with totals, ถูกสุด, and +% over cheapest", () => {
    renderPC();
    const rows = screen.getAllByRole("listitem");
    // Cheapest (฿92, ส.รุ่งเรือง) is first even though it was passed second.
    expect(within(rows[0]!).getByText("ส.รุ่งเรือง")).toBeInTheDocument();
    expect(within(rows[0]!).getByText(/ถูกสุด/)).toBeInTheDocument();
    expect(within(rows[0]!).getByText(/4,600/)).toBeInTheDocument();
    // The dearer quote shows the % over cheapest ((98-92)/92 ≈ +7%).
    expect(within(rows[1]!).getByText("ไทยวัสดุ")).toBeInTheDocument();
    expect(within(rows[1]!).getByText(/4,900/)).toBeInTheDocument();
    expect(within(rows[1]!).getByText(/\+7%/)).toBeInTheDocument();
  });

  it("offers only not-yet-quoted suppliers and adds a quote", async () => {
    renderPC();
    const picker = screen.getByLabelText("ผู้ขาย") as HTMLSelectElement;
    // s1/s2 already quoted — only โฮมโปร (s3) remains.
    expect(within(picker).queryByRole("option", { name: "ส.รุ่งเรือง" })).toBeNull();
    expect(within(picker).getByRole("option", { name: "โฮมโปร" })).toBeInTheDocument();

    fireEvent.change(picker, { target: { value: "s3" } });
    fireEvent.change(screen.getByLabelText("ราคาต่อหน่วย"), { target: { value: "105" } });
    fireEvent.click(screen.getByRole("button", { name: "เพิ่ม" }));

    await waitFor(() =>
      expect(mockAdd).toHaveBeenCalledWith({
        purchaseRequestId: "pr1",
        supplierId: "s3",
        unitPrice: 105,
        note: "",
      }),
    );
    await waitFor(() => expect(mockRefresh).toHaveBeenCalled());
  });

  it("removes a quote", async () => {
    renderPC();
    const rows = screen.getAllByRole("listitem");
    fireEvent.click(within(rows[0]!).getByRole("button", { name: "ลบ" }));
    await waitFor(() =>
      expect(mockRemove).toHaveBeenCalledWith({ purchaseRequestId: "pr1", quoteId: "q1" }),
    );
  });

  it("shows an empty state with no quotes", () => {
    renderPC({ quotes: [] });
    expect(screen.getByText(/ยังไม่มีใบเสนอราคา/)).toBeInTheDocument();
  });
});

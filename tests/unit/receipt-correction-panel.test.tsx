// Writing failing test first.
//
// Spec 324 U5 — the back-office receipt-correction form. Two modes on ONE panel:
//   * decide  — reviewing an SA flag: the true-count prefills the SA's proposed
//     count; APPLY relays decideReceiptCorrectionRequest({requestId, approve:true,
//     trueQty}); REJECT reveals a REQUIRED note then relays approve:false + note;
//     a fresh-pool refusal (22023) from the RPC surfaces the guide copy, not a raw
//     error.
//   * direct  — BO trues a receipt with no flag: true-count + reason; SAVE relays
//     correctStockReceipt({receiptId, trueQty, reason}); a true-count outside
//     [0, orderedQty) is refused client-side (no call).

import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockCorrect, mockDecide, mockRefresh } = vi.hoisted(() => ({
  mockCorrect: vi.fn(),
  mockDecide: vi.fn(),
  mockRefresh: vi.fn(),
}));

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: mockRefresh }) }));
vi.mock("@/app/store/actions", () => ({
  correctStockReceipt: mockCorrect,
  decideReceiptCorrectionRequest: mockDecide,
}));
vi.mock("@/lib/ui/use-toast", () => ({
  useToast: () => ({
    error: vi.fn(),
    success: vi.fn(),
    toast: vi.fn(),
    dismiss: vi.fn(),
    fromResult: vi.fn(),
  }),
}));

import { ReceiptCorrectionPanel } from "@/components/features/store/receipt-correction-panel";
import {
  RECEIPT_CORRECTION_TRUE_QTY_LABEL,
  RECEIPT_CORRECTION_APPROVE_LABEL,
  RECEIPT_CORRECTION_REJECT_LABEL,
  RECEIPT_CORRECTION_CONFIRM_REJECT_LABEL,
  RECEIPT_CORRECTION_REJECT_NOTE_LABEL,
  RECEIPT_CORRECTION_REASON_LABEL,
  RECEIPT_CORRECTION_SAVE_LABEL,
  RECEIPT_FRESH_POOL_GUIDE,
} from "@/lib/i18n/labels";

beforeEach(() => {
  mockCorrect.mockReset().mockResolvedValue({ ok: true });
  mockDecide.mockReset().mockResolvedValue({ ok: true });
  mockRefresh.mockReset();
});

describe("ReceiptCorrectionPanel — decide mode (review an SA flag)", () => {
  const decideProps = {
    mode: "decide" as const,
    requestId: "req-1",
    proposedQty: 80,
    orderedQty: 100,
    unit: "ถุง",
  };

  it("prefills the true-count with the SA's proposed qty and offers approve + reject", () => {
    render(<ReceiptCorrectionPanel {...decideProps} />);
    const trueQty = screen.getByLabelText(RECEIPT_CORRECTION_TRUE_QTY_LABEL) as HTMLInputElement;
    expect(trueQty.value).toBe("80");
    expect(
      screen.getByRole("button", { name: RECEIPT_CORRECTION_APPROVE_LABEL }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: RECEIPT_CORRECTION_REJECT_LABEL }),
    ).toBeInTheDocument();
  });

  it("approve relays decideReceiptCorrectionRequest with the (edited) true count", async () => {
    render(<ReceiptCorrectionPanel {...decideProps} />);
    fireEvent.change(screen.getByLabelText(RECEIPT_CORRECTION_TRUE_QTY_LABEL), {
      target: { value: "75" },
    });
    // await act around the useTransition dispatch — RTL waitFor can miss the
    // transition flush under CI load (usetransition-test-flake-act-flush).
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: RECEIPT_CORRECTION_APPROVE_LABEL }));
    });
    expect(mockDecide).toHaveBeenCalledWith({ requestId: "req-1", approve: true, trueQty: 75 });
    expect(mockRefresh).toHaveBeenCalled();
  });

  it("surfaces the fresh-pool guide when the RPC refuses with 22023", async () => {
    mockDecide.mockResolvedValueOnce({ ok: false, error: RECEIPT_FRESH_POOL_GUIDE });
    render(<ReceiptCorrectionPanel {...decideProps} />);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: RECEIPT_CORRECTION_APPROVE_LABEL }));
    });
    expect(screen.getByRole("alert")).toHaveTextContent(RECEIPT_FRESH_POOL_GUIDE);
  });

  it("reject requires a note before relaying approve:false", async () => {
    render(<ReceiptCorrectionPanel {...decideProps} />);
    fireEvent.click(screen.getByRole("button", { name: RECEIPT_CORRECTION_REJECT_LABEL }));
    // blank note → refused client-side, no call
    fireEvent.change(screen.getByLabelText(RECEIPT_CORRECTION_REJECT_NOTE_LABEL), {
      target: { value: "   " },
    });
    await act(async () => {
      fireEvent.click(
        screen.getByRole("button", { name: RECEIPT_CORRECTION_CONFIRM_REJECT_LABEL }),
      );
    });
    expect(screen.getByRole("alert")).toBeInTheDocument();
    expect(mockDecide).not.toHaveBeenCalled();
    // with a note → relays
    fireEvent.change(screen.getByLabelText(RECEIPT_CORRECTION_REJECT_NOTE_LABEL), {
      target: { value: "ของมาครบ ไม่ต้องแก้" },
    });
    await act(async () => {
      fireEvent.click(
        screen.getByRole("button", { name: RECEIPT_CORRECTION_CONFIRM_REJECT_LABEL }),
      );
    });
    expect(mockDecide).toHaveBeenCalledWith({
      requestId: "req-1",
      approve: false,
      note: "ของมาครบ ไม่ต้องแก้",
    });
  });
});

describe("ReceiptCorrectionPanel — direct mode (BO corrects without a flag)", () => {
  const directProps = {
    mode: "direct" as const,
    receiptId: "rc-1",
    orderedQty: 100,
    unit: "ถุง",
  };

  it("relays correctStockReceipt with the true count + reason", async () => {
    render(<ReceiptCorrectionPanel {...directProps} />);
    fireEvent.change(screen.getByLabelText(RECEIPT_CORRECTION_TRUE_QTY_LABEL), {
      target: { value: "80" },
    });
    fireEvent.change(screen.getByLabelText(RECEIPT_CORRECTION_REASON_LABEL), {
      target: { value: "นับผิดตอนรับ" },
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: RECEIPT_CORRECTION_SAVE_LABEL }));
    });
    expect(mockCorrect).toHaveBeenCalledWith({
      receiptId: "rc-1",
      trueQty: 80,
      reason: "นับผิดตอนรับ",
    });
  });

  it("refuses a true count at/above the ordered qty (no call, shows an error)", async () => {
    render(<ReceiptCorrectionPanel {...directProps} />);
    fireEvent.change(screen.getByLabelText(RECEIPT_CORRECTION_TRUE_QTY_LABEL), {
      target: { value: "100" },
    });
    fireEvent.change(screen.getByLabelText(RECEIPT_CORRECTION_REASON_LABEL), {
      target: { value: "x" },
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: RECEIPT_CORRECTION_SAVE_LABEL }));
    });
    expect(screen.getByRole("alert")).toBeInTheDocument();
    expect(mockCorrect).not.toHaveBeenCalled();
  });
});

// Writing failing test first.
//
// Spec 324 U6 — the on-site SA flags a suspected over-count on a store receipt.
// The sheet takes a true count + reason + a REQUIRED live-camera photo, uploads
// the photo (pr-attachments, keyed on the receipt's PR), then relays
// submitReceiptCorrectionRequest with the resulting storage path. No photo → no
// submit; a proposed count outside [0, orderedQty) is refused client-side.

import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockUpload, mockSubmit, mockRefresh } = vi.hoisted(() => ({
  mockUpload: vi.fn(),
  mockSubmit: vi.fn(),
  mockRefresh: vi.fn(),
}));

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: mockRefresh }) }));
vi.mock("@/lib/store/upload-receipt-flag-photo", () => ({ uploadReceiptFlagPhoto: mockUpload }));
vi.mock("@/app/store/actions", () => ({ submitReceiptCorrectionRequest: mockSubmit }));
vi.mock("@/lib/ui/use-toast", () => ({
  useToast: () => ({
    error: vi.fn(),
    success: vi.fn(),
    toast: vi.fn(),
    dismiss: vi.fn(),
    fromResult: vi.fn(),
  }),
}));

import { ReceiptFlagSheet } from "@/components/features/store/receipt-flag-sheet";
import {
  RECEIPT_CORRECTION_TRUE_QTY_LABEL,
  RECEIPT_CORRECTION_REASON_LABEL,
  RECEIPT_FLAG_PHOTO_LABEL,
  RECEIPT_FLAG_SUBMIT_LABEL,
} from "@/lib/i18n/labels";

const props = {
  receiptId: "rc-1",
  projectId: "p1",
  purchaseRequestId: "pr1",
  orderedQty: 100,
  unit: "ถุง",
  itemLabel: "ปูนซีเมนต์",
};

beforeEach(() => {
  mockUpload.mockReset().mockResolvedValue({ ok: true, path: "p1/pr1/att.jpeg" });
  mockSubmit.mockReset().mockResolvedValue({ ok: true });
  mockRefresh.mockReset();
});

function fill(count: string, reason: string) {
  fireEvent.change(screen.getByLabelText(RECEIPT_CORRECTION_TRUE_QTY_LABEL), {
    target: { value: count },
  });
  fireEvent.change(screen.getByLabelText(RECEIPT_CORRECTION_REASON_LABEL), {
    target: { value: reason },
  });
}
function pickPhoto() {
  const file = new File(["bytes"], "photo.jpg", { type: "image/jpeg" });
  fireEvent.change(screen.getByLabelText(RECEIPT_FLAG_PHOTO_LABEL), { target: { files: [file] } });
  return file;
}

describe("ReceiptFlagSheet (spec 324 U6)", () => {
  it("refuses to submit without a photo (no upload, no relay, shows an error)", async () => {
    render(<ReceiptFlagSheet {...props} />);
    fill("80", "นับผิดตอนรับ");
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: RECEIPT_FLAG_SUBMIT_LABEL }));
    });
    expect(screen.getByRole("alert")).toBeInTheDocument();
    expect(mockUpload).not.toHaveBeenCalled();
    expect(mockSubmit).not.toHaveBeenCalled();
  });

  it("uploads the live photo then relays submitReceiptCorrectionRequest with its path", async () => {
    render(<ReceiptFlagSheet {...props} />);
    fill("80", "นับผิดตอนรับ");
    const file = pickPhoto();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: RECEIPT_FLAG_SUBMIT_LABEL }));
    });
    expect(mockUpload).toHaveBeenCalledWith("p1", "pr1", file);
    expect(mockSubmit).toHaveBeenCalledWith({
      receiptId: "rc-1",
      proposedQty: 80,
      reason: "นับผิดตอนรับ",
      photoPath: "p1/pr1/att.jpeg",
    });
    expect(mockRefresh).toHaveBeenCalled();
  });

  it("refuses a proposed count at/above the ordered qty (no upload, no relay)", async () => {
    render(<ReceiptFlagSheet {...props} />);
    fill("100", "x");
    pickPhoto();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: RECEIPT_FLAG_SUBMIT_LABEL }));
    });
    expect(screen.getByRole("alert")).toBeInTheDocument();
    expect(mockUpload).not.toHaveBeenCalled();
    expect(mockSubmit).not.toHaveBeenCalled();
  });

  it("requires a reason (no upload, no relay)", async () => {
    render(<ReceiptFlagSheet {...props} />);
    fill("80", "   ");
    pickPhoto();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: RECEIPT_FLAG_SUBMIT_LABEL }));
    });
    expect(screen.getByRole("alert")).toBeInTheDocument();
    expect(mockSubmit).not.toHaveBeenCalled();
  });
});

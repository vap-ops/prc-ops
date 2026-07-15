// Writing failing test first.
//
// Spec 323 U1d — RentalReceiptUploader: attach a receipt document (payment slip /
// tax invoice) to a rental settlement. Picks a file → uploadRentalReceiptFile
// (prepare → bucket bytes → admin metadata) → onUploaded + refresh. Mirrors
// ExpenseReceiptUploader.

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { uploadRentalReceiptFile, refresh } = vi.hoisted(() => ({
  uploadRentalReceiptFile: vi.fn(),
  refresh: vi.fn(),
}));

vi.mock("@/lib/equipment/upload-rental-receipt", () => ({ uploadRentalReceiptFile }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));

import { RentalReceiptUploader } from "@/components/features/equipment/rental-receipt-uploader";

beforeEach(() => {
  uploadRentalReceiptFile.mockReset().mockResolvedValue({ ok: true });
  refresh.mockReset();
});

function pickFile() {
  const input = document.querySelector('input[type="file"]') as HTMLInputElement;
  const file = new File(["x"], "slip.pdf", { type: "application/pdf" });
  fireEvent.change(input, { target: { files: [file] } });
}

describe("RentalReceiptUploader", () => {
  it("renders a labelled trigger for its purpose", () => {
    render(<RentalReceiptUploader settlementId="s1" purpose="payment_slip" label="แนบสลิป" />);
    expect(screen.getByRole("button", { name: "แนบสลิป" })).toBeInTheDocument();
  });

  it("uploads the chosen file for the given settlement + purpose, then refreshes", async () => {
    const onUploaded = vi.fn();
    render(
      <RentalReceiptUploader
        settlementId="s1"
        purpose="tax_invoice"
        label="แนบใบกำกับภาษี"
        onUploaded={onUploaded}
      />,
    );
    pickFile();
    await waitFor(() =>
      expect(uploadRentalReceiptFile).toHaveBeenCalledWith("s1", expect.any(File), "tax_invoice"),
    );
    await waitFor(() => expect(onUploaded).toHaveBeenCalled());
    await waitFor(() => expect(refresh).toHaveBeenCalled());
  });

  it("surfaces an upload error and does not refresh", async () => {
    uploadRentalReceiptFile.mockResolvedValue({ ok: false, error: "ส่งใบเสร็จไม่สำเร็จ" });
    render(<RentalReceiptUploader settlementId="s1" purpose="payment_slip" label="แนบสลิป" />);
    pickFile();
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("ส่งใบเสร็จไม่สำเร็จ");
    expect(refresh).not.toHaveBeenCalled();
  });
});

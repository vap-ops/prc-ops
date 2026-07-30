// Spec 380 U5 — InvoiceUploader forwards an optional docType prop straight
// into the action call. Omitted = the field is absent from the call (existing
// callers — PaymentProofUploader, ItemPhotoUploader — never break).
import { render, fireEvent, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockAdd, mockUpload, mockRefresh, mockPrepare } = vi.hoisted(() => ({
  mockAdd: vi.fn(),
  mockUpload: vi.fn(),
  mockRefresh: vi.fn(),
  mockPrepare: vi.fn(),
}));

vi.mock("@/app/requests/actions", () => ({ addInvoiceAttachment: mockAdd }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: mockRefresh }) }));
vi.mock("@/lib/db/browser", () => ({
  createClient: () => ({ storage: { from: () => ({ upload: mockUpload }) } }),
}));
vi.mock("@/lib/photos/downscale", () => ({ preparePhotoForUpload: mockPrepare }));
vi.mock("@/lib/purchasing/attachment-path", () => ({
  buildPrAttachmentStoragePath: () => "projects/p1/pr/r1/a1.jpg",
}));

import { InvoiceUploader } from "@/components/features/purchasing/invoice-uploader";

const file = () => new File(["x"], "receipt.jpg", { type: "image/jpeg" });
function fileInput(container: HTMLElement) {
  return container.querySelector('input[type="file"]') as HTMLInputElement;
}

beforeEach(() => {
  mockAdd.mockReset().mockResolvedValue({ ok: true });
  mockUpload.mockReset().mockResolvedValue({ error: null });
  mockRefresh.mockReset();
  mockPrepare.mockReset().mockResolvedValue({ blob: new Blob(["x"]), ext: "jpg" });
});

describe("InvoiceUploader docType passthrough (spec 380 U5)", () => {
  it("forwards the docType prop into the action call", async () => {
    const { container } = render(
      <InvoiceUploader purchaseRequestId="r1" projectId="p1" docType="tax_invoice_full" />,
    );
    fireEvent.change(fileInput(container), { target: { files: [file()] } });
    await waitFor(() => expect(mockAdd).toHaveBeenCalledTimes(1));
    expect(mockAdd).toHaveBeenCalledWith(expect.objectContaining({ docType: "tax_invoice_full" }));
  });

  it("omitting docType omits the field entirely — existing callers stay untouched", async () => {
    const { container } = render(<InvoiceUploader purchaseRequestId="r1" projectId="p1" />);
    fireEvent.change(fileInput(container), { target: { files: [file()] } });
    await waitFor(() => expect(mockAdd).toHaveBeenCalledTimes(1));
    const call = mockAdd.mock.calls[0]![0];
    expect("docType" in call).toBe(false);
  });
});

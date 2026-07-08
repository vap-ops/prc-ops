// Spec 285 U2 — the InvoiceUploader (and its ItemPhotoUploader wrapper) fire an
// optional onUploaded callback on each SUCCESSFUL save, so the expense form can
// track whether both kinds of evidence (item photo + accounting doc) exist and
// derive completeness. A failed save must NOT fire it.

import { render, fireEvent, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockAdd, mockUpload, mockRefresh, mockPrepare } = vi.hoisted(() => ({
  mockAdd: vi.fn(),
  mockUpload: vi.fn(),
  mockRefresh: vi.fn(),
  mockPrepare: vi.fn(),
}));

vi.mock("@/app/requests/actions", () => ({
  addInvoiceAttachment: mockAdd,
  addReferenceAttachment: mockAdd,
}));
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

describe("InvoiceUploader onUploaded (spec 285 U2)", () => {
  it("fires onUploaded once after a successful save", async () => {
    const onUploaded = vi.fn();
    const { container } = render(
      <InvoiceUploader purchaseRequestId="r1" projectId="p1" onUploaded={onUploaded} />,
    );
    fireEvent.change(fileInput(container), { target: { files: [file()] } });
    await waitFor(() => expect(mockAdd).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(onUploaded).toHaveBeenCalledTimes(1));
  });

  it("does NOT fire onUploaded when the save fails", async () => {
    mockAdd.mockResolvedValue({ ok: false, error: "บันทึกไม่สำเร็จ" });
    const onUploaded = vi.fn();
    const { container } = render(
      <InvoiceUploader purchaseRequestId="r1" projectId="p1" onUploaded={onUploaded} />,
    );
    fireEvent.change(fileInput(container), { target: { files: [file()] } });
    await waitFor(() => expect(mockAdd).toHaveBeenCalledTimes(1));
    expect(onUploaded).not.toHaveBeenCalled();
  });
});

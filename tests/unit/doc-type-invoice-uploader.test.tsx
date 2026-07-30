// Spec 380 U5 — the required-select wrapper around InvoiceUploader. The one
// hard rule: the file trigger must not exist until a type is chosen (a
// "required select" that still lets you upload untyped is not required).
import { render, fireEvent, screen, waitFor } from "@testing-library/react";
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

import { DocTypeInvoiceUploader } from "@/components/features/purchasing/doc-type-invoice-uploader";
import { DOC_TYPE_LABEL, DOC_TYPE_PICKER_LABEL } from "@/lib/i18n/labels";

const file = () => new File(["x"], "receipt.jpg", { type: "image/jpeg" });
function fileInput(container: HTMLElement) {
  return container.querySelector('input[type="file"]');
}

beforeEach(() => {
  mockAdd.mockReset().mockResolvedValue({ ok: true });
  mockUpload.mockReset().mockResolvedValue({ error: null });
  mockRefresh.mockReset();
  mockPrepare.mockReset().mockResolvedValue({ blob: new Blob(["x"]), ext: "jpg" });
});

describe("DocTypeInvoiceUploader (spec 380 U5)", () => {
  it("with no default, the file trigger does not exist until a type is picked", async () => {
    const { container } = render(
      <DocTypeInvoiceUploader purchaseRequestId="r1" projectId="p1" defaultDocType={null} />,
    );
    expect(fileInput(container)).toBeNull();

    fireEvent.change(screen.getByRole("combobox"), {
      target: { value: "tax_invoice_full" },
    });
    expect(fileInput(container)).not.toBeNull();
  });

  it("uploading after picking a type forwards that exact type to the action", async () => {
    const { container } = render(
      <DocTypeInvoiceUploader purchaseRequestId="r1" projectId="p1" defaultDocType={null} />,
    );
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "receipt_cash_bill" } });
    fireEvent.change(fileInput(container) as HTMLInputElement, { target: { files: [file()] } });
    await waitFor(() => expect(mockAdd).toHaveBeenCalledTimes(1));
    expect(mockAdd).toHaveBeenCalledWith(expect.objectContaining({ docType: "receipt_cash_bill" }));
  });

  it("a provided default pre-selects the type and the trigger is available immediately", () => {
    const { container } = render(
      <DocTypeInvoiceUploader
        purchaseRequestId="r1"
        projectId="p1"
        defaultDocType="tax_invoice_full"
      />,
    );
    expect(screen.getByRole("combobox")).toHaveValue("tax_invoice_full");
    expect(fileInput(container)).not.toBeNull();
  });

  it("changing the selection after a default flows through to the next upload", async () => {
    const { container } = render(
      <DocTypeInvoiceUploader
        purchaseRequestId="r1"
        projectId="p1"
        defaultDocType="tax_invoice_full"
      />,
    );
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "cert_in_lieu" } });
    fireEvent.change(fileInput(container) as HTMLInputElement, { target: { files: [file()] } });
    await waitFor(() => expect(mockAdd).toHaveBeenCalledTimes(1));
    expect(mockAdd).toHaveBeenCalledWith(expect.objectContaining({ docType: "cert_in_lieu" }));
  });

  it("forwards onUploaded to the inner InvoiceUploader", async () => {
    const onUploaded = vi.fn();
    const { container } = render(
      <DocTypeInvoiceUploader
        purchaseRequestId="r1"
        projectId="p1"
        defaultDocType="receipt_cash_bill"
        onUploaded={onUploaded}
      />,
    );
    fireEvent.change(fileInput(container) as HTMLInputElement, { target: { files: [file()] } });
    await waitFor(() => expect(onUploaded).toHaveBeenCalledTimes(1));
  });

  it("every option in the select is a real Thai label from the SSOT", () => {
    render(<DocTypeInvoiceUploader purchaseRequestId="r1" projectId="p1" defaultDocType={null} />);
    expect(screen.getByText(DOC_TYPE_LABEL.tax_invoice_full)).toBeInTheDocument();
    expect(screen.getByText(DOC_TYPE_LABEL.receipt_cash_bill)).toBeInTheDocument();
    expect(screen.getByText(DOC_TYPE_LABEL.payment_voucher)).toBeInTheDocument();
    expect(screen.getByText(DOC_TYPE_LABEL.cert_in_lieu)).toBeInTheDocument();
  });

  it("the select has an accessible name (WCAG 4.1.2) — a placeholder option alone is not one", () => {
    render(<DocTypeInvoiceUploader purchaseRequestId="r1" projectId="p1" defaultDocType={null} />);
    expect(screen.getByRole("combobox", { name: DOC_TYPE_PICKER_LABEL })).toBeInTheDocument();
  });

  it("wideTypes (the receive card) offers ใบส่งของ + อื่นๆ — an SA holding only the delivery note must have an honest option, never forced to mislabel it as an accounting doc that would flip covered_loose to a false missing/covered", () => {
    render(
      <DocTypeInvoiceUploader
        purchaseRequestId="r1"
        projectId="p1"
        defaultDocType={null}
        wideTypes
      />,
    );
    expect(screen.getByText(DOC_TYPE_LABEL.delivery_note)).toBeInTheDocument();
    expect(screen.getByText(DOC_TYPE_LABEL.other)).toBeInTheDocument();
  });

  it("without wideTypes, the strict accounting-doc list has no delivery_note/other — those mounts always expect a real doc", () => {
    render(<DocTypeInvoiceUploader purchaseRequestId="r1" projectId="p1" defaultDocType={null} />);
    expect(screen.queryByText(DOC_TYPE_LABEL.delivery_note)).toBeNull();
    expect(screen.queryByText(DOC_TYPE_LABEL.other)).toBeNull();
  });
});

// Spec 97: the PM-only contact documents block. Renders an ID-card row and a
// bank-book row, shows the current image when a signed URL is passed, and routes
// an upload through prepare → storage → addContactDocument (all mocked here).

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockAdd, mockRefresh, mockUpload, mockPrepare } = vi.hoisted(() => ({
  mockAdd: vi.fn(),
  mockRefresh: vi.fn(),
  mockUpload: vi.fn(),
  mockPrepare: vi.fn(),
}));

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: mockRefresh }) }));
vi.mock("@/app/contacts/actions", () => ({ addContactDocument: mockAdd }));
vi.mock("@/lib/db/browser", () => ({
  createClient: () => ({ storage: { from: () => ({ upload: mockUpload }) } }),
}));
vi.mock("@/lib/photos/downscale", () => ({ preparePhotoForUpload: mockPrepare }));

import { ContactDocumentsBlock } from "@/components/features/contact-documents-block";

const ID = "11111111-1111-1111-1111-111111111111";

beforeEach(() => {
  mockAdd.mockReset().mockResolvedValue({ ok: true });
  mockRefresh.mockReset();
  mockUpload.mockReset().mockResolvedValue({ error: null });
  mockPrepare.mockReset().mockResolvedValue({ blob: new Blob(["x"]), ext: "jpeg" });
});

describe("ContactDocumentsBlock", () => {
  it("renders both document rows and the PM-only note", () => {
    render(<ContactDocumentsBlock kind="contractor" id={ID} idCardUrl={null} bankBookUrl={null} />);
    expect(screen.getByText("บัตรประชาชน")).toBeInTheDocument();
    expect(screen.getByText("สมุดบัญชีธนาคาร")).toBeInTheDocument();
    expect(screen.getByText("เฉพาะผู้จัดการเห็นเอกสารนี้")).toBeInTheDocument();
  });

  it("shows the current image when a signed URL is provided", () => {
    render(
      <ContactDocumentsBlock
        kind="supplier"
        id={ID}
        idCardUrl="https://signed/id.jpg"
        bankBookUrl={null}
      />,
    );
    const img = screen.getByAltText("บัตรประชาชน") as HTMLImageElement;
    expect(img.src).toBe("https://signed/id.jpg");
  });

  it("uploads an ID card through prepare → storage → addContactDocument", async () => {
    const { container } = render(
      <ContactDocumentsBlock kind="contractor" id={ID} idCardUrl={null} bankBookUrl={null} />,
    );
    // First file input = the id_card row (rendered first).
    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(input, {
      target: { files: [new File(["x"], "id.jpg", { type: "image/jpeg" })] },
    });
    await waitFor(() => expect(mockUpload).toHaveBeenCalled());
    await waitFor(() =>
      expect(mockAdd).toHaveBeenCalledWith(
        expect.objectContaining({ kind: "contractor", id: ID, purpose: "id_card", ext: "jpeg" }),
      ),
    );
  });
});

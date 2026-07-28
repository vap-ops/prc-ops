// Writing failing test first.
//
// Spec 175 U4 — the per-item image control on the edit sheet. Picks a photo,
// downscales it, uploads to the catalog-images bucket, records the path, and
// refreshes. Mocks the browser storage client + downscale + action + router.

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockUpload, mockPrepare, mockSetImage, mockRefresh } = vi.hoisted(() => ({
  mockUpload: vi.fn(),
  mockPrepare: vi.fn(),
  mockSetImage: vi.fn(),
  mockRefresh: vi.fn(),
}));

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: mockRefresh }) }));
vi.mock("@/lib/db/browser", () => ({
  createClient: () => ({ storage: { from: () => ({ upload: mockUpload }) } }),
}));
vi.mock("@/lib/photos/downscale", () => ({ preparePhotoForUpload: mockPrepare }));
vi.mock("@/app/catalog/actions", () => ({ setCatalogItemImage: mockSetImage }));

import { CatalogImageControl } from "@/components/features/catalog/catalog-image-control";

beforeEach(() => {
  mockUpload.mockReset().mockResolvedValue({ error: null });
  mockPrepare
    .mockReset()
    .mockResolvedValue({ blob: new Blob(["x"]), ext: "jpeg", downscaled: true });
  mockSetImage.mockReset().mockResolvedValue({ ok: true });
  mockRefresh.mockReset();
});

const imageFile = () => new File(["x"], "p.jpg", { type: "image/jpeg" });

describe("CatalogImageControl (spec 175 U4)", () => {
  it("downscales, uploads, records the path under the item id, and refreshes", async () => {
    render(<CatalogImageControl itemId="c1" />);
    fireEvent.change(screen.getByLabelText("เลือกรูปภาพ"), { target: { files: [imageFile()] } });

    await waitFor(() => expect(mockPrepare).toHaveBeenCalled());
    await waitFor(() => expect(mockUpload).toHaveBeenCalled());
    await waitFor(() =>
      expect(mockSetImage).toHaveBeenCalledWith(expect.objectContaining({ id: "c1" })),
    );
    const path = mockSetImage.mock.calls[0]![0].path as string;
    expect(path).toMatch(/^c1\/.+\.jpeg$/);
    await waitFor(() => expect(mockRefresh).toHaveBeenCalled());
  });

  it("removes the image (path null) and refreshes", async () => {
    render(<CatalogImageControl itemId="c1" thumbnailUrl="https://x/y.jpg" />);
    fireEvent.click(screen.getByRole("button", { name: /ลบรูป/ }));

    await waitFor(() => expect(mockSetImage).toHaveBeenCalledWith({ id: "c1", path: null }));
    await waitFor(() => expect(mockRefresh).toHaveBeenCalled());
  });

  // 2026-07-28 field bug: the catalog-images storage policy had never been widened
  // to procurement_manager, so the one person who curates the catalog got the same
  // "try again" string as a network blip — and retried forever. A denial is
  // permanent; say so, and never invite a retry that cannot succeed.
  it("names a permission denial instead of inviting a retry", async () => {
    mockUpload.mockResolvedValue({ error: { statusCode: "403", message: "new row violates RLS" } });
    render(<CatalogImageControl itemId="c1" />);
    fireEvent.change(screen.getByLabelText("เลือกรูปภาพ"), { target: { files: [imageFile()] } });

    await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());
    expect(screen.getByRole("alert").textContent).toContain("ไม่มีสิทธิ์");
    expect(screen.getByRole("alert").textContent).not.toContain("ลองใหม่");
    expect(mockSetImage).not.toHaveBeenCalled();
  });

  it("still invites a retry for a transient failure", async () => {
    mockUpload.mockResolvedValue({ error: { statusCode: 503, message: "upstream unavailable" } });
    render(<CatalogImageControl itemId="c1" />);
    fireEvent.change(screen.getByLabelText("เลือกรูปภาพ"), { target: { files: [imageFile()] } });

    await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());
    expect(screen.getByRole("alert").textContent).toContain("ลองใหม่");
    expect(mockSetImage).not.toHaveBeenCalled();
  });

  it("rejects a non-image without uploading", async () => {
    mockPrepare.mockResolvedValue(null);
    render(<CatalogImageControl itemId="c1" />);
    fireEvent.change(screen.getByLabelText("เลือกรูปภาพ"), {
      target: { files: [new File(["x"], "a.txt", { type: "text/plain" })] },
    });

    await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());
    expect(mockUpload).not.toHaveBeenCalled();
    expect(mockSetImage).not.toHaveBeenCalled();
    expect(mockRefresh).not.toHaveBeenCalled();
  });
});

// Writing failing test first.
//
// Spec 175 U4 — the per-item image control on the edit sheet. Picks a photo,
// downscales it, uploads to the catalog-images bucket, records the path, and
// refreshes. Mocks the browser storage client + downscale + action + router.

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockUpload, mockPrepare, mockSetImage, mockRefresh, trackFriction } = vi.hoisted(() => ({
  trackFriction: vi.fn(),
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
vi.mock("@/lib/telemetry/friction", () => ({ trackFriction }));

import { CatalogImageControl } from "@/components/features/catalog/catalog-image-control";

beforeEach(() => {
  mockUpload.mockReset().mockResolvedValue({ error: null });
  mockPrepare
    .mockReset()
    .mockResolvedValue({ blob: new Blob(["x"]), ext: "jpeg", downscaled: true });
  mockSetImage.mockReset().mockResolvedValue({ ok: true });
  mockRefresh.mockReset();
  trackFriction.mockReset();
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
    expect(screen.getByRole("alert").textContent).toContain("สิทธิ์ไม่พอ");
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

// Writing failing test first.
//
// #823 was live for ~2 weeks and no one knew: this control reports a failed
// upload to nobody. The photo pipeline has emitted `upload_fail` since feedback
// 10a15ebe — the material catalog and the equipment condition photos never did,
// which is precisely why a 403 could hide behind a generic retry string. Same
// PDPA-minimal payload: a coarse class + a numeric HTTP status, never the file
// name, the path, or the raw error text.
describe("CatalogImageControl — upload_fail telemetry", () => {
  it("reports a denial with its class and status", async () => {
    mockUpload.mockResolvedValue({ error: { statusCode: "403", message: "new row violates RLS" } });
    render(<CatalogImageControl itemId="c1" />);
    fireEvent.change(screen.getByLabelText("เลือกรูปภาพ"), { target: { files: [imageFile()] } });

    await waitFor(() =>
      expect(trackFriction).toHaveBeenCalledWith("upload_fail", {
        kind: "catalog_image",
        stage: "storage",
        reason: "authz",
        status: 403,
      }),
    );
  });

  it("emits exactly once per failed attempt", async () => {
    mockUpload.mockResolvedValue({ error: { statusCode: "403", message: "denied" } });
    render(<CatalogImageControl itemId="c1" />);
    fireEvent.change(screen.getByLabelText("เลือกรูปภาพ"), { target: { files: [imageFile()] } });

    await waitFor(() => expect(trackFriction).toHaveBeenCalledOnce());
  });

  it("reports a transient failure too — the class is what tells them apart", async () => {
    mockUpload.mockResolvedValue({ error: { statusCode: 503, message: "upstream unavailable" } });
    render(<CatalogImageControl itemId="c1" />);
    fireEvent.change(screen.getByLabelText("เลือกรูปภาพ"), { target: { files: [imageFile()] } });

    await waitFor(() =>
      expect(trackFriction).toHaveBeenCalledWith("upload_fail", {
        kind: "catalog_image",
        stage: "storage",
        reason: "http_5xx",
        status: 503,
      }),
    );
  });

  it("emits NO status when the failure carried none (a fetch/network drop)", async () => {
    mockUpload.mockResolvedValue({ error: { message: "Failed to fetch" } });
    render(<CatalogImageControl itemId="c1" />);
    fireEvent.change(screen.getByLabelText("เลือกรูปภาพ"), { target: { files: [imageFile()] } });

    await waitFor(() => expect(trackFriction).toHaveBeenCalledOnce());
    const [type, context] = trackFriction.mock.calls[0] as [string, Record<string, unknown>];
    expect(type).toBe("upload_fail");
    expect(context).toEqual({ kind: "catalog_image", stage: "storage", reason: "network" });
    // toHaveBeenCalledWith would accept {status: undefined} here, so the conditional
    // spread could be deleted and stay green. Pin the KEY's absence.
    expect(Object.keys(context)).not.toContain("status");
  });

  it("stays silent when the upload succeeds", async () => {
    render(<CatalogImageControl itemId="c1" />);
    fireEvent.change(screen.getByLabelText("เลือกรูปภาพ"), { target: { files: [imageFile()] } });

    await waitFor(() => expect(mockRefresh).toHaveBeenCalled());
    expect(trackFriction).not.toHaveBeenCalled();
  });
});

// Writing failing test first (review: half the blindness stayed).
//
// The storage policy is only ONE of the two gates this control passes — the
// set_catalog_item_image RPC is the other, and a refusal there reported to nobody.
// #823 happened to be a storage policy; the next one need not be. The phase
// pipeline has emitted stage:"insert" for exactly this since feedback 10a15ebe.
describe("CatalogImageControl — the RPC layer reports too", () => {
  it("emits stage:insert when the path could not be recorded", async () => {
    mockSetImage.mockResolvedValue({ ok: false, error: "ไม่มีสิทธิ์" });
    render(<CatalogImageControl itemId="c1" />);
    fireEvent.change(screen.getByLabelText("เลือกรูปภาพ"), { target: { files: [imageFile()] } });

    await waitFor(() =>
      expect(trackFriction).toHaveBeenCalledWith("upload_fail", {
        kind: "catalog_image",
        stage: "insert",
      }),
    );
  });

  it("stays silent when the path is recorded", async () => {
    render(<CatalogImageControl itemId="c1" />);
    fireEvent.change(screen.getByLabelText("เลือกรูปภาพ"), { target: { files: [imageFile()] } });

    await waitFor(() => expect(mockRefresh).toHaveBeenCalled());
    expect(trackFriction).not.toHaveBeenCalled();
  });
});

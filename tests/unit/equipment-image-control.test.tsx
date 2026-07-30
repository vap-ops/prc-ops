// Writing failing test first.
//
// Spec 367 §7 (U5) — per-item image upload on the /equipment edit sheet, the last
// gap in the registry-completeness spec: `equipment_items.image_path` and the
// private `equipment-images` bucket have existed since U1 (mig …_075860_) with
// **zero** writers, so the fill rate is 0/64 by construction rather than by
// choice.
//
// Structurally this mirrors CatalogImageControl (spec 175 U4), which the spec
// names as the thing to reuse. Two differences are deliberate and are what these
// tests pin:
//
//   1. The path is `<itemId>/<uuid>.<ext>` — folder depth 1, which is the arm of
//      the live `equipment-images` INSERT policy that admits the back office.
//      (The other arm is `usage/<log>/…`, depth 2, for spec 370's condition
//      photos.) A path shape change silently 403s every upload.
//   2. `kind: "equipment_item_image"` in telemetry, distinct from the existing
//      `catalog_image` and `equipment_condition_photo` — #823 stayed live ~2
//      weeks because an upload refusal reported to nobody, and a shared kind
//      would hide which surface is failing.

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
  createClient: () => ({ storage: { from: mockBucket } }),
}));
vi.mock("@/lib/photos/downscale", () => ({ preparePhotoForUpload: mockPrepare }));
vi.mock("@/app/equipment/actions", () => ({ setEquipmentItemImage: mockSetImage }));
vi.mock("@/lib/telemetry/friction", () => ({ trackFriction }));

const mockBucket = vi.fn(() => ({ upload: mockUpload }));

import { EquipmentImageControl } from "@/components/features/equipment/equipment-image-control";

beforeEach(() => {
  mockUpload.mockReset().mockResolvedValue({ error: null });
  mockBucket.mockClear();
  mockPrepare
    .mockReset()
    .mockResolvedValue({ blob: new Blob(["x"]), ext: "jpeg", downscaled: true });
  mockSetImage.mockReset().mockResolvedValue({ ok: true });
  mockRefresh.mockReset();
  trackFriction.mockReset();
});

const imageFile = () => new File(["x"], "p.jpg", { type: "image/jpeg" });

describe("EquipmentImageControl (spec 367 U5)", () => {
  it("downscales, uploads to equipment-images under the item id, records the path, refreshes", async () => {
    render(<EquipmentImageControl itemId="e1" />);
    fireEvent.change(screen.getByLabelText("เลือกรูปภาพ"), { target: { files: [imageFile()] } });

    await waitFor(() => expect(mockUpload).toHaveBeenCalled());
    // The bucket is the other half of "did this land where the policy allows".
    expect(mockBucket).toHaveBeenCalledWith("equipment-images");
    await waitFor(() =>
      expect(mockSetImage).toHaveBeenCalledWith(expect.objectContaining({ id: "e1" })),
    );
    const path = mockSetImage.mock.calls[0]![0].path as string;
    // Depth 1 exactly: `<itemId>/<file>`. A nested path fails the policy's
    // array_length(foldername, 1) = 1 arm and 403s for every back-office user.
    expect(path).toMatch(/^e1\/[^/]+\.jpeg$/);
    expect(mockUpload.mock.calls[0]![0]).toBe(path);
    await waitFor(() => expect(mockRefresh).toHaveBeenCalled());
  });

  it("removes the image (path null) and refreshes", async () => {
    render(<EquipmentImageControl itemId="e1" thumbnailUrl="https://x/y.jpg" />);
    fireEvent.click(screen.getByRole("button", { name: /ลบรูป/ }));

    await waitFor(() => expect(mockSetImage).toHaveBeenCalledWith({ id: "e1", path: null }));
    await waitFor(() => expect(mockRefresh).toHaveBeenCalled());
  });

  it("offers no ลบรูป when there is no image to remove", () => {
    render(<EquipmentImageControl itemId="e1" />);
    expect(screen.queryByRole("button", { name: /ลบรูป/ })).not.toBeInTheDocument();
  });

  // The honest-copy class (#823/#826/#827/#829): a permanent refusal must never
  // be dressed as a retry the user can win.
  it("names a permission denial instead of inviting a retry", async () => {
    mockUpload.mockResolvedValue({ error: { statusCode: "403", message: "new row violates RLS" } });
    render(<EquipmentImageControl itemId="e1" />);
    fireEvent.change(screen.getByLabelText("เลือกรูปภาพ"), { target: { files: [imageFile()] } });

    await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());
    expect(screen.getByRole("alert").textContent).toContain("สิทธิ์ไม่พอ");
    expect(screen.getByRole("alert").textContent).not.toContain("ลองใหม่");
    expect(mockSetImage).not.toHaveBeenCalled();
  });

  it("still invites a retry for a transient failure", async () => {
    mockUpload.mockResolvedValue({ error: { statusCode: 503, message: "upstream unavailable" } });
    render(<EquipmentImageControl itemId="e1" />);
    fireEvent.change(screen.getByLabelText("เลือกรูปภาพ"), { target: { files: [imageFile()] } });

    await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());
    expect(screen.getByRole("alert").textContent).toContain("ลองใหม่");
  });

  it("rejects a non-image without uploading", async () => {
    mockPrepare.mockResolvedValue(null);
    render(<EquipmentImageControl itemId="e1" />);
    fireEvent.change(screen.getByLabelText("เลือกรูปภาพ"), {
      target: { files: [new File(["x"], "a.txt", { type: "text/plain" })] },
    });

    await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());
    expect(mockUpload).not.toHaveBeenCalled();
    expect(mockSetImage).not.toHaveBeenCalled();
    expect(mockRefresh).not.toHaveBeenCalled();
  });
});

describe("EquipmentImageControl — upload_fail telemetry", () => {
  it("reports a storage denial with its class and status, under its own kind", async () => {
    mockUpload.mockResolvedValue({ error: { statusCode: "403", message: "new row violates RLS" } });
    render(<EquipmentImageControl itemId="e1" />);
    fireEvent.change(screen.getByLabelText("เลือกรูปภาพ"), { target: { files: [imageFile()] } });

    await waitFor(() =>
      expect(trackFriction).toHaveBeenCalledWith("upload_fail", {
        kind: "equipment_item_image",
        stage: "storage",
        reason: "authz",
        status: 403,
      }),
    );
  });

  it("emits NO status key when the failure carried none (a network drop)", async () => {
    mockUpload.mockResolvedValue({ error: { message: "Failed to fetch" } });
    render(<EquipmentImageControl itemId="e1" />);
    fireEvent.change(screen.getByLabelText("เลือกรูปภาพ"), { target: { files: [imageFile()] } });

    await waitFor(() => expect(trackFriction).toHaveBeenCalledOnce());
    const [, context] = trackFriction.mock.calls[0] as [string, Record<string, unknown>];
    // toHaveBeenCalledWith would accept {status: undefined}, so the conditional
    // spread could be deleted and stay green. Pin the KEY's absence.
    expect(Object.keys(context)).not.toContain("status");
  });

  // Storage is only ONE of the two gates. The action is the other, and a refusal
  // there was equally invisible on the catalog side until #831.
  it("emits stage:insert when the path could not be recorded", async () => {
    mockSetImage.mockResolvedValue({ ok: false, error: "ไม่มีสิทธิ์แก้ไขรูปอุปกรณ์" });
    render(<EquipmentImageControl itemId="e1" />);
    fireEvent.change(screen.getByLabelText("เลือกรูปภาพ"), { target: { files: [imageFile()] } });

    await waitFor(() =>
      expect(trackFriction).toHaveBeenCalledWith("upload_fail", {
        kind: "equipment_item_image",
        stage: "insert",
      }),
    );
    expect(screen.getByRole("alert").textContent).toContain("ไม่มีสิทธิ์แก้ไขรูปอุปกรณ์");
    expect(mockRefresh).not.toHaveBeenCalled();
  });

  it("stays silent when the upload succeeds", async () => {
    render(<EquipmentImageControl itemId="e1" />);
    fireEvent.change(screen.getByLabelText("เลือกรูปภาพ"), { target: { files: [imageFile()] } });

    await waitFor(() => expect(mockRefresh).toHaveBeenCalled());
    expect(trackFriction).not.toHaveBeenCalled();
  });
});

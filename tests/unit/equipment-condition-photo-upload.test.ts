// Writing failing test first.
//
// Spec 370 D4/D7's condition-photo upload is the second blind uploader (the
// catalog control is the first): every storage failure collapses into
// "อัปโหลดรูปไม่สำเร็จ กรุณาลองใหม่" and is reported to nobody, so a 403 on the
// equipment-images policy would hide exactly the way #823 hid for two weeks.
// Same PDPA-minimal signal as the photo pipeline: coarse class + numeric status,
// never a file name, a path, or raw error text.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { mockUpload, mockPrepare, trackFriction } = vi.hoisted(() => ({
  mockUpload: vi.fn(),
  mockPrepare: vi.fn(),
  trackFriction: vi.fn(),
}));

vi.mock("@/lib/db/browser", () => ({
  createClient: () => ({ storage: { from: () => ({ upload: mockUpload }) } }),
}));
vi.mock("@/lib/photos/downscale", () => ({ preparePhotoForUpload: mockPrepare }));
vi.mock("@/lib/telemetry/friction", () => ({ trackFriction }));

import { uploadConditionPhotos } from "@/lib/equipment/photo-upload";

const IMAGE = () => new File(["x"], "cond.jpg", { type: "image/jpeg" });

beforeEach(() => {
  mockUpload.mockReset().mockResolvedValue({ error: null });
  mockPrepare.mockReset().mockResolvedValue({ blob: new Blob(["x"]), ext: "jpeg" });
  trackFriction.mockReset();
  vi.stubGlobal("crypto", { randomUUID: () => "11111111-1111-4111-8111-111111111111" });
});

afterEach(() => vi.unstubAllGlobals());

describe("uploadConditionPhotos — upload_fail telemetry", () => {
  it("reports a denial with its class and status", async () => {
    mockUpload.mockResolvedValue({
      error: { statusCode: "403", message: "new row violates row-level security policy" },
    });

    const result = await uploadConditionPhotos([IMAGE()]);

    expect(result.ok).toBe(false);
    expect(trackFriction).toHaveBeenCalledWith("upload_fail", {
      kind: "equipment_condition_photo",
      stage: "storage",
      reason: "authz",
      status: 403,
    });
  });

  it("reports an over-size rejection distinctly from a denial", async () => {
    mockUpload.mockResolvedValue({ error: { statusCode: 413, message: "Payload too large" } });

    await uploadConditionPhotos([IMAGE()]);

    expect(trackFriction).toHaveBeenCalledWith("upload_fail", {
      kind: "equipment_condition_photo",
      stage: "storage",
      reason: "size",
      status: 413,
    });
  });

  it("stays silent when every photo lands", async () => {
    const result = await uploadConditionPhotos([IMAGE(), IMAGE()]);

    expect(result).toMatchObject({ ok: true });
    expect(trackFriction).not.toHaveBeenCalled();
  });

  it("does not report the caller's own validation rejection (no upload was attempted)", async () => {
    // A non-image never reaches Storage — it is a validation_error elsewhere in the
    // vocabulary, not an upload failure, and counting it would inflate the signal.
    mockPrepare.mockResolvedValue(null);

    const result = await uploadConditionPhotos([IMAGE()]);

    expect(result.ok).toBe(false);
    expect(mockUpload).not.toHaveBeenCalled();
    expect(trackFriction).not.toHaveBeenCalled();
  });
});

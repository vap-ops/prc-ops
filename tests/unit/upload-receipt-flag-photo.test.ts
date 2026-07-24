// Writing failing test first.
//
// Spec 354 U2 — uploadReceiptFlagPhoto's direct upload stamps captureMethod
// "camera". Its only caller (ReceiptFlagSheet, spec 324 U6) offers a
// capture="environment" (camera-forced) file input — the SA's flag photo is
// always live, never a plain picker — so the value is a fixed "camera", not
// a per-call prop.

import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockUpload } = vi.hoisted(() => ({ mockUpload: vi.fn() }));

vi.mock("@/lib/db/browser", () => ({
  createClient: () => ({ storage: { from: () => ({ upload: mockUpload }) } }),
}));
vi.mock("@/lib/photos/downscale", () => ({
  preparePhotoForUpload: vi.fn(async () => ({ blob: new Blob(["x"]), ext: "jpg" })),
}));
vi.mock("@/lib/purchasing/attachment-path", () => ({
  buildPrAttachmentStoragePath: () => "p1/pr1/att1.jpg",
}));

import { uploadReceiptFlagPhoto } from "@/lib/store/upload-receipt-flag-photo";

beforeEach(() => {
  mockUpload.mockReset().mockResolvedValue({ error: null });
});

describe("uploadReceiptFlagPhoto capture method (spec 354 U2)", () => {
  it("stamps captureMethod camera — the caller's input is capture=environment", async () => {
    const file = new File(["x"], "photo.jpg", { type: "image/jpeg" });
    const result = await uploadReceiptFlagPhoto("p1", "pr1", file);
    expect(result.ok).toBe(true);
    expect(mockUpload).toHaveBeenCalledWith(
      "p1/pr1/att1.jpg",
      expect.anything(),
      expect.objectContaining({ metadata: { captureMethod: "camera" } }),
    );
  });
});

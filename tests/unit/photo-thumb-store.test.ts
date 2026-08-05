// Spec 398 U1 — the thumbnail store: the derived key (D3) and the generator (D5/D6).
//
// The generator takes its whole environment as deps (download / resize / upload) so the
// CONTROL FLOW is testable without sharp, without Storage, and without the network —
// the half that is actually wrong when this kind of code is wrong. Only the wiring seam
// is untested, and it is three lines.

import { describe, it, expect, vi } from "vitest";

import { thumbKeyFor, isThumbKey, THUMB_SIZE } from "@/lib/photos/thumb-key";
import { generatePhotoThumb, type ThumbDeps } from "@/lib/photos/generate-thumb";

const PHOTO_PATH =
  "a88af871-019b-4eca-a7aa-f05244c83e5d/ac0815b5-6623-437a-b664-97db108473a5/689ba62e-2f22-4c70-bacd-238e1d80745e.jpeg";
const THUMB_PATH = `thumbs/${PHOTO_PATH}.webp`;

describe("thumbKeyFor", () => {
  it("derives the thumb key from the original object key", () => {
    expect(thumbKeyFor(PHOTO_PATH)).toBe(THUMB_PATH);
  });

  it("produces an ASCII-only key for a real uuid-keyed photo path", () => {
    // Storage rejects non-ASCII object keys outright (the supabase-storage-key-ascii
    // trap). Photo paths are uuid-keyed so they are ASCII by construction — this pins
    // that the derivation cannot introduce anything else.
    expect(/^[\x20-\x7E]+$/.test(thumbKeyFor(PHOTO_PATH))).toBe(true);
  });

  it("refuses a non-ASCII source path instead of minting a key Storage will reject", () => {
    // Failing loudly here beats a 400 "Invalid key" from the bucket at upload time,
    // which is where this class of bug surfaced before (#933).
    expect(() => thumbKeyFor("โครงการ/งาน/รูป.jpeg")).toThrow(/ascii/i);
  });

  it("refuses to nest a thumb key inside another thumb key", () => {
    expect(() => thumbKeyFor(THUMB_PATH)).toThrow(/already a thumb/i);
  });

  it("recognises its own keys", () => {
    expect(isThumbKey(THUMB_PATH)).toBe(true);
    expect(isThumbKey(PHOTO_PATH)).toBe(false);
  });

  it("exports the one size the store is built at", () => {
    expect(THUMB_SIZE).toBe(320);
  });
});

function deps(over: Partial<ThumbDeps> = {}): ThumbDeps {
  return {
    download: vi.fn().mockResolvedValue({ bytes: Buffer.from("original-jpeg-bytes"), error: null }),
    resize: vi.fn().mockResolvedValue(Buffer.from("webp-bytes")),
    upload: vi.fn().mockResolvedValue({ error: null }),
    ...over,
  };
}

describe("generatePhotoThumb", () => {
  it("downloads the original, resizes it, and uploads at the derived key", async () => {
    const d = deps();
    const outcome = await generatePhotoThumb(PHOTO_PATH, d);

    expect(outcome).toEqual({ status: "created", key: THUMB_PATH });
    expect(d.download).toHaveBeenCalledWith(PHOTO_PATH);
    expect(d.resize).toHaveBeenCalledWith(Buffer.from("original-jpeg-bytes"));
    expect(d.upload).toHaveBeenCalledWith(THUMB_PATH, Buffer.from("webp-bytes"));
  });

  it("treats an already-existing thumb as done, not as a failure", async () => {
    // upsert:false means a concurrent render or a re-run of the backfill 409s. That is
    // the SAME idempotence shape the upload queue relies on (classifyStorageUploadError),
    // and it must not be reported as an error or the backfill can never be resumed.
    const d = deps({
      upload: vi.fn().mockResolvedValue({ error: { statusCode: "409", message: "Duplicate" } }),
    });
    expect(await generatePhotoThumb(PHOTO_PATH, d)).toEqual({ status: "exists", key: THUMB_PATH });
  });

  it("reports a download failure without throwing, and never uploads", async () => {
    const d = deps({
      download: vi.fn().mockResolvedValue({ bytes: null, error: { message: "Object not found" } }),
    });
    const outcome = await generatePhotoThumb(PHOTO_PATH, d);

    expect(outcome.status).toBe("failed");
    expect(d.resize).not.toHaveBeenCalled();
    expect(d.upload).not.toHaveBeenCalled();
  });

  it("reports a resize failure without throwing, and never uploads", async () => {
    // A corrupt or unsupported original (an HEIC libvips cannot read) must not take down
    // the request that scheduled it — the photo still renders full-size (D4).
    const d = deps({ resize: vi.fn().mockRejectedValue(new Error("unsupported image format")) });
    const outcome = await generatePhotoThumb(PHOTO_PATH, d);

    expect(outcome.status).toBe("failed");
    expect(d.upload).not.toHaveBeenCalled();
  });

  it("reports a non-duplicate upload failure without throwing", async () => {
    const d = deps({
      upload: vi.fn().mockResolvedValue({ error: { statusCode: "500", message: "boom" } }),
    });
    expect((await generatePhotoThumb(PHOTO_PATH, d)).status).toBe("failed");
  });

  it("refuses a path it cannot derive a key for, without touching storage", async () => {
    const d = deps();
    const outcome = await generatePhotoThumb("โครงการ/รูป.jpeg", d);

    expect(outcome.status).toBe("failed");
    expect(d.download).not.toHaveBeenCalled();
  });
});

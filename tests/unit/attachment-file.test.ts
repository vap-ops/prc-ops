// Spec 121 / ADR 0046 Layer A — PDF + image classification for the
// pr-attachments write path. Pure helpers, safe to import from client and
// server (no server-only, no Supabase). PDFs are NOT downscaled (spec-34
// preparePhotoForUpload is photo-only), so the upload path branches on these.

import { describe, expect, it } from "vitest";

import {
  ATTACHMENT_ACCEPT_MIME,
  PDF_MIME,
  attachmentExtToMime,
  attachmentKindForExt,
  isPdfMime,
  isValidAttachmentExt,
} from "@/lib/purchasing/attachment-file";
import { PHOTO_ACCEPT_MIME } from "@/lib/photos/path";

describe("isPdfMime", () => {
  it("is true only for application/pdf", () => {
    expect(isPdfMime("application/pdf")).toBe(true);
    expect(isPdfMime(PDF_MIME)).toBe(true);
    expect(isPdfMime("image/jpeg")).toBe(false);
    expect(isPdfMime("image/png")).toBe(false);
    expect(isPdfMime("")).toBe(false);
  });
});

describe("isValidAttachmentExt", () => {
  it("accepts the photo exts and pdf", () => {
    expect(isValidAttachmentExt("jpeg")).toBe(true);
    expect(isValidAttachmentExt("png")).toBe(true);
    expect(isValidAttachmentExt("webp")).toBe(true);
    expect(isValidAttachmentExt("heic")).toBe(true);
    expect(isValidAttachmentExt("pdf")).toBe(true);
  });

  it("rejects anything else (unvalidated client input)", () => {
    expect(isValidAttachmentExt("gif")).toBe(false);
    expect(isValidAttachmentExt("exe")).toBe(false);
    expect(isValidAttachmentExt("../escape")).toBe(false);
    expect(isValidAttachmentExt(42)).toBe(false);
    expect(isValidAttachmentExt(null)).toBe(false);
    expect(isValidAttachmentExt(undefined)).toBe(false);
  });
});

describe("attachmentKindForExt", () => {
  it("maps pdf → pdf and every photo ext → image", () => {
    expect(attachmentKindForExt("pdf")).toBe("pdf");
    expect(attachmentKindForExt("jpeg")).toBe("image");
    expect(attachmentKindForExt("png")).toBe("image");
    expect(attachmentKindForExt("webp")).toBe("image");
    expect(attachmentKindForExt("heic")).toBe("image");
  });
});

describe("attachmentExtToMime", () => {
  it("returns the upload contentType per ext", () => {
    expect(attachmentExtToMime("pdf")).toBe("application/pdf");
    expect(attachmentExtToMime("jpeg")).toBe("image/jpeg");
    expect(attachmentExtToMime("png")).toBe("image/png");
    expect(attachmentExtToMime("webp")).toBe("image/webp");
    expect(attachmentExtToMime("heic")).toBe("image/heic");
  });
});

describe("ATTACHMENT_ACCEPT_MIME", () => {
  it("is the photo accept list plus application/pdf", () => {
    expect(ATTACHMENT_ACCEPT_MIME).toContain("application/pdf");
    // every photo mime carries through
    for (const mime of PHOTO_ACCEPT_MIME.split(",")) {
      expect(ATTACHMENT_ACCEPT_MIME).toContain(mime);
    }
  });
});

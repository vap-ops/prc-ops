// Spec 125 / ADR 0046 Layer B — canonical po-attachments storage path:
//   {po_id}/{attachment_id}.{ext}
// A PO can span projects, so the path is keyed on the po_id alone (the
// upload policy checks the PO exists). The server rebuilds this path itself;
// a client-supplied path is never trusted, so malformed ids return null.

import { describe, expect, it } from "vitest";

import { buildPoAttachmentStoragePath } from "@/lib/purchasing/po-attachment-path";

const PO = "a1111111-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const ATT = "f1111111-ffff-ffff-ffff-ffffffffffff";

describe("buildPoAttachmentStoragePath (spec 125)", () => {
  it("builds the canonical two-segment path for an image ext", () => {
    expect(buildPoAttachmentStoragePath(PO, ATT, "jpeg")).toBe(`${PO}/${ATT}.jpeg`);
  });

  it("builds a .pdf path (PDFs are first-class, spec 121)", () => {
    expect(buildPoAttachmentStoragePath(PO, ATT, "pdf")).toBe(`${PO}/${ATT}.pdf`);
  });

  it("returns null for a malformed uuid in any segment", () => {
    expect(buildPoAttachmentStoragePath("not-a-uuid", ATT, "jpeg")).toBeNull();
    expect(buildPoAttachmentStoragePath(PO, "../escape", "jpeg")).toBeNull();
  });

  it("returns null for an extension outside the bucket's mime set", () => {
    // @ts-expect-error — runtime guard for unvalidated client input
    expect(buildPoAttachmentStoragePath(PO, ATT, "gif")).toBeNull();
  });
});

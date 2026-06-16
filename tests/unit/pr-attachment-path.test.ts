// Spec 23 (spec 16 §4 contract) — canonical pr-attachments storage path:
//   {project_id}/{purchase_request_id}/{attachment_id}.{ext}
// The server action rebuilds this path itself; a client-supplied path is
// never trusted, so the builder must reject malformed ids outright.

import { describe, expect, it } from "vitest";

import { buildPrAttachmentStoragePath } from "@/lib/purchasing/attachment-path";

const PROJECT = "cccccccc-cccc-cccc-cccc-cccccccccccc";
const PR = "a1111111-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const ATT = "f1111111-ffff-ffff-ffff-ffffffffffff";

describe("buildPrAttachmentStoragePath (spec 23)", () => {
  it("builds the canonical three-segment path", () => {
    expect(buildPrAttachmentStoragePath(PROJECT, PR, ATT, "jpeg")).toBe(
      `${PROJECT}/${PR}/${ATT}.jpeg`,
    );
  });

  it("returns null for a malformed uuid in any segment", () => {
    expect(buildPrAttachmentStoragePath("not-a-uuid", PR, ATT, "jpeg")).toBeNull();
    expect(buildPrAttachmentStoragePath(PROJECT, "x", ATT, "jpeg")).toBeNull();
    expect(buildPrAttachmentStoragePath(PROJECT, PR, "../escape", "jpeg")).toBeNull();
  });

  it("builds a .pdf path (spec 121 / ADR 0046 Layer A — PDFs are first-class)", () => {
    expect(buildPrAttachmentStoragePath(PROJECT, PR, ATT, "pdf")).toBe(
      `${PROJECT}/${PR}/${ATT}.pdf`,
    );
  });

  it("returns null for an extension outside the bucket's mime set", () => {
    // @ts-expect-error — runtime guard for unvalidated client input
    expect(buildPrAttachmentStoragePath(PROJECT, PR, ATT, "gif")).toBeNull();
    // @ts-expect-error — runtime guard for unvalidated client input
    expect(buildPrAttachmentStoragePath(PROJECT, PR, ATT, "exe")).toBeNull();
  });
});

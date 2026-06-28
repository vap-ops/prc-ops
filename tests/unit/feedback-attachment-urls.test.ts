// Bug 8e9c9fc7 — "Superadmin cannot see attached images". Attachments were loaded
// + grouped inline on the review kanban but the logic lived nowhere shared, so the
// conversation detail page never showed images. groupAttachmentUrls is the extracted,
// testable core: it folds attachment rows + a signed-URL-by-id map into a
// per-feedback list of URLs, skipping any row whose URL failed to sign.
import { describe, it, expect } from "vitest";
import { groupAttachmentUrls } from "@/lib/feedback/attachment-urls";

describe("groupAttachmentUrls", () => {
  it("groups signed urls under their feedback id, preserving row order", () => {
    const rows = [
      { id: "a1", feedback_id: "f1" },
      { id: "a2", feedback_id: "f1" },
      { id: "b1", feedback_id: "f2" },
    ];
    const signed = new Map([
      ["a1", "https://s/a1"],
      ["a2", "https://s/a2"],
      ["b1", "https://s/b1"],
    ]);
    const grouped = groupAttachmentUrls(rows, signed);
    expect(grouped.get("f1")).toEqual(["https://s/a1", "https://s/a2"]);
    expect(grouped.get("f2")).toEqual(["https://s/b1"]);
  });

  it("skips rows whose url failed to sign", () => {
    const rows = [
      { id: "a1", feedback_id: "f1" },
      { id: "a2", feedback_id: "f1" },
    ];
    const signed = new Map([["a1", "https://s/a1"]]);
    expect(groupAttachmentUrls(rows, signed).get("f1")).toEqual(["https://s/a1"]);
  });

  it("returns an empty map for no rows", () => {
    expect(groupAttachmentUrls([], new Map()).size).toBe(0);
  });
});

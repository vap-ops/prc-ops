// Writing failing test first.
//
// Spec 367 U5/U5b — the one rule both write paths share: an item's image path
// must live in that item's OWN folder, at depth 1.
//
// Depth 1 is not cosmetic. The live `equipment-images` INSERT policy admits the
// back office only at `array_length(storage.foldername(name), 1) = 1`; its other
// arm is `usage/<log>/…` (depth 2) for spec 370's borrow/return condition photos.
// So this predicate is what keeps a crafted call from pointing a row at another
// item's folder, or at the usage tree.
//
// Extracted rather than re-typed: it was a regex inside setEquipmentItemImage,
// and U5b needs the identical check inside createEquipment. Two copies of an
// authority rule is how they drift.

import { describe, expect, it } from "vitest";
import { isOwnItemImagePath } from "@/lib/equipment/image-path";

const ID = "8398b7d3-61f8-480c-a9b0-63f0c4701ca7";
const OTHER = "a43fdea5-4e94-4065-9ac7-182da0692348";

describe("isOwnItemImagePath", () => {
  it("accepts a file directly inside the item's own folder", () => {
    expect(isOwnItemImagePath(ID, `${ID}/abc.jpeg`)).toBe(true);
  });

  it("accepts null — clearing the image is always allowed", () => {
    expect(isOwnItemImagePath(ID, null)).toBe(true);
  });

  it("rejects another item's folder", () => {
    expect(isOwnItemImagePath(ID, `${OTHER}/abc.jpeg`)).toBe(false);
  });

  it("rejects a nested path — depth 2 is the usage arm, not this one", () => {
    expect(isOwnItemImagePath(ID, `${ID}/nested/abc.jpeg`)).toBe(false);
  });

  it("rejects spec 370's usage tree", () => {
    expect(isOwnItemImagePath(ID, `usage/${ID}/abc.jpeg`)).toBe(false);
  });

  it("rejects a bare filename with no folder at all", () => {
    expect(isOwnItemImagePath(ID, "abc.jpeg")).toBe(false);
  });

  it("rejects a traversal attempt", () => {
    expect(isOwnItemImagePath(ID, `${ID}/../${OTHER}/abc.jpeg`)).toBe(false);
  });

  it("rejects an empty filename", () => {
    expect(isOwnItemImagePath(ID, `${ID}/`)).toBe(false);
  });

  // The id is interpolated into a pattern, so a caller-supplied id that is not a
  // plain uuid must never be able to widen the match.
  it("rejects a regex-shaped id rather than honouring it as a pattern", () => {
    expect(isOwnItemImagePath(".*", `${OTHER}/abc.jpeg`)).toBe(false);
  });
});

// Spec 257 U2 — pure grouping/cap for the day/week thumbnail strips. Caps
// total thumbnails rendered per day at DAY_PHOTO_CAP; groups the (possibly
// truncated) set by work package, preserving encounter order.

import { describe, expect, it } from "vitest";
import { groupPhotosByWp, DAY_PHOTO_CAP } from "@/lib/work-packages/day-photo-grouping";
import type { SchedulePhotoEntry } from "@/app/projects/[projectId]/schedule/actions";

function entry(photoId: string, workPackageId: string): SchedulePhotoEntry {
  return { photoId, workPackageId, thumbUrl: `thumb/${photoId}`, fullUrl: `full/${photoId}` };
}

describe("groupPhotosByWp", () => {
  it("empty input → empty map, no extra", () => {
    const { byWp, extra } = groupPhotosByWp([], 60);
    expect(byWp.size).toBe(0);
    expect(extra).toBe(0);
  });

  it("groups photos by work package, preserving order", () => {
    const photos = [entry("p1", "w1"), entry("p2", "w1"), entry("p3", "w2")];
    const { byWp, extra } = groupPhotosByWp(photos, 60);
    expect(byWp.get("w1")?.map((p) => p.photoId)).toEqual(["p1", "p2"]);
    expect(byWp.get("w2")?.map((p) => p.photoId)).toEqual(["p3"]);
    expect(extra).toBe(0);
  });

  it("caps total shown and reports the remainder as extra", () => {
    const photos = Array.from({ length: 5 }, (_, i) => entry(`p${i}`, "w1"));
    const { byWp, extra } = groupPhotosByWp(photos, 3);
    expect(byWp.get("w1")?.length).toBe(3);
    expect(extra).toBe(2);
  });

  it("DAY_PHOTO_CAP is 60", () => {
    expect(DAY_PHOTO_CAP).toBe(60);
  });
});

// Spec 257 U2 — pure grouping/cap for the calendar's thumbnail strips. A day
// can carry more photos than are worth rendering inline (busy WPs, many
// projects); this caps the total shown across the day and groups the
// (possibly truncated) set by work package, preserving encounter order.

import type { SchedulePhotoEntry } from "@/app/projects/[projectId]/schedule/actions";

export const DAY_PHOTO_CAP = 60;

export interface GroupedDayPhotos {
  byWp: Map<string, SchedulePhotoEntry[]>;
  /** Photos beyond the cap, not included in byWp. */
  extra: number;
}

export function groupPhotosByWp(
  photos: ReadonlyArray<SchedulePhotoEntry>,
  cap: number = DAY_PHOTO_CAP,
): GroupedDayPhotos {
  const shown = photos.slice(0, cap);
  const extra = Math.max(0, photos.length - cap);
  const byWp = new Map<string, SchedulePhotoEntry[]>();
  for (const p of shown) {
    const arr = byWp.get(p.workPackageId) ?? byWp.set(p.workPackageId, []).get(p.workPackageId)!;
    arr.push(p);
  }
  return { byWp, extra };
}

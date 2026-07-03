// Spec 257 U1 — pure day-photo selection for getSchedulePhotos: current
// photos (ADR 0009 anti-join + ADR 0015 tombstone, via the shared
// photo-evidence.ts predicate) restricted to a requested set of Bangkok ISO
// dates.

import {
  currentPhotoRows,
  photoBangkokDate,
  type ActivityPhotoRow,
} from "@/lib/work-packages/photo-evidence";

export function selectDayPhotos(
  rows: ReadonlyArray<ActivityPhotoRow>,
  isoDates: ReadonlySet<string>,
): ActivityPhotoRow[] {
  return currentPhotoRows(rows).filter((r) => {
    const day = photoBangkokDate(r);
    return day !== null && isoDates.has(day);
  });
}

// Spec 257 U1 — pure day-photo selection for getSchedulePhotos: current
// photos (ADR 0009 anti-join + ADR 0015 tombstone, via the shared
// photo-evidence.ts predicate) restricted to a requested set of Bangkok ISO
// dates.

import {
  currentPhotoRows,
  photoBangkokDate,
  type ActivityPhotoRow,
} from "@/lib/work-packages/photo-evidence";

// Generic over T so callers that select extra columns (e.g. uploaded_by)
// keep them on the returned rows — the predicate only reads the
// ActivityPhotoRow fields, but the output type isn't narrowed to them.
export function selectDayPhotos<T extends ActivityPhotoRow>(
  rows: ReadonlyArray<T>,
  isoDates: ReadonlySet<string>,
): T[] {
  return currentPhotoRows(rows).filter((r) => {
    const day = photoBangkokDate(r);
    return day !== null && isoDates.has(day);
  });
}

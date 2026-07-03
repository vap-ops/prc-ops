// Spec 255 U1 — per-WP activity spans from photo evidence. The schedule
// calendar self-populates from photos: a WP's activity span is the min..max
// Asia/Bangkok calendar date of its CURRENT photos. The current-photo read and
// the photo-date rule live in photo-evidence.ts (shared with the spec-256
// per-day aggregator). Pure over minimal rows so it unit-tests without a
// Supabase mock; the loader fetches project-wide rows and aggregates here in
// memory (same trade-off as current-photos.ts — PostgREST has no EXISTS
// subquery, row counts are small).

import {
  currentPhotoRows,
  photoBangkokDate,
  type ActivityPhotoRow,
} from "@/lib/work-packages/photo-evidence";

export type { ActivityPhotoRow };

export interface ActivitySpan {
  firstIso: string;
  lastIso: string;
}

export function activitySpans(rows: ReadonlyArray<ActivityPhotoRow>): Map<string, ActivitySpan> {
  const out = new Map<string, ActivitySpan>();
  for (const r of currentPhotoRows(rows)) {
    const day = photoBangkokDate(r);
    if (day === null) continue;
    const cur = out.get(r.work_package_id);
    if (!cur) {
      out.set(r.work_package_id, { firstIso: day, lastIso: day });
    } else {
      if (day < cur.firstIso) cur.firstIso = day;
      if (day > cur.lastIso) cur.lastIso = day;
    }
  }
  return out;
}

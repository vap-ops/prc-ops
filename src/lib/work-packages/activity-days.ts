// Spec 256 U1 — per-day photo activity for the calendar views. Same
// current-photo read as activity-span (shared photo-evidence primitives),
// aggregated to day → WP → photo count.

import {
  currentPhotoRows,
  photoBangkokDate,
  type ActivityPhotoRow,
} from "@/lib/work-packages/photo-evidence";

export type { ActivityPhotoRow };

export type ActivityDays = Map<string, Map<string, number>>;

export function activityDays(rows: ReadonlyArray<ActivityPhotoRow>): ActivityDays {
  const out: ActivityDays = new Map();
  for (const r of currentPhotoRows(rows)) {
    const day = photoBangkokDate(r);
    if (day === null) continue;
    const perWp = out.get(day) ?? out.set(day, new Map()).get(day)!;
    perWp.set(r.work_package_id, (perWp.get(r.work_package_id) ?? 0) + 1);
  }
  return out;
}

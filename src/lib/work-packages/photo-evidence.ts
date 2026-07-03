// Spec 256 U1 — shared photo-evidence primitives for the schedule surfaces.
// One home for the current-photo read (ADR 0009 anti-join + ADR 0015 tombstone
// filter, mirroring current-photos.ts) and the Bangkok photo-date rule, so the
// span aggregator (spec 255) and the per-day aggregator (spec 256) cannot
// drift apart.

import { bangkokDateOf } from "@/lib/dates";

export interface ActivityPhotoRow {
  id: string;
  work_package_id: string;
  storage_path: string | null;
  superseded_by: string | null;
  captured_at_client: string | null;
  created_at: string;
}

/** Current photos only: no tombstones, no superseded/removed rows. */
export function currentPhotoRows(rows: ReadonlyArray<ActivityPhotoRow>): ActivityPhotoRow[] {
  const supersededIds = new Set<string>();
  for (const r of rows) {
    if (r.superseded_by !== null) supersededIds.add(r.superseded_by);
  }
  return rows.filter((r) => r.storage_path !== null && !supersededIds.has(r.id));
}

/** A photo's Asia/Bangkok calendar date, or null when the timestamp is bad. */
export function photoBangkokDate(row: ActivityPhotoRow): string | null {
  const ts = row.captured_at_client ?? row.created_at;
  if (Number.isNaN(Date.parse(ts))) return null;
  return bangkokDateOf(ts);
}

// Spec 255 U1 — per-WP activity spans from photo evidence. The schedule
// calendar self-populates from photos: a WP's activity span is the min..max
// Asia/Bangkok calendar date of its CURRENT photos (ADR 0009 anti-join + ADR
// 0015 tombstone filter — mirrors selectCurrentPhotosByPhase). Pure over
// minimal rows so it unit-tests without a Supabase mock; the loader fetches
// project-wide rows and aggregates here in memory (same trade-off as
// current-photos.ts — PostgREST has no EXISTS subquery, row counts are small).

import { bangkokDateOf } from "@/lib/dates";

export interface ActivityPhotoRow {
  id: string;
  work_package_id: string;
  storage_path: string | null;
  superseded_by: string | null;
  captured_at_client: string | null;
  created_at: string;
}

export interface ActivitySpan {
  firstIso: string;
  lastIso: string;
}

export function activitySpans(rows: ReadonlyArray<ActivityPhotoRow>): Map<string, ActivitySpan> {
  const supersededIds = new Set<string>();
  for (const r of rows) {
    if (r.superseded_by !== null) supersededIds.add(r.superseded_by);
  }

  const out = new Map<string, ActivitySpan>();
  for (const r of rows) {
    if (r.storage_path === null) continue; // tombstone
    if (supersededIds.has(r.id)) continue; // replaced or removed
    const ts = r.captured_at_client ?? r.created_at;
    if (Number.isNaN(Date.parse(ts))) continue;
    const day = bangkokDateOf(ts);
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

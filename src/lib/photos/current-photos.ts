// Read pattern for "current photos for a WP", per ADR 0015:
// the ADR 0009 anti-join PLUS `storage_path IS NOT NULL`. Tombstones
// (storage_path NULL) and superseded photos (rows pointed at by some
// other row's `superseded_by`) are excluded.
//
// PostgREST does not natively express an EXISTS subquery, and ~30
// photos per WP is small. We fetch every photo_logs row for the WP
// under the user's RLS context, then filter + group in memory. The
// filtering is a pure function over rows (selectCurrentPhotosByPhase),
// kept exported so it is unit-testable without a Supabase mock.

import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Tables } from "@/lib/db/database.types";

export type PhotoLogRow = Tables<"photo_logs">;
export type { PhotoPhase } from "@/lib/db/enums";

/**
 * Spec 340 U2 — a photo plus the number the field sees ("ระหว่างทำ #4").
 *
 * `seq` is an ordinal over the phase's REAL photos (tombstones excluded) by
 * (created_at, id), assigned BEFORE the anti-join drops removed ones. Because
 * photo_logs is append-only, a removed photo's row never leaves the table, so
 * its number is retired and no surviving photo is ever renumbered — the
 * property that makes a number safe to quote in a screenshot or a message.
 */
export type NumberedPhoto = PhotoLogRow & { seq: number };

export interface CurrentPhotosByPhase {
  before: NumberedPhoto[];
  during: NumberedPhoto[];
  after: NumberedPhoto[];
  // Feedback 0fa23307 — rework-completion photos.
  after_fix: NumberedPhoto[];
  // Spec 248 — the PM's defect-report photos (round-stamped, paired by
  // answers_photo_id from after_fix rows).
  defect: NumberedPhoto[];
}

// Capture order — the same clock the tile LABELS (`captured_at_client ??
// created_at`). Ordering by `created_at` alone would be UPLOAD order, and the
// ADR 0039 offline queue can flush long after the shot: a queued photo would
// outrank photos taken after it, and since each phase is sorted by this number
// the grid would render its times visibly out of order. `created_at` then `id`
// break ties so two shots in the same second never swap between reads.
function captureKey(r: PhotoLogRow): string {
  return r.captured_at_client ?? r.created_at ?? "";
}

function byCaptureOrder(a: PhotoLogRow, b: PhotoLogRow): number {
  const ak = captureKey(a);
  const bk = captureKey(b);
  if (ak !== bk) return ak < bk ? -1 : 1;
  const at = a.created_at ?? "";
  const bt = b.created_at ?? "";
  if (at !== bt) return at < bt ? -1 : 1;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

export function selectCurrentPhotosByPhase(rows: ReadonlyArray<PhotoLogRow>): CurrentPhotosByPhase {
  const supersededIds = new Set<string>();
  for (const r of rows) {
    if (r.superseded_by !== null) {
      supersededIds.add(r.superseded_by);
    }
  }

  const result: CurrentPhotosByPhase = {
    before: [],
    during: [],
    after: [],
    after_fix: [],
    defect: [],
  };
  // Number over the REAL photos of each phase — including ones later removed —
  // then drop the removed ones. Numbering after the anti-join would renumber the
  // survivors on every delete, which is the whole failure this avoids.
  const numbered = new Map<string, number>();
  const realByPhase = new Map<string, PhotoLogRow[]>();
  for (const r of rows) {
    if (r.storage_path === null) continue;
    if (!Object.prototype.hasOwnProperty.call(result, r.phase)) continue;
    const bucket = realByPhase.get(r.phase);
    if (bucket) bucket.push(r);
    else realByPhase.set(r.phase, [r]);
  }
  for (const bucket of realByPhase.values()) {
    bucket.sort(byCaptureOrder);
    bucket.forEach((r, i) => numbered.set(r.id, i + 1));
  }

  for (const r of rows) {
    if (r.storage_path === null) continue;
    if (supersededIds.has(r.id)) continue;
    // Deploy-window tolerance (spec 248): a phase value this build does not
    // know yet (the DB enum can grow before the next deploy) is skipped —
    // one unknown row must never TypeError the whole WP's photo read.
    if (!Object.prototype.hasOwnProperty.call(result, r.phase)) continue;
    result[r.phase].push({ ...r, seq: numbered.get(r.id) ?? 0 });
  }
  // The read itself has no `order by`, so sort here: a number that appears in a
  // random grid position is worse than no number at all.
  for (const phase of Object.keys(result) as Array<keyof CurrentPhotosByPhase>) {
    result[phase].sort((a, b) => a.seq - b.seq);
  }
  return result;
}

export async function getCurrentPhotosForWorkPackage(
  supabase: SupabaseClient<Database>,
  workPackageId: string,
): Promise<CurrentPhotosByPhase> {
  const { data, error } = await supabase
    .from("photo_logs")
    .select("*")
    .eq("work_package_id", workPackageId);
  if (error) throw error;
  return selectCurrentPhotosByPhase(data ?? []);
}

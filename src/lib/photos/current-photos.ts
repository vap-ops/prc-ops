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

export interface CurrentPhotosByPhase {
  before: PhotoLogRow[];
  during: PhotoLogRow[];
  after: PhotoLogRow[];
  // Feedback 0fa23307 — rework-completion photos.
  after_fix: PhotoLogRow[];
  // Spec 248 — the PM's defect-report photos (round-stamped, paired by
  // answers_photo_id from after_fix rows).
  defect: PhotoLogRow[];
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
  for (const r of rows) {
    if (r.storage_path === null) continue;
    if (supersededIds.has(r.id)) continue;
    // Deploy-window tolerance (spec 248): a phase value this build does not
    // know yet (the DB enum can grow before the next deploy) is skipped —
    // one unknown row must never TypeError the whole WP's photo read.
    if (!Object.prototype.hasOwnProperty.call(result, r.phase)) continue;
    result[r.phase].push(r);
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

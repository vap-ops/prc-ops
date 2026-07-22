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

// TWO orders, deliberately different — a fresh-eyes pass caught me conflating
// them, and only one of them can be stable.
//
// NUMBERING uses insert order (`created_at`, then `id`). photo_logs is
// append-only, so an id assigned this way is fixed forever. Numbering by capture
// time looked nicer but is NOT stable: the ADR 0039 offline queue can flush a
// backdated photo hours later, and a row inserting ahead of existing ones would
// renumber every photo after it — silently invalidating any number already
// quoted in a screenshot or a message, which is the one property spec 340 sells.
//
// DISPLAY uses capture time (`captured_at_client ?? created_at`), the same clock
// the tile labels, so the grid reads chronologically. The consequence is
// accepted and narrow: after a late offline flush the badges can appear out of
// numeric order. A number that means "this photo" beats a number that means
// "this position".
function byInsertOrder(a: PhotoLogRow, b: PhotoLogRow): number {
  const at = a.created_at ?? "";
  const bt = b.created_at ?? "";
  if (at !== bt) return at < bt ? -1 : 1;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

function byCaptureOrder(a: NumberedPhoto, b: NumberedPhoto): number {
  const ak = a.captured_at_client ?? a.created_at ?? "";
  const bk = b.captured_at_client ?? b.created_at ?? "";
  if (ak !== bk) return ak < bk ? -1 : 1;
  return byInsertOrder(a, b);
}

function emptyByPhase(): CurrentPhotosByPhase {
  return { before: [], during: [], after: [], after_fix: [], defect: [] };
}

// Number over the REAL photos of each phase — including ones later removed —
// so the anti-join can drop the removed ones afterwards without renumbering the
// survivors. Shared by both selectors so a live photo and its own removal trace
// can never disagree about which number it had.
function numberPhotos(rows: ReadonlyArray<PhotoLogRow>): Map<string, number> {
  const known = emptyByPhase();
  const numbered = new Map<string, number>();
  const realByPhase = new Map<string, PhotoLogRow[]>();
  for (const r of rows) {
    if (r.storage_path === null) continue;
    if (!Object.prototype.hasOwnProperty.call(known, r.phase)) continue;
    const bucket = realByPhase.get(r.phase);
    if (bucket) bucket.push(r);
    else realByPhase.set(r.phase, [r]);
  }
  for (const bucket of realByPhase.values()) {
    bucket.sort(byInsertOrder);
    bucket.forEach((r, i) => numbered.set(r.id, i + 1));
  }
  return numbered;
}

/**
 * Spec 341 U1 — one removed photo, as the WP detail reports it.
 *
 * `id`/`seq` are the REMOVED photo's, not the tombstone's: the number is the one
 * the tile showed before it went, so a screenshot taken earlier still matches.
 * `removedBy`/`removedAt` come from the tombstone, which photo_logs' append-only
 * rule guarantees is never rewritten.
 */
export interface RemovedPhoto {
  id: string;
  seq: number;
  removedBy: string | null;
  removedAt: string | null;
}

export type RemovedPhotosByPhase = Record<keyof CurrentPhotosByPhase, RemovedPhoto[]>;

export function selectRemovedPhotosByPhase(rows: ReadonlyArray<PhotoLogRow>): RemovedPhotosByPhase {
  const numbered = numberPhotos(rows);
  const byId = new Map<string, PhotoLogRow>();
  for (const r of rows) byId.set(r.id, r);

  const result: RemovedPhotosByPhase = {
    before: [],
    during: [],
    after: [],
    after_fix: [],
    defect: [],
  };
  // One entry per REMOVED PHOTO, not per tombstone. removePhoto's
  // already-superseded guard is select-then-insert, so two concurrent removes can
  // both land a tombstone on the same target (superseded_by has no unique index);
  // reporting both would double the count and collide the render keys. Earliest
  // tombstone wins — it is the one that actually removed the photo.
  const byTarget = new Map<string, PhotoLogRow>();
  for (const r of rows) {
    // A removal is a tombstone: storage_path null AND superseded_by set (the
    // photo_logs_path_supersede_well_formed CHECK makes the pair inseparable).
    if (r.storage_path !== null || r.superseded_by === null) continue;
    const held = byTarget.get(r.superseded_by);
    if (!held || byInsertOrder(r, held) < 0) byTarget.set(r.superseded_by, r);
  }

  for (const [targetId, tombstone] of byTarget) {
    const target = byId.get(targetId);
    // The TARGET decides the phase — a tombstone copies it at write time and a
    // stale copy must not file the trace under the wrong zone.
    if (!target || !Object.prototype.hasOwnProperty.call(result, target.phase)) continue;
    const seq = numbered.get(targetId);
    // No number means the target is not a real photo of a known phase — a
    // tombstone-of-a-tombstone chain, say. Drop it rather than render "#0",
    // which would also sort to the front of the list.
    if (seq === undefined) continue;
    result[target.phase].push({
      id: target.id,
      seq,
      removedBy: tombstone.uploaded_by,
      removedAt: tombstone.created_at,
    });
  }
  for (const phase of Object.keys(result) as Array<keyof RemovedPhotosByPhase>) {
    result[phase].sort((a, b) => a.seq - b.seq);
  }
  return result;
}

export function selectCurrentPhotosByPhase(rows: ReadonlyArray<PhotoLogRow>): CurrentPhotosByPhase {
  const supersededIds = new Set<string>();
  for (const r of rows) {
    if (r.superseded_by !== null) {
      supersededIds.add(r.superseded_by);
    }
  }

  const result: CurrentPhotosByPhase = emptyByPhase();
  const numbered = numberPhotos(rows);

  for (const r of rows) {
    if (r.storage_path === null) continue;
    if (supersededIds.has(r.id)) continue;
    // Deploy-window tolerance (spec 248): a phase value this build does not
    // know yet (the DB enum can grow before the next deploy) is skipped —
    // one unknown row must never TypeError the whole WP's photo read.
    if (!Object.prototype.hasOwnProperty.call(result, r.phase)) continue;
    result[r.phase].push({ ...r, seq: numbered.get(r.id) ?? 0 });
  }
  // The read itself has no `order by`, so sort here — by CAPTURE time, which is
  // what the tile labels. (Numbering is insert order; see the two-orders note.)
  for (const phase of Object.keys(result) as Array<keyof CurrentPhotosByPhase>) {
    result[phase].sort(byCaptureOrder);
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

/**
 * Spec 341 U1 — the WP detail's photo view: what is there, and what was removed.
 *
 * One read, two derivations. The rows this fetches ALREADY include the
 * tombstones (the filtering is in-memory, per ADR 0015), so the removal trace
 * costs nothing extra — it was being thrown away.
 */
export async function getPhotoViewForWorkPackage(
  supabase: SupabaseClient<Database>,
  workPackageId: string,
): Promise<{ current: CurrentPhotosByPhase; removed: RemovedPhotosByPhase }> {
  const { data, error } = await supabase
    .from("photo_logs")
    .select("*")
    .eq("work_package_id", workPackageId);
  if (error) throw error;
  const rows = data ?? [];
  return {
    current: selectCurrentPhotosByPhase(rows),
    removed: selectRemovedPhotosByPhase(rows),
  };
}

"use server";

// Spec 257 U1 — getSchedulePhotos: the schedule calendar's on-demand photo
// fetch. Signed URLs expire in 120s (mint-thumbnails.ts), so photos are NOT
// baked into the page's initial server load — the client calls this action
// each time the visible date(s) change (day/week nav, view switch). Gated by
// the same SCHEDULE_VIEW_ROLES as the schedule page; re-reads photo_logs
// under the caller's RLS session (ADR 0015 exposure model — the row read is
// the authorization, minting is a trusted relay of what the caller already
// has access to).

import "server-only";

import { requireActionRole } from "@/lib/auth/action-gate";
import { SCHEDULE_VIEW_ROLES } from "@/lib/auth/role-home";
import { UUID_REGEX } from "@/lib/validate/uuid";
import { ISO_DATE_REGEX } from "@/lib/dates";
import { selectDayPhotos } from "@/lib/work-packages/day-photo-selector";
import { mintPhotoThumbnails } from "@/lib/photos/mint-thumbnails";
import { photoBangkokDate } from "@/lib/work-packages/photo-evidence";

const FETCH_FAILED = "โหลดรูปไม่สำเร็จ";
// A day view requests 1 date, a week view 7 — 8 covers both with no slack
// for abuse (each date fans into a full re-scan of the project's photos).
const MAX_DATES = 8;

export interface SchedulePhotoEntry {
  photoId: string;
  workPackageId: string;
  thumbUrl: string;
  fullUrl: string;
}

export type SchedulePhotosResult =
  | { ok: true; days: Record<string, SchedulePhotoEntry[]> }
  | { ok: false; error: string };

export async function getSchedulePhotos(
  projectId: string,
  isoDates: readonly string[],
): Promise<SchedulePhotosResult> {
  const gate = await requireActionRole(SCHEDULE_VIEW_ROLES);
  if ("error" in gate) return { ok: false, error: gate.error };
  if (!UUID_REGEX.test(projectId)) return { ok: false, error: FETCH_FAILED };

  const dates = new Set(isoDates.filter((d) => ISO_DATE_REGEX.test(d)).slice(0, MAX_DATES));
  if (dates.size === 0) return { ok: true, days: {} };

  const { supabase } = gate.auth;
  const { data: wpRows, error: wpError } = await supabase
    .from("work_packages")
    .select("id")
    .eq("project_id", projectId);
  if (wpError) return { ok: false, error: FETCH_FAILED };
  const wpIds = (wpRows ?? []).map((w) => w.id);
  if (wpIds.length === 0) return { ok: true, days: {} };

  const { data: photoRows, error: photoError } = await supabase
    .from("photo_logs")
    .select("id, work_package_id, storage_path, superseded_by, captured_at_client, created_at")
    .in("work_package_id", wpIds);
  if (photoError) return { ok: false, error: FETCH_FAILED };

  const selected = selectDayPhotos(photoRows ?? [], dates);
  const urls = await mintPhotoThumbnails(selected);

  const days: Record<string, SchedulePhotoEntry[]> = {};
  for (const row of selected) {
    const url = urls.get(row.id);
    if (!url) continue;
    const day = photoBangkokDate(row);
    if (day === null) continue;
    (days[day] ??= []).push({
      photoId: row.id,
      workPackageId: row.work_package_id,
      thumbUrl: url.thumbUrl,
      fullUrl: url.fullUrl,
    });
  }
  return { ok: true, days };
}

import "server-only";

// Client WP-detail drill (extends spec 233/234 U4). Reuses the EXISTING
// client read arms — "client reads project work_packages" and "client reads
// approved project photos" (migration 035000) — both already scope by
// project_id via client_has_live_access. No new RLS arm, no migration.
// SAFE COLUMNS ONLY, same backstop as loadClientView: no money column is ever
// selected.

import type { createClient } from "@/lib/db/server";
import { mintSignedUrls } from "@/lib/storage/signed-urls";
import { PHOTOS_BUCKET } from "@/lib/storage/buckets";
import type { PhotoPhase, WorkPackageStatus } from "@/lib/db/enums";

type RlsClient = Awaited<ReturnType<typeof createClient>>;

export interface ClientWpPhotoView {
  id: string;
  phase: PhotoPhase;
  url: string;
  capturedAt: string | null;
}
export interface ClientWpDetailView {
  id: string;
  code: string;
  name: string;
  status: WorkPackageStatus;
  description: string | null;
  plannedStart: string | null;
  plannedEnd: string | null;
  photos: ClientWpPhotoView[];
}

export async function loadClientWpDetail(
  supabase: RlsClient,
  projectId: string,
  wpId: string,
): Promise<ClientWpDetailView | null> {
  // RLS scopes the row to the caller's live-access project; the project_id
  // equality check additionally rejects a WP that's visible (same client's
  // OTHER live project) but doesn't belong to the projectId in the URL.
  const { data: wp } = await supabase
    .from("work_packages")
    .select("id, project_id, code, name, status, description, planned_start, planned_end")
    .eq("id", wpId)
    .maybeSingle();
  if (!wp || wp.project_id !== projectId) return null;

  const { data: photoRows } = await supabase
    .from("photo_logs")
    .select("id, phase, storage_path, captured_at_client, created_at, superseded_by")
    .eq("work_package_id", wpId)
    .order("created_at", { ascending: false });
  const allPhotos = photoRows ?? [];
  const superseded = new Set(
    allPhotos.map((p) => p.superseded_by).filter((x): x is string => x !== null),
  );
  const currentPhotos = allPhotos.filter((p) => !superseded.has(p.id) && p.storage_path !== null);
  const photoUrls = await mintSignedUrls(PHOTOS_BUCKET, currentPhotos);

  return {
    id: wp.id,
    code: wp.code,
    name: wp.name,
    status: wp.status,
    description: wp.description,
    plannedStart: wp.planned_start,
    plannedEnd: wp.planned_end,
    photos: currentPhotos
      .filter((p) => photoUrls.has(p.id))
      .map((p) => ({
        id: p.id,
        phase: p.phase,
        url: photoUrls.get(p.id)!,
        capturedAt: p.captured_at_client ?? p.created_at,
      })),
  };
}

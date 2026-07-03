import "server-only";

// Client WP-detail drill (extends spec 233/234 U4; tier-gated fields added by
// spec 254). Reuses the EXISTING client read arms — "client reads project
// work_packages" and "client reads approved project photos" (migration
// 035000) — both already scope by project_id via client_has_live_access. No
// new RLS arm for the base fields; the full-tier category lookup uses the
// spec-254 project_categories arm. SAFE COLUMNS ONLY, same backstop as
// loadClientView: no money column is ever selected.
//
// work_packages RLS has no column restriction — category_id/priority are
// already selectable by ANY client once the row is visible. RLS is row-level,
// not column-level, so the basic/full tier gate for these two fields is
// enforced HERE (omitted from the returned view model for basic tier), not
// by RLS. Photos need no such gate — the wider photo set for full tier comes
// transparently from the additional RLS arm on photo_logs (spec 254); this
// loader's photo query is unchanged.

import type { createClient } from "@/lib/db/server";
import { mintSignedUrls } from "@/lib/storage/signed-urls";
import { PHOTOS_BUCKET } from "@/lib/storage/buckets";
import type { PhotoPhase, WorkPackagePriority, WorkPackageStatus } from "@/lib/db/enums";

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
  /** Full tier only — undefined (key omitted) for a basic-tier client. */
  categoryName?: string | null;
  /** Full tier only — undefined (key omitted) for a basic-tier client. */
  priority?: WorkPackagePriority;
}

export async function loadClientWpDetail(
  supabase: RlsClient,
  projectId: string,
  wpId: string,
): Promise<ClientWpDetailView | null> {
  const { data: isFullTier } = await supabase.rpc("client_has_full_access", {
    p_project: projectId,
  });

  // RLS scopes the row to the caller's live-access project; the project_id
  // equality check additionally rejects a WP that's visible (same client's
  // OTHER live project) but doesn't belong to the projectId in the URL.
  const { data: wp } = await supabase
    .from("work_packages")
    .select(
      "id, project_id, code, name, status, description, planned_start, planned_end, category_id, priority",
    )
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

  let tierFields: Pick<ClientWpDetailView, "categoryName" | "priority"> = {};
  if (isFullTier) {
    let categoryName: string | null = null;
    if (wp.category_id) {
      const { data: category } = await supabase
        .from("project_categories")
        .select("name")
        .eq("id", wp.category_id)
        .maybeSingle();
      categoryName = category?.name ?? null;
    }
    tierFields = { categoryName, priority: wp.priority };
  }

  return {
    id: wp.id,
    code: wp.code,
    name: wp.name,
    status: wp.status,
    description: wp.description,
    plannedStart: wp.planned_start,
    plannedEnd: wp.planned_end,
    ...tierFields,
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

import "server-only";

// Spec 233 / ADR 0067 U4 — the dedicated, read-only client reader. Every read
// goes through the caller's RLS server client; the client read arms (migration
// 035000) scope the rows to the ONE live-access project. SAFE COLUMNS ONLY — no
// money column is ever selected (projects.budget_amount_thb especially): RLS is
// row-level and the client shares the `authenticated` DB role, so the column
// list is the money backstop, not a column grant.

import type { createClient } from "@/lib/db/server";
import { mintSignedUrls } from "@/lib/storage/signed-urls";
import { PHOTOS_BUCKET, REPORTS_BUCKET } from "@/lib/storage/buckets";
import type { PhotoPhase, ProjectStatus, WorkPackageStatus } from "@/lib/db/enums";

type RlsClient = Awaited<ReturnType<typeof createClient>>;

export interface ClientProjectView {
  id: string;
  code: string;
  name: string;
  status: ProjectStatus;
  siteAddress: string | null;
  startDate: string | null;
  plannedCompletion: string | null;
}
export interface ClientWorkPackageView {
  id: string;
  code: string;
  name: string;
  status: WorkPackageStatus;
}
export interface ClientPhotoView {
  id: string;
  workPackageId: string;
  phase: PhotoPhase;
  url: string;
  capturedAt: string | null;
}
export interface ClientReportView {
  id: string;
  createdAt: string;
  url: string;
}
export interface ClientView {
  project: ClientProjectView;
  workPackages: ClientWorkPackageView[];
  photos: ClientPhotoView[];
  reports: ClientReportView[];
}

export async function loadClientView(
  supabase: RlsClient,
  projectId: string,
): Promise<ClientView | null> {
  // Scope to the chosen project. RLS is still the boundary: a project not in the
  // caller's live set returns 0 rows → null (a forged projectId sees nothing).
  const { data: project } = await supabase
    .from("projects")
    .select("id, code, name, status, site_address, start_date, planned_completion_date")
    .eq("id", projectId)
    .maybeSingle();
  if (!project) return null;

  const { data: wpRows } = await supabase
    .from("work_packages")
    .select("id, code, name, status")
    .eq("project_id", project.id)
    // Spec 270 U5: the client's progress list counts งานย่อย only — งาน rows
    // are grouping entities and would inflate the denominator.
    .eq("is_group", false)
    .order("code", { ascending: true });

  // photo_logs RLS = approved (complete-WP) photos of the live project. Drop
  // superseded rows (ADR 0009 anti-join: a row is current unless a newer row
  // points at it via superseded_by) and tombstones, then mint signed URLs.
  const { data: photoRows } = await supabase
    .from("photo_logs")
    .select(
      "id, work_package_id, phase, storage_path, captured_at_client, created_at, superseded_by",
    )
    .order("created_at", { ascending: false });
  const allPhotos = photoRows ?? [];
  const superseded = new Set(
    allPhotos.map((p) => p.superseded_by).filter((x): x is string => x !== null),
  );
  const currentPhotos = allPhotos.filter((p) => !superseded.has(p.id) && p.storage_path !== null);
  // Scope photos to THIS project's work packages — with N live projects the RLS
  // arm returns approved photos across all of them; the project's WP set is the
  // boundary (photo_logs has no project_id).
  const wpIds = new Set((wpRows ?? []).map((w) => w.id));
  const scopedPhotos = currentPhotos.filter((p) => wpIds.has(p.work_package_id));
  const photoUrls = await mintSignedUrls(PHOTOS_BUCKET, scopedPhotos);

  // reports RLS = completed reports; scope to this project. Mint download URLs.
  const { data: reportRows } = await supabase
    .from("reports")
    .select("id, storage_path, created_at")
    .eq("project_id", projectId)
    .order("created_at", { ascending: false });
  const reportUrls = await mintSignedUrls(REPORTS_BUCKET, reportRows ?? []);

  return {
    project: {
      id: project.id,
      code: project.code,
      name: project.name,
      status: project.status,
      siteAddress: project.site_address,
      startDate: project.start_date,
      plannedCompletion: project.planned_completion_date,
    },
    workPackages: (wpRows ?? []).map((w) => ({
      id: w.id,
      code: w.code,
      name: w.name,
      status: w.status,
    })),
    photos: scopedPhotos
      .filter((p) => photoUrls.has(p.id))
      .map((p) => ({
        id: p.id,
        workPackageId: p.work_package_id,
        phase: p.phase,
        url: photoUrls.get(p.id)!,
        capturedAt: p.captured_at_client ?? p.created_at,
      })),
    reports: (reportRows ?? [])
      .filter((r) => reportUrls.has(r.id))
      .map((r) => ({ id: r.id, createdAt: r.created_at, url: reportUrls.get(r.id)! })),
  };
}

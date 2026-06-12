// Spec 39 / ADR 0040 — the fast-path job runner: in-app port of the
// worker's processJob/markFailed. Caller has already CLAIMED the row via
// claim_next_report() (the shared atomic RPC — app and worker can never
// double-build). Every job error marks the row 'failed' (worker parity);
// a crash that skips even that is freed by the reap_stale_reports cron.
// Reuses the app's tested anti-join helper instead of porting the
// worker's duplicate (recorded spec deviation).

import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Tables } from "@/lib/db/database.types";
import { getCurrentPhotosForWorkPackage } from "@/lib/photos/current-photos";
import { PHOTO_PHASE_LABEL, WORK_PACKAGE_STATUS_LABEL } from "@/lib/i18n/labels";
import { buildReportPdf, type ReportInputWorkPackage, type ReportPhotoGroup } from "./build-pdf";
import { parseReportParams } from "./params";

type ReportRow = Tables<"reports">;

async function downloadPhoto(
  supabase: SupabaseClient<Database>,
  storagePath: string,
): Promise<Buffer> {
  const { data, error } = await supabase.storage.from("photos").download(storagePath);
  if (error) throw new Error(`download photo ${storagePath}: ${error.message}`);
  if (!data) throw new Error(`download photo ${storagePath}: empty response`);
  return Buffer.from(await data.arrayBuffer());
}

async function processJob(supabase: SupabaseClient<Database>, job: ReportRow): Promise<void> {
  // Spec 61: PM-chosen content. Pre-61 rows carry '{}' → legacy report.
  const params = parseReportParams(job.params);

  const { data: project, error: projectErr } = await supabase
    .from("projects")
    .select("id, code, name")
    .eq("id", job.project_id)
    .maybeSingle();
  if (projectErr) throw new Error(`fetch project: ${projectErr.message}`);
  if (!project) throw new Error(`project ${job.project_id} not found`);

  let wpQuery = supabase
    .from("work_packages")
    .select("id, code, name, status")
    .eq("project_id", project.id)
    .order("code");
  if (params.scope === "complete") {
    wpQuery = wpQuery.eq("status", "complete");
  }
  const { data: wps, error: wpsErr } = await wpQuery;
  if (wpsErr) throw new Error(`fetch work packages: ${wpsErr.message}`);

  const sections: ReportInputWorkPackage[] = [];
  for (const wp of wps ?? []) {
    const photoGroups: ReportPhotoGroup[] = [];
    if (params.photos !== "none") {
      const photos = await getCurrentPhotosForWorkPackage(supabase, wp.id);
      const phases =
        params.photos === "after" ? (["after"] as const) : (["before", "during", "after"] as const);
      for (const phase of phases) {
        const buffers: Buffer[] = [];
        for (const photo of photos[phase]) {
          // The helper filters tombstones, but narrow instead of asserting
          // (worker parity; survives a future helper refactor).
          if (photo.storage_path === null) continue;
          buffers.push(await downloadPhoto(supabase, photo.storage_path));
        }
        photoGroups.push({
          // Legacy after-only mode keeps the unlabelled group.
          label: params.photos === "after" ? null : PHOTO_PHASE_LABEL[phase],
          photos: buffers,
        });
      }
    }
    sections.push({
      code: wp.code,
      name: wp.name,
      // Status only matters when mixed statuses can appear (scope=all).
      ...(params.scope === "all"
        ? { statusLabel: WORK_PACKAGE_STATUS_LABEL[wp.status] ?? wp.status }
        : {}),
      photoGroups,
    });
  }

  const pdf = await buildReportPdf({
    project: { code: project.code, name: project.name, generatedAt: new Date() },
    workPackages: sections,
    includeEmptyWorkPackages: params.photos === "none",
  });

  const storagePath = `${project.id}/${job.id}.pdf`;
  const { error: uploadErr } = await supabase.storage.from("reports").upload(storagePath, pdf, {
    contentType: "application/pdf",
    upsert: true,
  });
  if (uploadErr) throw new Error(`upload PDF: ${uploadErr.message}`);

  const { error: completeErr } = await supabase
    .from("reports")
    .update({ status: "complete", storage_path: storagePath, error: null })
    .eq("id", job.id);
  if (completeErr) throw new Error(`mark complete: ${completeErr.message}`);
}

async function markFailed(
  supabase: SupabaseClient<Database>,
  jobId: string,
  message: string,
): Promise<void> {
  const trimmed = message.length > 1000 ? `${message.slice(0, 1000)}…` : message;
  const { error } = await supabase
    .from("reports")
    .update({ status: "failed", error: trimmed })
    .eq("id", jobId);
  if (error) {
    // Nothing left to do in-process — the reaper frees the row.
    console.error(`[run-report-job] mark failed errored for ${jobId}: ${error.message}`);
  }
}

// Runs ONE already-claimed job to completion. Never throws: failure is
// recorded on the row (worker parity) and surfaced as ok:false.
export async function runReportJob(
  supabase: SupabaseClient<Database>,
  job: ReportRow,
): Promise<{ ok: boolean }> {
  try {
    await processJob(supabase, job);
    return { ok: true };
  } catch (e) {
    // Worker parity: full stack to the server log; trimmed message to the row.
    console.error(
      `[run-report-job] job ${job.id} failed:`,
      e instanceof Error ? (e.stack ?? e.message) : String(e),
    );
    await markFailed(supabase, job.id, e instanceof Error ? e.message : String(e));
    return { ok: false };
  }
}

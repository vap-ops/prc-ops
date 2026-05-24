// PDF report worker — run-once-and-exit entry point.
//
// Flow:
//   1. Build a service-role Supabase client (bypasses RLS by design).
//   2. Loop: call public.claim_next_report() to atomically flip exactly
//      one reports row from 'requested' → 'processing' (FOR UPDATE SKIP
//      LOCKED inside the function so concurrent workers can't double-
//      claim).
//   3. For each claimed job: fetch the project, its complete work
//      packages, the current After photos per WP (ADR 0009 anti-join
//      plus the ADR 0015 storage_path-not-null tombstone filter,
//      filtered to phase='after'), download each photo from the
//      'photos' bucket, build the PDF, upload it to the 'reports'
//      bucket at `{project_id}/{report_id}.pdf`, and mark the row
//      'complete' with the storage_path.
//   4. On ANY error during a job, mark it 'failed' with a short error
//      message and continue with the next job — one bad job must not
//      kill the batch.
//   5. When claim_next_report() returns no row, log and exit 0.
//
// Cron-friendly shape: this entry point processes one batch of pending
// jobs and exits. Railway will invoke it on a cron schedule. If we ever
// want always-on, that's a trivial wrapper around this function.

import { createServiceRoleClient } from "./supabase.js";
import { buildReportPdf, type ReportInputWorkPackage } from "./report.js";
import type { Database, Tables } from "./database.types.js";
import type { SupabaseClient } from "@supabase/supabase-js";

type ReportRow = Tables<"reports">;
type PhotoLogRow = Tables<"photo_logs">;

// Same anti-join + tombstone filter as src/lib/photos/current-photos.ts —
// duplicated here because /worker cannot import from the app's src/ tree
// (Railway's Root Directory will be /worker, and files outside it won't be
// in the deploy).
function selectCurrentAfterPhotos(rows: ReadonlyArray<PhotoLogRow>): PhotoLogRow[] {
  const supersededIds = new Set<string>();
  for (const r of rows) {
    if (r.superseded_by !== null) supersededIds.add(r.superseded_by);
  }
  const out: PhotoLogRow[] = [];
  for (const r of rows) {
    if (r.phase !== "after") continue;
    if (r.storage_path === null) continue; // tombstone
    if (supersededIds.has(r.id)) continue; // superseded
    out.push(r);
  }
  return out;
}

async function downloadPhoto(
  supabase: SupabaseClient<Database>,
  storagePath: string,
): Promise<Buffer> {
  const { data, error } = await supabase.storage.from("photos").download(storagePath);
  if (error) {
    throw new Error(`download photo ${storagePath}: ${error.message}`);
  }
  if (!data) {
    throw new Error(`download photo ${storagePath}: empty response`);
  }
  const arrayBuffer = await data.arrayBuffer();
  return Buffer.from(arrayBuffer);
}

async function processJob(
  supabase: SupabaseClient<Database>,
  job: ReportRow,
): Promise<void> {
  // 1. Fetch project.
  const { data: project, error: projectErr } = await supabase
    .from("projects")
    .select("id, code, name")
    .eq("id", job.project_id)
    .maybeSingle();
  if (projectErr) throw new Error(`fetch project: ${projectErr.message}`);
  if (!project) throw new Error(`project ${job.project_id} not found`);

  // 2. Fetch the project's complete work packages (only complete WPs feed
  //    the v1 report — incomplete work isn't deliverable yet).
  const { data: wps, error: wpsErr } = await supabase
    .from("work_packages")
    .select("id, code, name")
    .eq("project_id", project.id)
    .eq("status", "complete")
    .order("code");
  if (wpsErr) throw new Error(`fetch work_packages: ${wpsErr.message}`);

  // 3. For each WP, fetch every photo_logs row, filter to current After
  //    photos in JS (the anti-join is awkward through PostgREST; same
  //    approach as src/lib/photos/current-photos.ts), download each
  //    photo's bytes from Storage, and assemble the report-input WP.
  //    WPs with zero current After photos are skipped both here (so we
  //    don't waste downloads) and again in buildReportPdf (defensive).
  const reportWps: ReportInputWorkPackage[] = [];
  for (const wp of wps ?? []) {
    const { data: photoRows, error: photoErr } = await supabase
      .from("photo_logs")
      .select("*")
      .eq("work_package_id", wp.id);
    if (photoErr) throw new Error(`fetch photo_logs for WP ${wp.id}: ${photoErr.message}`);

    const currentAfter = selectCurrentAfterPhotos(photoRows ?? []);
    if (currentAfter.length === 0) continue;

    const buffers: Buffer[] = [];
    for (const photo of currentAfter) {
      // storage_path non-null is guaranteed by selectCurrentAfterPhotos's
      // tombstone filter, but TypeScript needs the narrowing.
      if (photo.storage_path === null) continue;
      buffers.push(await downloadPhoto(supabase, photo.storage_path));
    }
    reportWps.push({ code: wp.code, name: wp.name, afterPhotos: buffers });
  }

  // 4. Build the PDF.
  const pdf = await buildReportPdf({
    project: {
      code: project.code,
      name: project.name,
      generatedAt: new Date(),
    },
    workPackages: reportWps,
  });

  // 5. Upload to the 'reports' bucket.
  const storagePath = `${project.id}/${job.id}.pdf`;
  const { error: uploadErr } = await supabase.storage
    .from("reports")
    .upload(storagePath, pdf, {
      contentType: "application/pdf",
      upsert: true,
    });
  if (uploadErr) throw new Error(`upload PDF: ${uploadErr.message}`);

  // 6. Mark the job complete with the storage_path.
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
  // Truncate so a multi-paragraph stack trace doesn't blow out the column —
  // the error column exists for operator triage, not full debug logs.
  const trimmed = message.length > 1000 ? `${message.slice(0, 1000)}…` : message;
  const { error: markErr } = await supabase
    .from("reports")
    .update({ status: "failed", error: trimmed })
    .eq("id", jobId);
  if (markErr) {
    console.error(`failed to mark job ${jobId} as failed: ${markErr.message}`);
  }
}

export async function run(): Promise<void> {
  const supabase = createServiceRoleClient();
  let processed = 0;

  for (;;) {
    const { data: claimed, error: claimErr } = await supabase.rpc("claim_next_report");
    if (claimErr) {
      console.error(`claim_next_report rpc failed: ${claimErr.message}`);
      process.exit(1);
    }
    // The RPC returns SETOF reports — supabase-js gives us an array (may
    // be empty when no job is available). The function only ever claims
    // one row at a time, so we look at the first.
    const job = Array.isArray(claimed) ? claimed[0] : null;
    if (!job) {
      if (processed === 0) {
        console.log("No jobs to process. Exiting.");
      } else {
        console.log(`Processed ${processed} job(s). Exiting.`);
      }
      return;
    }

    console.log(`Processing job ${job.id} for project ${job.project_id}…`);
    try {
      await processJob(supabase, job);
      console.log(`Job ${job.id} complete.`);
    } catch (e) {
      const msg = e instanceof Error ? (e.stack ?? e.message) : String(e);
      console.error(`Job ${job.id} failed: ${msg}`);
      await markFailed(supabase, job.id, e instanceof Error ? e.message : String(e));
    }
    processed++;
  }
}

run().catch((e: unknown) => {
  console.error(e instanceof Error ? (e.stack ?? e.message) : String(e));
  process.exit(1);
});

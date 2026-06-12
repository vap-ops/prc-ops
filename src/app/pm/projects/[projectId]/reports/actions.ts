"use server";

// Server actions for the PM report UI:
//
//   generateReport({ projectId }) — PM/super requests a new PDF report.
//     Validates role + project visibility + the duplicate guard (no
//     in-flight report exists for this project), then INSERTs a
//     reports row under the user's session (RLS gates the insert to
//     PM + super_admin; column defaults supply status='requested',
//     storage_path NULL, error NULL). On success, revalidates the
//     reports page so the new row appears on the next render.
//
//   getReportDownloadUrl({ reportId }) — mints a short-TTL signed URL
//     against the private `reports` Storage bucket. Caller role-gated;
//     report must be readable under the user's RLS and at status
//     'complete' with a storage_path. The signed URL is minted via the
//     admin client (mirrors src/lib/photos/signed-urls.ts) — the
//     reports bucket has no authenticated RLS on storage.objects by
//     design, so all reads flow through service-role-minted URLs. The
//     admin client itself never reaches the browser bundle.

import "server-only";

import { revalidatePath } from "next/cache";
import { createClient as createAdminClient } from "@/lib/db/admin";
import { createClient as createServerSupabase } from "@/lib/db/server";
import { canGenerateReport, type ReportStatus } from "@/lib/reports/predicates";
import { runReportJob } from "@/lib/reports/run-report-job";
import type { UserRole } from "@/lib/auth/role-home";

const PM_ROLES: ReadonlyArray<UserRole> = ["project_manager", "super_admin"];

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function isValidUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_REGEX.test(value);
}

const REPORTS_BUCKET = "reports";

// 120 seconds: same TTL as the photo helper (signed-urls.ts). Long enough
// for the browser to start the download after the user clicks; short
// enough that a leaked URL has very little value.
const SIGNED_URL_TTL_SECONDS = 120;

export interface GenerateReportInput {
  projectId: string;
}

export type GenerateReportResult = { ok: true } | { ok: false; reason: string };

export async function generateReport(input: GenerateReportInput): Promise<GenerateReportResult> {
  if (!isValidUuid(input.projectId)) {
    return { ok: false, reason: "รหัสโครงการไม่ถูกต้อง" };
  }

  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, reason: "ยังไม่ได้เข้าสู่ระบบ" };

  // Explicit role check before any DB write so the error surface is
  // clean. RLS on reports INSERT is the load-bearing backstop — a
  // site_admin's session would be refused there too, with a less
  // useful error.
  const { data: userRow } = await supabase
    .from("users")
    .select("role")
    .eq("id", user.id)
    .maybeSingle();
  if (!userRow || !(PM_ROLES as readonly string[]).includes(userRow.role)) {
    return { ok: false, reason: "เฉพาะผู้จัดการโครงการเท่านั้นที่สร้างรายงานได้" };
  }

  // Verify the project exists and is visible under the user's RLS.
  // Same shape as the WP fetch in recordDecision (work-packages actions).
  const { data: project } = await supabase
    .from("projects")
    .select("id")
    .eq("id", input.projectId)
    .maybeSingle();
  if (!project) return { ok: false, reason: "ไม่พบโครงการ" };

  // Duplicate guard: fetch the project's reports (RLS-scoped, but that
  // matches the visibility we're guarding) and apply the pure
  // predicate. The "any in-flight report blocks generation" rule is in
  // src/lib/reports/predicates.ts; this action just supplies the data.
  const { data: existing } = await supabase
    .from("reports")
    .select("status")
    .eq("project_id", project.id);
  const statuses: ReportStatus[] = (existing ?? []).map((r) => r.status);
  if (!canGenerateReport(statuses)) {
    return {
      ok: false,
      reason: "มีรายงานของโครงการนี้กำลังสร้างอยู่แล้ว",
    };
  }

  // INSERT under the user's session. column defaults supply
  // status='requested', storage_path NULL, error NULL. requested_by
  // is the authenticated user (the RLS WITH CHECK already gates this,
  // but pinning it here makes the audit trail trivially readable).
  const { error: insertError } = await supabase.from("reports").insert({
    project_id: project.id,
    requested_by: user.id,
  });
  if (insertError) {
    return { ok: false, reason: "ส่งรายงานเข้าคิวไม่สำเร็จ กรุณาลองใหม่อีกครั้ง" };
  }

  // Spec 39 / ADR 0040 — on-demand fast path. claim_next_report() is the
  // same atomic RPC the Railway worker polls (FIFO + SKIP LOCKED), so the
  // two can never double-build. Every failure mode degrades safely:
  // claim fails/races → the row stays 'requested' for the cron sweeper;
  // the job errors → runReportJob marks it 'failed' (worker parity);
  // a hard crash mid-processing → reap_stale_reports frees it.
  try {
    const admin = createAdminClient();
    const { data: claimed, error: claimErr } = await admin.rpc("claim_next_report");
    if (claimErr) {
      console.error("[generateReport] fast-path claim failed (sweeper will run)", claimErr.message);
    } else {
      const job = Array.isArray(claimed) ? claimed[0] : null;
      if (job) await runReportJob(admin, job);
    }
  } catch (e) {
    console.error("[generateReport] fast path errored (sweeper/reaper will recover)", e);
  }

  revalidatePath(`/pm/projects/${project.id}/reports`);
  return { ok: true };
}

export interface GetReportDownloadUrlInput {
  reportId: string;
}

export type GetReportDownloadUrlResult = { ok: true; url: string } | { ok: false; reason: string };

export async function getReportDownloadUrl(
  input: GetReportDownloadUrlInput,
): Promise<GetReportDownloadUrlResult> {
  if (!isValidUuid(input.reportId)) {
    return { ok: false, reason: "รหัสรายงานไม่ถูกต้อง" };
  }

  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, reason: "ยังไม่ได้เข้าสู่ระบบ" };

  const { data: userRow } = await supabase
    .from("users")
    .select("role")
    .eq("id", user.id)
    .maybeSingle();
  if (!userRow || !(PM_ROLES as readonly string[]).includes(userRow.role)) {
    return { ok: false, reason: "เฉพาะผู้จัดการโครงการเท่านั้นที่ดาวน์โหลดรายงานได้" };
  }

  // Read the report under the user's RLS. The reports SELECT policy
  // already restricts visibility to PM + super_admin; this fetch is
  // both an authorisation check (the row is invisible to anyone
  // outside the SELECT policy) and a state check (the file only
  // exists once status flipped to complete).
  const { data: report } = await supabase
    .from("reports")
    .select("status, storage_path")
    .eq("id", input.reportId)
    .maybeSingle();
  if (!report) return { ok: false, reason: "ไม่พบรายงาน" };
  if (report.status !== "complete" || !report.storage_path) {
    return { ok: false, reason: "รายงานยังไม่พร้อมดาวน์โหลด" };
  }

  // Mint the signed URL via the admin client. The reports bucket has
  // no authenticated SELECT policy by design (see the bucket
  // migration); all reads must go through service-role-minted URLs.
  // The admin client lives behind `server-only`; this action runs
  // server-side and only the resulting URL string crosses to the
  // browser.
  const admin = createAdminClient();
  const { data: signed, error: signedError } = await admin.storage
    .from(REPORTS_BUCKET)
    .createSignedUrl(report.storage_path, SIGNED_URL_TTL_SECONDS);
  if (signedError || !signed?.signedUrl) {
    return { ok: false, reason: "สร้างลิงก์ดาวน์โหลดไม่สำเร็จ กรุณาลองใหม่อีกครั้ง" };
  }

  return { ok: true, url: signed.signedUrl };
}

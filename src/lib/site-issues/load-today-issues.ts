import "server-only";

// Spec 277 P1a — the ปัญหาวันนี้ read for the SA home. Returns today's site issues
// (Bangkok day) across the caller's visible projects — RLS (can_see_project) already
// scopes the rows — each with signed thumbnail URLs for its photos. The section
// renders nothing when this is empty.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/db/database.types";
import type { SiteIssueType, SiteIssueStatus } from "@/lib/site-issues/identity";
import { SITE_ISSUES_BUCKET } from "@/lib/storage/buckets";
import { mintSignedUrls } from "@/lib/storage/signed-urls";

export interface TodayIssueView {
  id: string;
  issueType: SiteIssueType;
  status: SiteIssueStatus;
  note: string | null;
  projectName: string | null;
  thumbnailUrls: string[];
}

export async function loadTodayIssues(
  supabase: SupabaseClient<Database>,
  opts: { todayIso: string; projectNameById: Map<string, string> },
): Promise<TodayIssueView[]> {
  // Bangkok midnight expressed with an explicit +07:00 offset so the timestamptz
  // comparison catches the whole local day (a bare date would use UTC midnight).
  const dayStart = `${opts.todayIso}T00:00:00+07:00`;

  const { data: issueRows } = await supabase
    .from("site_issues")
    .select("id, project_id, issue_type, status, note, created_at")
    .gte("created_at", dayStart)
    .order("created_at", { ascending: false });
  const issues = issueRows ?? [];
  if (issues.length === 0) return [];

  const { data: attRows } = await supabase
    .from("site_issue_attachments")
    .select("id, site_issue_id, storage_path")
    .in(
      "site_issue_id",
      issues.map((i) => i.id),
    )
    .order("created_at", { ascending: true });
  const attachments = attRows ?? [];

  const signed = await mintSignedUrls(SITE_ISSUES_BUCKET, attachments);
  const thumbsByIssue = new Map<string, string[]>();
  for (const a of attachments) {
    const url = signed.get(a.id);
    if (!url) continue;
    const arr = thumbsByIssue.get(a.site_issue_id) ?? [];
    arr.push(url);
    thumbsByIssue.set(a.site_issue_id, arr);
  }

  return issues.map((i) => ({
    id: i.id,
    issueType: i.issue_type,
    status: i.status,
    note: i.note,
    projectName: opts.projectNameById.get(i.project_id) ?? null,
    thumbnailUrls: thumbsByIssue.get(i.id) ?? [],
  }));
}

"use server";

// Spec 277 P1a — the แจ้งปัญหา write path. Two-phase like the feedback flow:
// reportSiteIssue creates the issue (returns its id), then addSiteIssueAttachment
// records each uploaded photo. Both call the DEFINER RPCs under the user's
// RLS-scoped session (the RPC enforces role + project membership). Mirrors
// reportDefect (work-package actions).

import { revalidatePath } from "next/cache";
import { getActionUser, NOT_SIGNED_IN } from "@/lib/auth/action-gate";
import { isValidUuid } from "@/lib/validate/uuid";
import { SITE_ISSUE_TYPES, type SiteIssueType } from "@/lib/site-issues/identity";

export interface ReportSiteIssueInput {
  projectId: string;
  workPackageId?: string | null;
  issueType: SiteIssueType;
  note?: string | null;
}
export type ReportSiteIssueResult = { ok: true; issueId: string } | { ok: false; error: string };

const NOT_MEMBER = "คุณไม่มีสิทธิ์แจ้งปัญหาในโครงการนี้ (ต้องเป็นทีมงานของโครงการ)";
const GENERIC_FAIL = "แจ้งปัญหาไม่สำเร็จ กรุณาลองใหม่อีกครั้ง";

export async function reportSiteIssue(input: ReportSiteIssueInput): Promise<ReportSiteIssueResult> {
  if (!isValidUuid(input.projectId)) return { ok: false, error: "รหัสโครงการไม่ถูกต้อง" };
  if (input.workPackageId != null && !isValidUuid(input.workPackageId)) {
    return { ok: false, error: "รหัสงานไม่ถูกต้อง" };
  }
  if (!(SITE_ISSUE_TYPES as readonly string[]).includes(input.issueType)) {
    return { ok: false, error: "กรุณาเลือกประเภทปัญหา" };
  }
  const note = (input.note ?? "").trim();
  if (note.length > 1000) return { ok: false, error: "รายละเอียดต้องไม่เกิน 1000 ตัวอักษร" };

  const auth = await getActionUser();
  if (!auth) return { ok: false, error: NOT_SIGNED_IN };
  const { supabase } = auth;

  const { data, error } = await supabase.rpc("report_site_issue", {
    p_project_id: input.projectId,
    p_issue_type: input.issueType,
    ...(input.workPackageId ? { p_work_package_id: input.workPackageId } : {}),
    ...(note ? { p_note: note } : {}),
  });
  if (error) {
    console.error("[reportSiteIssue] RPC failed", {
      project: input.projectId,
      error: error.message,
    });
    if (error.code === "42501") return { ok: false, error: NOT_MEMBER };
    return { ok: false, error: GENERIC_FAIL };
  }
  if (typeof data !== "string") return { ok: false, error: GENERIC_FAIL };

  revalidatePath("/sa");
  return { ok: true, issueId: data };
}

export interface AddSiteIssueAttachmentInput {
  siteIssueId: string;
  storagePath: string;
}
export type AddSiteIssueAttachmentResult = { ok: true } | { ok: false; error: string };

export async function addSiteIssueAttachment(
  input: AddSiteIssueAttachmentInput,
): Promise<AddSiteIssueAttachmentResult> {
  if (!isValidUuid(input.siteIssueId)) return { ok: false, error: "รหัสปัญหาไม่ถูกต้อง" };
  if (input.storagePath.trim() === "") return { ok: false, error: "ไม่พบไฟล์รูป" };

  const auth = await getActionUser();
  if (!auth) return { ok: false, error: NOT_SIGNED_IN };
  const { supabase } = auth;

  const { error } = await supabase.rpc("add_site_issue_attachment", {
    p_site_issue_id: input.siteIssueId,
    p_storage_path: input.storagePath,
  });
  if (error) {
    console.error("[addSiteIssueAttachment] RPC failed", {
      issue: input.siteIssueId,
      error: error.message,
    });
    if (error.code === "42501") return { ok: false, error: "ไม่สามารถแนบรูปกับปัญหานี้ได้" };
    return { ok: false, error: "แนบรูปไม่สำเร็จ" };
  }
  return { ok: true };
}

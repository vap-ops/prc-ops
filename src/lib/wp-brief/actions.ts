"use server";

// Spec 377 U2b — WP brief authoring server actions: thin wrappers over the
// U2a RPCs (mig 20260813075876+075879). Gate = requireActionRole(PM_ROLES)
// client-side (spec-204 pattern, mirrors company-docs/actions.ts) — defense
// in depth alongside the DB's own is_manager() gate; the RPCs are the real
// security boundary, this only maps their error codes to Thai and revalidates
// the editor route.
//
// save_wp_brief_draft is FULL REPLACE (spec-331 convention) — the caller
// MUST round-trip display_config unchanged (fresh-eyes catch: a hardcoded
// null on every save would silently wipe a value a clone brought over, or a
// later U4 control set). No UI writes display_config yet (the vocabulary is
// undecided — spec 377 §4.4/§7 item 2); this action only threads it through.

import "server-only";

import { revalidatePath } from "next/cache";
import { requireActionRole } from "@/lib/auth/action-gate";
import { PM_ROLES } from "@/lib/auth/role-home";
import { UUID_REGEX } from "@/lib/validate/uuid";
import { workPackageHref } from "@/lib/nav/project-paths";
import type { Json } from "@/lib/db/database.types";

const FAILED = "บันทึกข้อมูลงานไม่สำเร็จ กรุณาลองใหม่อีกครั้ง";
const NO_PERMISSION = "ไม่มีสิทธิ์ (เฉพาะผู้จัดการโครงการ)";
const NOT_FOUND = "ไม่พบรายการ (อาจถูกลบไปแล้ว)";
const INVALID = "ข้อมูลไม่ถูกต้อง";
const NO_DRAFT = "ยังไม่มีร่างข้อมูลงานให้เผยแพร่";

export type BriefActionResult = { ok: true } | { ok: false; error: string };
export type BriefCreateResult = { ok: true; id: string } | { ok: false; error: string };
export type PublishResult = { ok: true; versionId: string } | { ok: false; error: string };

const briefHref = (projectId: string, workPackageId: string) =>
  `${workPackageHref(projectId, workPackageId)}/brief`;

function mapDraftError(code: string | undefined): string {
  if (code === "42501") return NO_PERMISSION;
  if (code === "23514") return "ข้อมูลไม่ถูกต้อง (งานนี้เป็นงานกลุ่ม หรือข้อความยาวเกินไป)";
  return FAILED;
}

function mapChildError(code: string | undefined): string {
  if (code === "42501") return NOT_FOUND; // the RPC collapses "not found" and "not a member" — never leak which
  if (code === "23514") return INVALID;
  if (code === "22023") return INVALID; // e.g. a null sort_order on update
  return FAILED;
}

export async function saveWpBriefDraft(input: {
  projectId: string;
  workPackageId: string;
  scopeIncluded: string | null;
  scopeExcluded: string | null;
  quantity: string | null;
  location: string | null;
  sheetCode: string | null;
  sheetRev: string | null;
  /** Round-tripped unchanged — no UI sets this yet; NEVER hardcode null here. */
  displayConfig: Json;
}): Promise<BriefActionResult> {
  if (!UUID_REGEX.test(input.workPackageId)) return { ok: false, error: FAILED };

  const gate = await requireActionRole(PM_ROLES);
  if ("error" in gate) return { ok: false, error: gate.error };

  // typegen types every nullable text arg as non-null `string` (a known
  // generator gap for non-default params — set_work_package_notes's own
  // caller hits the same thing); the RPC's columns genuinely accept null.
  const { error } = await gate.auth.supabase.rpc("save_wp_brief_draft", {
    p_work_package_id: input.workPackageId,
    p_scope_included: input.scopeIncluded as string,
    p_scope_excluded: input.scopeExcluded as string,
    p_quantity: input.quantity as string,
    p_location: input.location as string,
    p_sheet_code: input.sheetCode as string,
    p_sheet_rev: input.sheetRev as string,
    p_display_config: input.displayConfig,
  });
  if (error) return { ok: false, error: mapDraftError(error.code) };

  revalidatePath(briefHref(input.projectId, input.workPackageId));
  return { ok: true };
}

export async function addWpBriefCriterion(input: {
  projectId: string;
  workPackageId: string;
  briefId: string;
  body: string;
}): Promise<BriefCreateResult> {
  if (!UUID_REGEX.test(input.briefId)) return { ok: false, error: FAILED };

  const gate = await requireActionRole(PM_ROLES);
  if ("error" in gate) return { ok: false, error: gate.error };

  // p_sort_order has a SQL default (auto-append) — the key is OMITTED, not
  // set to undefined (exactOptionalPropertyTypes distinguishes the two), so
  // Postgres's default actually fires.
  const { data, error } = await gate.auth.supabase.rpc("add_wp_brief_criterion", {
    p_brief_id: input.briefId,
    p_body: input.body,
  });
  if (error) return { ok: false, error: mapChildError(error.code) };

  revalidatePath(briefHref(input.projectId, input.workPackageId));
  return { ok: true, id: data as string };
}

export async function updateWpBriefCriterion(input: {
  projectId: string;
  workPackageId: string;
  criterionId: string;
  body: string;
  sortOrder: number;
}): Promise<BriefActionResult> {
  if (!UUID_REGEX.test(input.criterionId)) return { ok: false, error: FAILED };

  const gate = await requireActionRole(PM_ROLES);
  if ("error" in gate) return { ok: false, error: gate.error };

  const { error } = await gate.auth.supabase.rpc("update_wp_brief_criterion", {
    p_id: input.criterionId,
    p_body: input.body,
    p_sort_order: input.sortOrder,
  });
  if (error) return { ok: false, error: mapChildError(error.code) };

  revalidatePath(briefHref(input.projectId, input.workPackageId));
  return { ok: true };
}

export async function deleteWpBriefCriterion(input: {
  projectId: string;
  workPackageId: string;
  criterionId: string;
}): Promise<BriefActionResult> {
  if (!UUID_REGEX.test(input.criterionId)) return { ok: false, error: FAILED };

  const gate = await requireActionRole(PM_ROLES);
  if ("error" in gate) return { ok: false, error: gate.error };

  const { error } = await gate.auth.supabase.rpc("delete_wp_brief_criterion", {
    p_id: input.criterionId,
  });
  if (error) return { ok: false, error: mapChildError(error.code) };

  revalidatePath(briefHref(input.projectId, input.workPackageId));
  return { ok: true };
}

export async function addWpBriefEvidenceSlot(input: {
  projectId: string;
  workPackageId: string;
  briefId: string;
  label: string;
  criterionId: string | null;
}): Promise<BriefCreateResult> {
  if (!UUID_REGEX.test(input.briefId)) return { ok: false, error: FAILED };

  const gate = await requireActionRole(PM_ROLES);
  if ("error" in gate) return { ok: false, error: gate.error };

  const { data, error } = await gate.auth.supabase.rpc("add_wp_brief_evidence_slot", {
    p_brief_id: input.briefId,
    p_label: input.label,
    p_criterion_id: input.criterionId as string,
  });
  if (error) return { ok: false, error: mapChildError(error.code) };

  revalidatePath(briefHref(input.projectId, input.workPackageId));
  return { ok: true, id: data as string };
}

export async function updateWpBriefEvidenceSlot(input: {
  projectId: string;
  workPackageId: string;
  slotId: string;
  label: string;
  criterionId: string | null;
  sortOrder: number;
}): Promise<BriefActionResult> {
  if (!UUID_REGEX.test(input.slotId)) return { ok: false, error: FAILED };

  const gate = await requireActionRole(PM_ROLES);
  if ("error" in gate) return { ok: false, error: gate.error };

  const { error } = await gate.auth.supabase.rpc("update_wp_brief_evidence_slot", {
    p_id: input.slotId,
    p_label: input.label,
    p_criterion_id: input.criterionId as string,
    p_sort_order: input.sortOrder,
  });
  if (error) return { ok: false, error: mapChildError(error.code) };

  revalidatePath(briefHref(input.projectId, input.workPackageId));
  return { ok: true };
}

export async function deleteWpBriefEvidenceSlot(input: {
  projectId: string;
  workPackageId: string;
  slotId: string;
}): Promise<BriefActionResult> {
  if (!UUID_REGEX.test(input.slotId)) return { ok: false, error: FAILED };

  const gate = await requireActionRole(PM_ROLES);
  if ("error" in gate) return { ok: false, error: gate.error };

  const { error } = await gate.auth.supabase.rpc("delete_wp_brief_evidence_slot", {
    p_id: input.slotId,
  });
  if (error) return { ok: false, error: mapChildError(error.code) };

  revalidatePath(briefHref(input.projectId, input.workPackageId));
  return { ok: true };
}

export async function publishWpBrief(input: {
  projectId: string;
  workPackageId: string;
}): Promise<PublishResult> {
  if (!UUID_REGEX.test(input.workPackageId)) return { ok: false, error: FAILED };

  const gate = await requireActionRole(PM_ROLES);
  if ("error" in gate) return { ok: false, error: gate.error };

  const { data, error } = await gate.auth.supabase.rpc("publish_wp_brief", {
    p_work_package_id: input.workPackageId,
  });
  if (error) {
    if (error.code === "42501") return { ok: false, error: NO_PERMISSION };
    if (error.code === "22023") return { ok: false, error: NO_DRAFT };
    return { ok: false, error: FAILED };
  }

  revalidatePath(briefHref(input.projectId, input.workPackageId));
  return { ok: true, versionId: data as string };
}

"use server";

// recordDecision: the PM approval write path.
//
// Validates the caller role, the decision, the comment-required rule,
// and that the WP is currently up for review (status = pending_approval).
// Inserts the approvals row under the user's session — the photo_logs /
// approvals split puts INSERT on approvals at PM + super_admin, so RLS
// is the load-bearing authorisation primitive for the write. After a
// successful approved decision, runs the option-(a) guarded transition
// (mirrors addPhoto): a single admin-client UPDATE of work_packages
// flipping the WP to 'complete', narrow to status only, only from
// pending_approval. rejected / needs_revision never change status.

import "server-only";

import { revalidatePath } from "next/cache";
import { createClient as createAdminClient } from "@/lib/db/admin";
import { workPackageHref } from "@/lib/nav/project-paths";
import {
  APPROVAL_DECISIONS,
  isCommentValid,
  shouldTransitionToComplete,
  type ApprovalDecision,
} from "@/lib/approvals/predicates";
import { getCurrentPhotosForWorkPackage } from "@/lib/photos/current-photos";
import {
  canHold,
  canRelease,
  deriveReleaseStatus,
  HOLDABLE_FROM_STATUSES,
} from "@/lib/work-packages/hold";
import { getActionUser, NOT_SIGNED_IN } from "@/lib/auth/action-gate";
import { PM_ROLES } from "@/lib/auth/role-home";
import { isValidUuid } from "@/lib/validate/uuid";

function isValidDecision(value: unknown): value is ApprovalDecision {
  return typeof value === "string" && (APPROVAL_DECISIONS as readonly string[]).includes(value);
}

export interface RecordDecisionInput {
  workPackageId: string;
  decision: ApprovalDecision;
  comment?: string | null;
}

export type RecordDecisionResult =
  | { ok: true; transitioned: boolean }
  | { ok: false; error: string };

export async function recordDecision(input: RecordDecisionInput): Promise<RecordDecisionResult> {
  if (!isValidUuid(input.workPackageId)) return { ok: false, error: "รหัสรายการงานไม่ถูกต้อง" };
  if (!isValidDecision(input.decision)) return { ok: false, error: "ผลการตรวจไม่ถูกต้อง" };

  const comment = input.comment ?? null;
  if (!isCommentValid(input.decision, comment)) {
    return { ok: false, error: "ผลการตรวจนี้ต้องใส่ความเห็น" };
  }

  const auth = await getActionUser();
  if (!auth) return { ok: false, error: NOT_SIGNED_IN };
  const { supabase, user } = auth;

  // Explicit role check so the error surface is clean. RLS on
  // approvals INSERT is the load-bearing backstop — site_admin's
  // session would be refused there too, with a less useful error.
  const { data: userRow } = await supabase
    .from("users")
    .select("role")
    .eq("id", user.id)
    .maybeSingle();
  if (!userRow || !PM_ROLES.includes(userRow.role)) {
    return { ok: false, error: "เฉพาะผู้จัดการโครงการเท่านั้นที่บันทึกผลการตรวจได้" };
  }

  // Verify the WP exists under the caller's RLS and is at
  // pending_approval. Recording a decision on a WP that isn't up for
  // review is refused — keeps the queue contract honest.
  const { data: wp, error: wpError } = await supabase
    .from("work_packages")
    .select("id, status")
    .eq("id", input.workPackageId)
    .maybeSingle();
  if (wpError || !wp) return { ok: false, error: "ไม่พบรายการงาน" };
  if (wp.status !== "pending_approval") {
    return { ok: false, error: "รายการงานนี้ไม่ได้อยู่ในสถานะรอตรวจ" };
  }

  // Trim to the visible text; whitespace-only or null collapses to null.
  // isCommentValid above already forbids that case for rejected /
  // needs_revision, so this branch only triggers for approved.
  const normalisedComment = comment && comment.trim().length > 0 ? comment.trim() : null;

  const { error: insertError } = await supabase.from("approvals").insert({
    work_package_id: wp.id,
    decision: input.decision,
    comment: normalisedComment,
    decided_by: user.id,
  });
  if (insertError) {
    return { ok: false, error: "บันทึกผลการตรวจไม่สำเร็จ กรุณาลองใหม่อีกครั้ง" };
  }

  let transitioned = false;
  if (shouldTransitionToComplete(input.decision, wp.status)) {
    // Option (a) escalation, narrow to status-only and pending→complete
    // only. The .eq("status", "pending_approval") clause is the SQL
    // safety net — even if the JS predicate above were broken, this
    // UPDATE will only fire against a WP that's actually pending.
    const admin = createAdminClient();
    const { data: updated, error: updateError } = await admin
      .from("work_packages")
      .update({ status: "complete" })
      .eq("id", wp.id)
      .eq("status", "pending_approval")
      .select("id");
    if (updateError) {
      console.error("[recordDecision] WP status transition failed", {
        workPackageId: wp.id,
        error: updateError.message,
      });
    } else if (updated && updated.length > 0) {
      transitioned = true;
      // Spec 68: freeze the WP's labor cost into wp_labor_costs at close.
      // Called on the caller's authenticated PM session (NOT the admin
      // client) so current_user_role() passes the RPC gate and frozen_by /
      // the audit actor is this PM. Non-fatal: a missed freeze is recoverable
      // via the explicit re-freeze (spec 46 C6), so it never fails the approve.
      const { error: freezeError } = await supabase.rpc("freeze_wp_labor_cost", {
        p_wp: wp.id,
      });
      if (freezeError) {
        console.error("[recordDecision] labor cost freeze failed", {
          workPackageId: wp.id,
          error: freezeError.message,
        });
      }
    }
  }

  revalidatePath("/pm");
  revalidatePath(`/pm/work-packages/${wp.id}`);
  return { ok: true, transitioned };
}

// setHoldStatus: the PM on-hold toggle (spec 52 part B).
//
// Unlike the photo path there is NO admin escalation here —
// work_packages UPDATE RLS already admits project_manager/super_admin,
// so the UPDATE runs under the caller's own session and RLS is the
// load-bearing backstop. Each direction is double-guarded: the
// canHold/canRelease predicate plus a SQL WHERE clause on the current
// status, so a stale UI can never hold a pending/complete WP or
// "release" one that isn't held.
//
// Release re-derives the landing status from current During photos
// (deriveReleaseStatus) instead of snapshotting — see hold.ts.

export interface SetHoldStatusInput {
  workPackageId: string;
  hold: boolean;
}

export type SetHoldStatusResult = { ok: true } | { ok: false; error: string };

export async function setHoldStatus(input: SetHoldStatusInput): Promise<SetHoldStatusResult> {
  if (!isValidUuid(input.workPackageId)) return { ok: false, error: "รหัสรายการงานไม่ถูกต้อง" };

  const auth = await getActionUser();
  if (!auth) return { ok: false, error: NOT_SIGNED_IN };
  const { supabase, user } = auth;

  const { data: userRow } = await supabase
    .from("users")
    .select("role")
    .eq("id", user.id)
    .maybeSingle();
  if (!userRow || !PM_ROLES.includes(userRow.role)) {
    return { ok: false, error: "เฉพาะผู้จัดการโครงการเท่านั้นที่พักงานได้" };
  }

  const { data: wp, error: wpError } = await supabase
    .from("work_packages")
    .select("id, project_id, status")
    .eq("id", input.workPackageId)
    .maybeSingle();
  if (wpError || !wp) return { ok: false, error: "ไม่พบรายการงาน" };

  if (input.hold) {
    if (!canHold(wp.status)) {
      return { ok: false, error: "รายการงานนี้พักไม่ได้ในสถานะปัจจุบัน" };
    }
    const { data: updated, error: updateError } = await supabase
      .from("work_packages")
      .update({ status: "on_hold" })
      .eq("id", wp.id)
      .in("status", [...HOLDABLE_FROM_STATUSES])
      .select("id");
    if (updateError || !updated || updated.length === 0) {
      return { ok: false, error: "พักงานไม่สำเร็จ กรุณาลองใหม่อีกครั้ง" };
    }
  } else {
    if (!canRelease(wp.status)) {
      return { ok: false, error: "รายการงานนี้ไม่ได้พักอยู่" };
    }
    // getCurrentPhotosForWorkPackage throws on a query error — catch it
    // so the action keeps its result-object error contract (spec-35
    // lesson: server-action throws surface as opaque digests).
    let hasDuring: boolean;
    try {
      const photos = await getCurrentPhotosForWorkPackage(supabase, wp.id);
      hasDuring = photos.during.length > 0;
    } catch {
      return { ok: false, error: "กลับมาดำเนินการไม่สำเร็จ กรุณาลองใหม่อีกครั้ง" };
    }
    const target = deriveReleaseStatus(hasDuring);
    const { data: updated, error: updateError } = await supabase
      .from("work_packages")
      .update({ status: target })
      .eq("id", wp.id)
      .eq("status", "on_hold")
      .select("id");
    if (updateError || !updated || updated.length === 0) {
      return { ok: false, error: "กลับมาดำเนินการไม่สำเร็จ กรุณาลองใหม่อีกครั้ง" };
    }
  }

  revalidatePath("/pm");
  revalidatePath(`/pm/work-packages/${wp.id}`);
  revalidatePath(workPackageHref(wp.project_id, wp.id));
  return { ok: true };
}

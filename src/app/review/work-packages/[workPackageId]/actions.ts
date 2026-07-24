"use server";

// recordDecision: the PM approval write path.
//
// Validates the caller role, the decision, the comment-required rule,
// and that the WP is currently up for review (status = pending_approval),
// then hands BOTH writes — the approvals row and the status flip — to the
// decide_work_package SECURITY DEFINER RPC, on the PM's own session.
//
// Spec 337 U1: the approvals INSERT used to run under the user's session with
// RLS as the load-bearing authorisation primitive, and the flip afterwards ran
// on the ADMIN client. That split made every transition ANONYMOUS — the
// service-role session carries no JWT `sub`, so wp_transition_audit recorded
// actor_id NULL for 100% of rows (F1). Inside the RPC, RLS no longer applies
// (SECURITY DEFINER runs as the owner), so the RPC's own role gate (PM_ROLES) +
// can_see_wp are what authorise the write; the checks below stay for a clean
// Thai error surface before the round-trip.
//
// Spec 337 F3: `rejected` now means "send the work back" — the RPC flips the WP
// to the EXISTING rework status and advances rework_round, reusing the spec
// 144/216-218 machinery. `needs_revision` still leaves the status alone.

import "server-only";

import { revalidatePath } from "next/cache";
import { workPackageHref } from "@/lib/nav/project-paths";
import {
  APPROVAL_DECISIONS,
  isCommentValid,
  NOT_PENDING_REVIEW_ERROR,
  revisionReasonRequiredFor,
  type ApprovalDecision,
} from "@/lib/approvals/predicates";
import type { ApprovalRevisionReason } from "@/lib/db/enums";
import { canHold, canRelease } from "@/lib/work-packages/hold";
import { getActionUser, NOT_SIGNED_IN } from "@/lib/auth/action-gate";
import { PM_ROLES } from "@/lib/auth/role-home";
import { applyAssumedRole } from "@/lib/auth/apply-assumed-role";
import { isValidUuid } from "@/lib/validate/uuid";

function isValidDecision(value: unknown): value is ApprovalDecision {
  return typeof value === "string" && (APPROVAL_DECISIONS as readonly string[]).includes(value);
}

export interface RecordDecisionInput {
  workPackageId: string;
  decision: ApprovalDecision;
  comment?: string | null;
  /** Spec 355 — required for needs_revision (reject-evidence), forbidden otherwise. */
  revisionReason?: ApprovalRevisionReason | null;
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

  // Spec 355 — mirror the RPC's reason rule so the error surface is clean: a
  // reason is required for needs_revision and forbidden on approved/rejected.
  const revisionReason = input.revisionReason ?? null;
  if (revisionReasonRequiredFor(input.decision) && revisionReason === null) {
    return { ok: false, error: "กรุณาเลือกเหตุผลที่ต้องแก้ไข" };
  }
  if (!revisionReasonRequiredFor(input.decision) && revisionReason !== null) {
    return { ok: false, error: "ผลการตรวจนี้ไม่ต้องระบุเหตุผล" };
  }

  const auth = await getActionUser();
  if (!auth) return { ok: false, error: NOT_SIGNED_IN };
  const { supabase, user } = auth;

  // Explicit role check so the error surface is clean. The RPC's own PM_ROLES
  // gate is the load-bearing backstop — site_admin's session would be refused
  // there too, with a less useful error.
  const { data: userRow } = await supabase
    .from("users")
    .select("role")
    .eq("id", user.id)
    .maybeSingle();
  // Spec 274 U3: honor a super_admin's "view as" — a narrower assumed role is gated here too.
  const effectiveRole = await applyAssumedRole(userRow?.role);
  if (!effectiveRole || !PM_ROLES.includes(effectiveRole)) {
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
    return { ok: false, error: NOT_PENDING_REVIEW_ERROR };
  }

  // Trim to the visible text; whitespace-only or null collapses to null.
  // isCommentValid above already forbids that case for rejected /
  // needs_revision, so this branch only triggers for approved.
  const normalisedComment = comment && comment.trim().length > 0 ? comment.trim() : null;

  // One atomic, attributed call: the approvals row + the status flip the
  // decision implies. Returns the WP's status AFTER the decision — 'complete'
  // (approved), 'rework' (rejected, F3), or the unchanged 'pending_approval'
  // (needs_revision) — which is the honest source for `transitioned`.
  // p_comment is omitted rather than sent as null when there is no comment:
  // the RPC declares it `default null`, and supabase-js drops undefined keys, so
  // the two are identical at the DB while satisfying the generated arg type.
  const { data: newStatus, error: rpcError } = await supabase.rpc("decide_work_package", {
    p_wp: wp.id,
    p_decision: input.decision,
    ...(normalisedComment !== null ? { p_comment: normalisedComment } : {}),
    ...(revisionReason !== null ? { p_revision_reason: revisionReason } : {}),
  });
  if (rpcError) {
    // 22023 = the RPC's status guard (a colleague decided first) or the
    // comment rule, both pre-checked above. 42501 = role/membership, likewise
    // pre-checked — reaching either means the session desynced from the page.
    return {
      ok: false,
      error:
        rpcError.code === "22023"
          ? NOT_PENDING_REVIEW_ERROR
          : rpcError.code === "42501"
            ? "ไม่พบรายการงาน"
            : "บันทึกผลการตรวจไม่สำเร็จ กรุณาลองใหม่อีกครั้ง",
    };
  }

  const transitioned = newStatus === "complete";
  if (transitioned) {
    // Spec 68: freeze the WP's labor cost into wp_labor_costs at close. Stays
    // action-side on the caller's authenticated PM session so current_user_role()
    // passes the RPC gate and frozen_by / the audit actor is this PM. Non-fatal:
    // a missed freeze is recoverable via the explicit re-freeze (spec 46 C6), so
    // it never fails the approve.
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

  revalidatePath("/review");
  revalidatePath(`/review/work-packages/${wp.id}`);
  return { ok: true, transitioned };
}

// setHoldStatus: the PM on-hold toggle (spec 52 part B).
//
// Since ERD-audit M2, work_packages.status is not settable by a direct
// user-context UPDATE (the column grant is revoked). The transition is
// delegated to the set_work_package_hold SECURITY DEFINER RPC, which is the
// load-bearing authorisation: it re-checks role (PM_ROLES) + membership
// (can_see_wp) + current status, and re-derives the release landing status
// from current During photos (deriveReleaseStatus, now in SQL — see the RPC in
// migration 20260813025000). canHold/canRelease stay here only to return a
// friendly Thai message before the round-trip.

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
  // Spec 274 U3: honor a super_admin's "view as" — a narrower assumed role is gated here too.
  const effectiveRole = await applyAssumedRole(userRow?.role);
  if (!effectiveRole || !PM_ROLES.includes(effectiveRole)) {
    return { ok: false, error: "เฉพาะผู้จัดการโครงการเท่านั้นที่พักงานได้" };
  }

  const { data: wp, error: wpError } = await supabase
    .from("work_packages")
    .select("id, project_id, status")
    .eq("id", input.workPackageId)
    .maybeSingle();
  if (wpError || !wp) return { ok: false, error: "ไม่พบรายการงาน" };

  // The transition itself moved into the set_work_package_hold definer RPC
  // (ERD audit M2): work_packages.status is no longer settable via a direct
  // user-context UPDATE. canHold/canRelease stay here only to give a friendly
  // Thai message before the round-trip; the RPC re-checks role, membership, and
  // current status, and re-derives the release landing status from current
  // During photos (the same deriveReleaseStatus rule, now in SQL).
  if (input.hold ? !canHold(wp.status) : !canRelease(wp.status)) {
    return {
      ok: false,
      error: input.hold ? "รายการงานนี้พักไม่ได้ในสถานะปัจจุบัน" : "รายการงานนี้ไม่ได้พักอยู่",
    };
  }

  const { error: rpcError } = await supabase.rpc("set_work_package_hold", {
    p_wp: wp.id,
    p_hold: input.hold,
  });
  if (rpcError) {
    return {
      ok: false,
      error: input.hold
        ? "พักงานไม่สำเร็จ กรุณาลองใหม่อีกครั้ง"
        : "กลับมาดำเนินการไม่สำเร็จ กรุณาลองใหม่อีกครั้ง",
    };
  }

  revalidatePath("/review");
  revalidatePath(`/review/work-packages/${wp.id}`);
  revalidatePath(workPackageHref(wp.project_id, wp.id));
  return { ok: true };
}

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
import { createClient as createServerSupabase } from "@/lib/db/server";
import {
  APPROVAL_DECISIONS,
  isCommentValid,
  shouldTransitionToComplete,
  type ApprovalDecision,
} from "@/lib/approvals/predicates";
import type { UserRole } from "@/lib/auth/role-home";

const PM_ROLES: ReadonlyArray<UserRole> = ["project_manager", "super_admin"];

function isValidDecision(value: unknown): value is ApprovalDecision {
  return typeof value === "string" && (APPROVAL_DECISIONS as readonly string[]).includes(value);
}

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function isValidUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_REGEX.test(value);
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
  if (!isValidUuid(input.workPackageId)) return { ok: false, error: "Invalid work package id." };
  if (!isValidDecision(input.decision)) return { ok: false, error: "Invalid decision." };

  const comment = input.comment ?? null;
  if (!isCommentValid(input.decision, comment)) {
    return { ok: false, error: "A comment is required for this decision." };
  }

  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Not signed in." };

  // Explicit role check so the error surface is clean. RLS on
  // approvals INSERT is the load-bearing backstop — site_admin's
  // session would be refused there too, with a less useful error.
  const { data: userRow } = await supabase
    .from("users")
    .select("role")
    .eq("id", user.id)
    .maybeSingle();
  if (!userRow || !(PM_ROLES as readonly string[]).includes(userRow.role)) {
    return { ok: false, error: "Only project managers can record decisions." };
  }

  // Verify the WP exists under the caller's RLS and is at
  // pending_approval. Recording a decision on a WP that isn't up for
  // review is refused — keeps the queue contract honest.
  const { data: wp, error: wpError } = await supabase
    .from("work_packages")
    .select("id, status")
    .eq("id", input.workPackageId)
    .maybeSingle();
  if (wpError || !wp) return { ok: false, error: "Work package not found." };
  if (wp.status !== "pending_approval") {
    return { ok: false, error: "This work package isn't currently up for review." };
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
    return { ok: false, error: "Couldn't record the decision. Please try again." };
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
    }
  }

  revalidatePath("/pm");
  revalidatePath(`/pm/work-packages/${wp.id}`);
  return { ok: true, transitioned };
}

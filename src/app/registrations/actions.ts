"use server";

// Spec 263 U3 / spec 264 G1+G4 — back-office approve/reject actions over the
// role-parametric staff RPCs (approve_staff_registration / reject_staff_registration).
// Both relay through the caller's own RLS session (never the admin client) — the
// RPC itself is the authoritative gate (STAFF_APPROVAL_ROLES, role-home.ts), so
// calling on the admin client would let the RPC's current_user_role() resolve to
// null and mis-gate. requireActionRole is defense-in-depth (the friendly early
// check), not the sole guard. G4: the approve RPC is role-parametric — the approver
// picks the role (STAFF_ONBOARDABLE_ROLES selector) and it is passed as p_role. The
// action re-checks the pick against STAFF_ONBOARDABLE_ROLES client-side; the RPC
// re-guards against the DB's STAFF_ASSIGNABLE_ROLES allowlist server-side regardless.
//
// Site-assignment follow-up: the approver may OPTIONALLY pick a project, forwarded
// as p_project_id (already supported by the RPC — G1). The RPC only acts on it for
// a FIELD role (inserts workers.project_id); for an office role it's a harmless
// no-op. An unselected/blank projectId always normalizes to a logical null — the
// RPC call OMITS the p_project_id key in that case (see the comment at the call
// site for why: exactOptionalPropertyTypes + the generated Args type), which is
// behaviorally identical to sending null since the SQL parameter defaults to null.

import "server-only";

import { revalidatePath } from "next/cache";
import { requireActionRole } from "@/lib/auth/action-gate";
import { STAFF_APPROVAL_ROLES, isStaffOnboardableRole, type UserRole } from "@/lib/auth/role-home";
import { isValidUuid } from "@/lib/validate/uuid";
import { registrationErrorToThai } from "@/lib/register/registration-error";
import { validateRejectReason } from "@/lib/register/reject-reason";

export type ActionResult = { ok: true } | { ok: false; error: string };

const GENERIC = "ทำรายการไม่สำเร็จ กรุณาลองใหม่อีกครั้ง";
const QUEUE_PATH = "/registrations";

export async function approveStaffRegistration(input: {
  registrationId: string;
  role: UserRole;
  /** Optional site to assign — forwarded as p_project_id. A blank/absent
   *  selection always normalizes to null. */
  projectId?: string | null;
}): Promise<ActionResult> {
  if (!isValidUuid(input.registrationId)) return { ok: false, error: GENERIC };
  // The picked role must be one the operator may onboard-and-approve. The RPC
  // re-guards against the DB's STAFF_ASSIGNABLE_ROLES allowlist regardless — this
  // is the defense-in-depth client-side narrowing (mirrors the selector options).
  if (!isStaffOnboardableRole(input.role)) return { ok: false, error: GENERIC };

  const gate = await requireActionRole(STAFF_APPROVAL_ROLES);
  if ("error" in gate) return { ok: false, error: gate.error };

  const projectId = input.projectId?.trim() || null;

  // p_project_id?: string in the generated RPC Args (exactOptionalPropertyTypes
  // forbids passing `null` where only `string | undefined` is typed) — so an
  // unselected site OMITS the key entirely rather than sending null. The SQL
  // parameter defaults to null regardless, so this is behaviorally identical to
  // sending null explicitly (mirrors assign_worker_to_project's established
  // pattern in src/app/workers/actions.ts).
  const { error } = await gate.auth.supabase.rpc("approve_staff_registration", {
    p_id: input.registrationId,
    p_role: input.role,
    ...(projectId ? { p_project_id: projectId } : {}),
  });
  if (error) return { ok: false, error: registrationErrorToThai(error.message) };

  revalidatePath(QUEUE_PATH);
  revalidatePath(`${QUEUE_PATH}/${input.registrationId}`);
  return { ok: true };
}

export async function rejectStaffRegistration(input: {
  registrationId: string;
  reason: string;
}): Promise<ActionResult> {
  if (!isValidUuid(input.registrationId)) return { ok: false, error: GENERIC };
  const reasonError = validateRejectReason(input.reason);
  if (reasonError) return { ok: false, error: reasonError };

  const gate = await requireActionRole(STAFF_APPROVAL_ROLES);
  if ("error" in gate) return { ok: false, error: gate.error };

  const { error } = await gate.auth.supabase.rpc("reject_staff_registration", {
    p_id: input.registrationId,
    p_reason: input.reason.trim(),
  });
  if (error) return { ok: false, error: registrationErrorToThai(error.message) };

  revalidatePath(QUEUE_PATH);
  revalidatePath(`${QUEUE_PATH}/${input.registrationId}`);
  return { ok: true };
}

// Spec 322 — send a pending registration BACK for edit (non-terminal). Mirrors
// reject exactly (uuid check, non-blank note via the same validateRejectReason
// contract, STAFF_APPROVAL_ROLES gate, relay on the caller's RLS session so the
// RPC's current_user_role() is authoritative) EXCEPT the RPC keeps status
// 'pending' and writes the note to reject_reason (reused as the reviewer note).
export async function sendBackStaffRegistration(input: {
  registrationId: string;
  note: string;
}): Promise<ActionResult> {
  if (!isValidUuid(input.registrationId)) return { ok: false, error: GENERIC };
  const noteError = validateRejectReason(input.note);
  if (noteError) return { ok: false, error: noteError };

  const gate = await requireActionRole(STAFF_APPROVAL_ROLES);
  if ("error" in gate) return { ok: false, error: gate.error };

  const { error } = await gate.auth.supabase.rpc("send_back_staff_registration", {
    p_id: input.registrationId,
    p_note: input.note.trim(),
  });
  if (error) return { ok: false, error: registrationErrorToThai(error.message) };

  revalidatePath(QUEUE_PATH);
  revalidatePath(`${QUEUE_PATH}/${input.registrationId}`);
  return { ok: true };
}

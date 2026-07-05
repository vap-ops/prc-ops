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
}): Promise<ActionResult> {
  if (!isValidUuid(input.registrationId)) return { ok: false, error: GENERIC };
  // The picked role must be one the operator may onboard-and-approve. The RPC
  // re-guards against the DB's STAFF_ASSIGNABLE_ROLES allowlist regardless — this
  // is the defense-in-depth client-side narrowing (mirrors the selector options).
  if (!isStaffOnboardableRole(input.role)) return { ok: false, error: GENERIC };

  const gate = await requireActionRole(STAFF_APPROVAL_ROLES);
  if ("error" in gate) return { ok: false, error: gate.error };

  const { error } = await gate.auth.supabase.rpc("approve_staff_registration", {
    p_id: input.registrationId,
    p_role: input.role,
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

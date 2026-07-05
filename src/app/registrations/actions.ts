"use server";

// Spec 263 U3 / spec 264 G1 — back-office approve/reject actions over the now
// role-parametric staff RPCs (approve_staff_registration / reject_staff_registration).
// Both relay through the caller's own RLS session (never the admin client) — the
// RPC itself is the authoritative gate (TECHNICIAN_APPROVAL_ROLES, role-home.ts),
// so calling on the admin client would let the RPC's current_user_role() resolve
// to null and mis-gate. requireActionRole is defense-in-depth (the friendly early
// check), not the sole guard. G1 note: the approve RPC is role-parametric, but the
// queue passes p_role='technician' for now — the role SELECTOR is G4.

import "server-only";

import { revalidatePath } from "next/cache";
import { requireActionRole } from "@/lib/auth/action-gate";
import { TECHNICIAN_APPROVAL_ROLES } from "@/lib/auth/role-home";
import { isValidUuid } from "@/lib/validate/uuid";
import { registrationErrorToThai } from "@/lib/register/registration-error";
import { validateRejectReason } from "@/lib/register/reject-reason";

export type ActionResult = { ok: true } | { ok: false; error: string };

const GENERIC = "ทำรายการไม่สำเร็จ กรุณาลองใหม่อีกครั้ง";
const QUEUE_PATH = "/registrations";

export async function approveTechnicianRegistration(input: {
  registrationId: string;
}): Promise<ActionResult> {
  if (!isValidUuid(input.registrationId)) return { ok: false, error: GENERIC };

  const gate = await requireActionRole(TECHNICIAN_APPROVAL_ROLES);
  if ("error" in gate) return { ok: false, error: gate.error };

  const { error } = await gate.auth.supabase.rpc("approve_staff_registration", {
    p_id: input.registrationId,
    p_role: "technician",
  });
  if (error) return { ok: false, error: registrationErrorToThai(error.message) };

  revalidatePath(QUEUE_PATH);
  revalidatePath(`${QUEUE_PATH}/${input.registrationId}`);
  return { ok: true };
}

export async function rejectTechnicianRegistration(input: {
  registrationId: string;
  reason: string;
}): Promise<ActionResult> {
  if (!isValidUuid(input.registrationId)) return { ok: false, error: GENERIC };
  const reasonError = validateRejectReason(input.reason);
  if (reasonError) return { ok: false, error: reasonError };

  const gate = await requireActionRole(TECHNICIAN_APPROVAL_ROLES);
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

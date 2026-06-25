"use server";

// Spec 204 — retention lifecycle write actions. mark_retention_due / release_retention
// are SECURITY DEFINER gating the AUTHED session (pm/super), so call them on
// requireActionRole().auth.supabase. Release enqueues the GL post (money never moves
// itself). BILLING_WRITE_ROLES is the shared SSOT for who may write.

import "server-only";

import { revalidatePath } from "next/cache";
import { requireActionRole } from "@/lib/auth/action-gate";
import { BILLING_WRITE_ROLES } from "@/lib/accounting/billing-actions";
import type { AccountingActionResult } from "@/lib/accounting/billing-actions";

const GENERIC = "ทำรายการไม่สำเร็จ กรุณาลองใหม่";

export async function markRetentionDue(
  id: string,
  dueDate: string,
): Promise<AccountingActionResult> {
  const g = await requireActionRole(BILLING_WRITE_ROLES, GENERIC);
  if ("error" in g) return { ok: false, error: g.error };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dueDate)) return { ok: false, error: GENERIC };
  const { error } = await g.auth.supabase.rpc("mark_retention_due", {
    p_id: id,
    p_due_date: dueDate,
  });
  if (error) return { ok: false, error: GENERIC };
  revalidatePath("/accounting/retention");
  return { ok: true };
}

export async function releaseRetention(id: string): Promise<AccountingActionResult> {
  const g = await requireActionRole(BILLING_WRITE_ROLES, GENERIC);
  if ("error" in g) return { ok: false, error: g.error };
  const { error } = await g.auth.supabase.rpc("release_retention", { p_id: id });
  if (error) return { ok: false, error: GENERIC };
  revalidatePath("/accounting/retention");
  return { ok: true };
}

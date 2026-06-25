"use server";

// Spec 196 Tier 4 — month-end close actions. The period RPCs gate on the AUTHED
// session's role (open_accounting_period / set_accounting_period_status), so we call
// them on requireActionRole().auth.supabase, never the admin client (service-role's
// null role the gate refuses). Page gate + RPC gate are the other two layers.

import "server-only";

import { revalidatePath } from "next/cache";
import { requireActionRole } from "@/lib/auth/action-gate";
import { ACCOUNTING_ROLES } from "@/lib/auth/role-home";
import { firstOfMonth, PERIOD_STATUSES } from "@/lib/accounting/period";
import type { Database } from "@/lib/db/database.types";

type PeriodStatus = Database["public"]["Enums"]["accounting_period_status"];

export type PeriodActionResult = { ok: true } | { ok: false; error: string };

const GENERIC = "ทำรายการไม่สำเร็จ กรุณาลองใหม่";

export async function openPeriodAction(month: string): Promise<PeriodActionResult> {
  const g = await requireActionRole(ACCOUNTING_ROLES, GENERIC);
  if ("error" in g) return { ok: false, error: g.error };
  const { error } = await g.auth.supabase.rpc("open_accounting_period", {
    p_month: firstOfMonth(month),
  });
  if (error) return { ok: false, error: GENERIC };
  revalidatePath("/accounting/periods");
  return { ok: true };
}

export async function setPeriodStatusAction(
  month: string,
  status: string,
): Promise<PeriodActionResult> {
  const g = await requireActionRole(ACCOUNTING_ROLES, GENERIC);
  if ("error" in g) return { ok: false, error: g.error };
  if (!(PERIOD_STATUSES as readonly string[]).includes(status)) {
    return { ok: false, error: GENERIC };
  }
  const { error } = await g.auth.supabase.rpc("set_accounting_period_status", {
    p_month: firstOfMonth(month),
    p_status: status as PeriodStatus,
  });
  if (error) return { ok: false, error: GENERIC };
  revalidatePath("/accounting/periods");
  return { ok: true };
}

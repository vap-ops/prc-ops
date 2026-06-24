"use server";

// Spec 196 Tier 4 — month-end close actions. The accounting role drives the
// period lifecycle through the SECURITY DEFINER RPCs (open_accounting_period /
// set_accounting_period_status), which gate on the AUTHED session's role — so we
// call them on getActionUser().supabase, never the admin client (service-role has
// a null role the gate refuses). Defense-in-depth: re-check ACCOUNTING_ROLES here
// (the RPC gate + the page gate are the other two layers).

import "server-only";

import { revalidatePath } from "next/cache";
import { getActionUser, NOT_SIGNED_IN } from "@/lib/auth/action-gate";
import { ACCOUNTING_ROLES } from "@/lib/auth/role-home";
import { firstOfMonth, PERIOD_STATUSES } from "@/lib/accounting/period";
import type { Database } from "@/lib/db/database.types";
import type { UserRole } from "@/lib/db/enums";

type PeriodStatus = Database["public"]["Enums"]["accounting_period_status"];

export type PeriodActionResult = { ok: true } | { ok: false; error: string };

const GENERIC = "ทำรายการไม่สำเร็จ กรุณาลองใหม่";

type Gate = { auth: NonNullable<Awaited<ReturnType<typeof getActionUser>>> } | { error: string };

async function gate(): Promise<Gate> {
  const auth = await getActionUser();
  if (!auth) return { error: NOT_SIGNED_IN };
  // users RLS is read-self — this resolves the caller's own role.
  const { data } = await auth.supabase.from("users").select("role").eq("id", auth.user.id).single();
  const role = data?.role as UserRole | undefined;
  if (!role || !ACCOUNTING_ROLES.includes(role)) return { error: GENERIC };
  return { auth };
}

export async function openPeriodAction(month: string): Promise<PeriodActionResult> {
  const g = await gate();
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
  const g = await gate();
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

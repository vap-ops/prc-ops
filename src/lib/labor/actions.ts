"use server";

// Spec 46 P1 — daily labor capture actions. Authorization is the DB's:
// log_labor_day / correct_labor_log are SECURITY DEFINER RPCs that gate
// on current_user_role() (sa/pm/super) and enforce the one-current-
// entry-per-(wp, worker, date) rule under an advisory lock. Actions
// validate shape, relay per worker, and aggregate failures so one
// duplicate never aborts the rest of the crew.

import "server-only";

import { revalidatePath } from "next/cache";
import { createClient as createServerSupabase } from "@/lib/db/server";
import type { Database } from "@/lib/db/database.types";
import { getActionUser, NOT_SIGNED_IN } from "@/lib/auth/action-gate";
import { PM_ROLES } from "@/lib/auth/role-home";
import { UUID_REGEX } from "@/lib/validate/uuid";
import { bangkokTodayIso } from "./dates";
import { validateCorrection, validateDcPayment, validateLaborEntry } from "./validate";
import { validateNotes } from "@/lib/notes/validate";

type DayFraction = Database["public"]["Enums"]["day_fraction"];
type WagePaymentMethod = Database["public"]["Enums"]["wage_payment_method"];

const GENERIC_ERROR = "บันทึกทีมงานไม่สำเร็จ กรุณาลองใหม่อีกครั้ง";

export type LogLaborDaysResult =
  | { ok: true; failed: { workerId: string; message: string }[] }
  | { ok: false; error: string };

export type CorrectLaborLogResult = { ok: true } | { ok: false; error: string };

function rpcErrorToThai(message: string): string {
  if (message.includes("already exists")) return "มีบันทึกของวันนั้นอยู่แล้ว";
  if (message.includes("inactive")) return "ทีมงานถูกปิดใช้งานแล้ว";
  if (message.includes("complete")) return "งานปิดแล้ว บันทึกเพิ่มไม่ได้";
  return GENERIC_ERROR;
}

export async function logLaborDays(input: {
  workPackageId: string;
  revalidate: string;
  workDate: string;
  entries: { workerId: string; fraction: DayFraction }[];
  // Spec 74: optional day note, applied to every entry in this batch.
  note?: string;
}): Promise<LogLaborDaysResult> {
  if (!UUID_REGEX.test(input.workPackageId) || !input.revalidate.startsWith("/")) {
    return { ok: false, error: GENERIC_ERROR };
  }
  if (input.entries.some((e) => !UUID_REGEX.test(e.workerId))) {
    return { ok: false, error: GENERIC_ERROR };
  }
  const noteResult = validateNotes(input.note ?? "");
  if (!noteResult.ok) return { ok: false, error: noteResult.error };

  const auth = await getActionUser();
  if (!auth) return { ok: false, error: NOT_SIGNED_IN };
  const { supabase, user } = auth;

  const { data: me } = await supabase.from("users").select("role").eq("id", user.id).maybeSingle();
  if (!me) return { ok: false, error: GENERIC_ERROR };

  const validation = validateLaborEntry(
    { workDate: input.workDate, workerIds: input.entries.map((e) => e.workerId) },
    { today: bangkokTodayIso(), role: me.role },
  );
  if (validation) return { ok: false, error: validation };

  const failed: { workerId: string; message: string }[] = [];
  for (const entry of input.entries) {
    const { error } = await supabase.rpc("log_labor_day", {
      p_wp: input.workPackageId,
      p_worker: entry.workerId,
      p_date: input.workDate,
      p_fraction: entry.fraction,
      // Empty clears (the RPC's nullif(btrim(...),'') maps "" → null).
      p_note: noteResult.value ?? "",
    });
    if (error) {
      failed.push({ workerId: entry.workerId, message: rpcErrorToThai(error.message) });
    }
  }

  if (failed.length < input.entries.length) {
    revalidatePath(input.revalidate);
  }
  return { ok: true, failed };
}

export async function correctLaborLog(input: {
  logId: string;
  revalidate: string;
  reason: string;
  fraction: DayFraction | null;
  tombstone: boolean;
}): Promise<CorrectLaborLogResult> {
  if (!UUID_REGEX.test(input.logId) || !input.revalidate.startsWith("/")) {
    return { ok: false, error: GENERIC_ERROR };
  }
  const validation = validateCorrection({
    reason: input.reason,
    fraction: input.fraction,
    tombstone: input.tombstone,
  });
  if (validation) return { ok: false, error: validation };

  const supabase = await createServerSupabase();
  const { error } = await supabase.rpc("correct_labor_log", {
    p_log: input.logId,
    p_reason: input.reason.trim(),
    ...(input.tombstone
      ? { p_tombstone: true }
      : input.fraction
        ? { p_fraction: input.fraction }
        : {}),
  });
  if (error) {
    if (error.message.includes("already superseded")) {
      return { ok: false, error: "รายการนี้ถูกแก้ไขไปแล้ว รีเฟรชหน้าจอ" };
    }
    return { ok: false, error: GENERIC_ERROR };
  }

  revalidatePath(input.revalidate);
  return { ok: true };
}

// Spec 68 P2 — re-freeze the WP's labor cost snapshot. The auto-freeze runs
// at approve→complete; this is the explicit PM re-freeze after a post-close
// correction (C6: the snapshot moves only on an audited, deliberate freeze).
// pm/super only — rate is money. Authenticated session so the RPC gate passes
// and the audit actor is the PM.
export type RefreezeLaborCostResult = { ok: true } | { ok: false; error: string };

export async function refreezeWpLaborCost(input: {
  workPackageId: string;
  revalidate: string;
}): Promise<RefreezeLaborCostResult> {
  if (!UUID_REGEX.test(input.workPackageId) || !input.revalidate.startsWith("/")) {
    return { ok: false, error: GENERIC_ERROR };
  }

  const auth = await getActionUser();
  if (!auth) return { ok: false, error: NOT_SIGNED_IN };
  const { supabase, user } = auth;

  const { data: me } = await supabase.from("users").select("role").eq("id", user.id).maybeSingle();
  if (!me || !PM_ROLES.includes(me.role)) {
    return { ok: false, error: "เฉพาะผู้จัดการโครงการเท่านั้นที่ตรึงค่าแรงได้" };
  }

  const { error } = await supabase.rpc("freeze_wp_labor_cost", { p_wp: input.workPackageId });
  if (error) return { ok: false, error: GENERIC_ERROR };

  revalidatePath(input.revalidate);
  return { ok: true };
}

// Spec 205 U1 — set the WP's labor budget (a money cost ceiling, baht). The PM
// OR the PD (PM_ROLES): the set_wp_labor_budget RPC gates pm/director/super, and
// the authed session makes that gate pass and pins the audit actor to the setter.
// The budget-vs-actual surface on the PM review page reads it back via admin.
export type SetWpLaborBudgetResult = { ok: true } | { ok: false; error: string };

const GENERIC_BUDGET_ERROR = "บันทึกงบค่าแรงไม่สำเร็จ กรุณาลองใหม่อีกครั้ง";

export async function setWpLaborBudget(input: {
  workPackageId: string;
  budget: number;
  revalidate: string;
}): Promise<SetWpLaborBudgetResult> {
  if (!UUID_REGEX.test(input.workPackageId) || !input.revalidate.startsWith("/")) {
    return { ok: false, error: GENERIC_BUDGET_ERROR };
  }
  if (!Number.isFinite(input.budget) || input.budget < 0) {
    return { ok: false, error: "งบค่าแรงต้องเป็นจำนวนเงินที่ไม่ติดลบ" };
  }

  const auth = await getActionUser();
  if (!auth) return { ok: false, error: NOT_SIGNED_IN };
  const { supabase, user } = auth;

  const { data: me } = await supabase.from("users").select("role").eq("id", user.id).maybeSingle();
  if (!me || !PM_ROLES.includes(me.role)) {
    return { ok: false, error: "เฉพาะ PM หรือ PD เท่านั้นที่ตั้งงบค่าแรงได้" };
  }

  const { error } = await supabase.rpc("set_wp_labor_budget", {
    p_wp: input.workPackageId,
    p_budget: input.budget,
  });
  if (error) return { ok: false, error: GENERIC_BUDGET_ERROR };

  revalidatePath(input.revalidate);
  return { ok: true };
}

// Spec 127 U2 / spec 170 U3 — record a DC payment for a worker × period.
// pm/super only (money). The record_wage_payment RPC recomputes the owed amount
// server-side, re-gates the role, locks per (worker, period) and refuses a
// duplicate — this action validates shape and maps RPC errors to Thai.
// Authenticated session so the RPC gate passes and paid_by/the audit actor is
// the PM. ADR 0062: a DC is a worker, so the payee bound here is the worker.
export type RecordDcPaymentResult = { ok: true } | { ok: false; error: string };

const GENERIC_PAYMENT_ERROR = "บันทึกการจ่ายเงินไม่สำเร็จ กรุณาลองใหม่อีกครั้ง";

function paymentRpcErrorToThai(message: string): string {
  if (message.includes("already exists")) return "บันทึกการจ่ายของช่วงนี้ไว้แล้ว";
  if (message.includes("not found")) return "ไม่พบช่าง";
  return GENERIC_PAYMENT_ERROR;
}

export async function recordDcPayment(input: {
  workerId: string;
  from: string;
  to: string;
  paidAt: string;
  paidAmount: number;
  method: string;
  reference: string;
  note: string;
  revalidate: string;
}): Promise<RecordDcPaymentResult> {
  if (!input.revalidate.startsWith("/")) return { ok: false, error: GENERIC_PAYMENT_ERROR };
  const validation = validateDcPayment(input);
  if (validation) return { ok: false, error: validation };

  const auth = await getActionUser();
  if (!auth) return { ok: false, error: NOT_SIGNED_IN };
  const { supabase, user } = auth;

  const { data: me } = await supabase.from("users").select("role").eq("id", user.id).maybeSingle();
  if (!me || !PM_ROLES.includes(me.role)) {
    return { ok: false, error: "เฉพาะผู้จัดการโครงการเท่านั้นที่บันทึกการจ่ายเงินได้" };
  }

  const { error } = await supabase.rpc("record_wage_payment", {
    p_worker: input.workerId,
    p_from: input.from,
    p_to: input.to,
    p_paid_amount: input.paidAmount,
    p_paid_at: input.paidAt,
    p_method: input.method as WagePaymentMethod,
    p_reference: input.reference,
    p_note: input.note,
  });
  if (error) return { ok: false, error: paymentRpcErrorToThai(error.message) };

  revalidatePath(input.revalidate);
  return { ok: true };
}

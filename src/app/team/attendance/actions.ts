"use server";

// Spec 397 U3 — reopening a closed muster day from the audit report.
//
// Authorization is the DB's: `reopen_muster_day` is SECURITY DEFINER, gates on
// current_user_role() ∈ MUSTER_REOPEN_ROLES, applies can_see_project to every
// role except `procurement` (for which it is structurally false), refuses when
// wages are already booked, and writes the audit row. This action validates
// shape, checks the same role set so the surface never promises what the server
// refuses, relays, and maps the RPC's SQLSTATEs to Thai.
//
// The correction loop this opens is reopen → fix → close again: close_muster_day
// is idempotent and re-derives, so re-closing is what re-settles the day.

import "server-only";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { requireActionRole } from "@/lib/auth/action-gate";
import { MUSTER_REOPEN_ROLES } from "@/lib/auth/role-home";
import { ISO_DATE_REGEX } from "@/lib/dates";
import { UUID_REGEX } from "@/lib/validate/uuid";

export type ReopenResult = { ok: true } | { ok: false; error: string };

// No "ลองใหม่" anywhere in this file, deliberately (honest-copy ratchet). Of the
// two arms that reach a generic message, one is a SHAPE failure — a malformed
// project id or date can never succeed on a retry — and the other is an unknown
// database refusal whose retryability we do not know. Neither may promise that
// pressing the button again will work, so both name the cause and the next step.
const GENERIC = "เปิดวันอีกครั้งไม่สำเร็จ กรุณาแจ้งผู้ดูแลระบบพร้อมวันที่และชื่อโครงการ";
const BAD_SHAPE = "วันที่หรือโครงการไม่ถูกต้อง";

export async function reopenMusterDay(input: {
  projectId: string;
  workDate: string;
  reason: string;
}): Promise<ReopenResult> {
  // requireActionRole, not getActionUser + a hand-rolled role read: it resolves
  // the caller's role through users RLS and returns NOT_SIGNED_IN vs not-permitted
  // for us. The RPC gates again — this is the friendly early check, never the
  // boundary.
  const gate = await requireActionRole(MUSTER_REOPEN_ROLES, "บัญชีนี้ไม่มีสิทธิ์เปิดวันที่ปิดแล้ว");
  if ("error" in gate) return { ok: false, error: gate.error };
  const auth = gate.auth;

  if (!UUID_REGEX.test(input.projectId) || !ISO_DATE_REGEX.test(input.workDate)) {
    return { ok: false, error: BAD_SHAPE };
  }

  // Trimmed HERE, not only in the RPC: the reason is the whole audit value, and a
  // user who typed spaces should be told by the form's own server, not by a
  // database refusal that reads like a system error.
  const reason = input.reason.trim();
  if (reason.length === 0) {
    return { ok: false, error: "กรุณาระบุเหตุผลที่เปิดวันนี้อีกครั้ง" };
  }

  const { error } = await auth.supabase.rpc("reopen_muster_day", {
    p_project: input.projectId,
    p_date: input.workDate,
    p_reason: reason,
  });

  if (error) {
    // 42501 is a permanent refusal — never "try again". The other two P0001 arms
    // describe a state the caller can see and act on, so they say what it is.
    if (error.code === "42501") {
      return { ok: false, error: "บัญชีนี้ไม่มีสิทธิ์เปิดวันนี้อีกครั้ง" };
    }
    if (error.message.includes("wages are already booked")) {
      return {
        ok: false,
        error: "วันนี้บันทึกค่าแรงไปแล้ว ต้องยกเลิกค่าแรงก่อนจึงจะเปิดวันใหม่ได้",
      };
    }
    if (error.message.includes("not closed")) {
      return { ok: false, error: "วันนี้ยังไม่ได้ปิด จึงไม่ต้องเปิดใหม่" };
    }
    return { ok: false, error: GENERIC };
  }

  // Both surfaces that show closure state: the report itself, and the /team hub
  // whose วันนี้ card counts unclosed days.
  revalidatePath("/team/attendance");
  revalidatePath("/team");
  return { ok: true };
}

/**
 * The form entry point. The report is a zero-client-JS page (its range picker is
 * a plain GET form), so the reopen control stays the same shape: a POST form, a
 * redirect back to the caller's own URL, and the outcome carried in the query
 * for the page to render. No `useActionState`, no 'use client', nothing to
 * hydrate — which also means the control works on the wedged in-app browser.
 *
 * The outcome is a CODE, not the Thai sentence: a message in a URL survives in
 * history and screenshots, and the page owns its own copy anyway.
 */
export async function reopenMusterDayFromForm(formData: FormData): Promise<void> {
  const back = String(formData.get("returnTo") ?? "/team/attendance");
  // Never redirect off-app on a value that came from a form field.
  const safeBack = back.startsWith("/") && !back.startsWith("//") ? back : "/team/attendance";
  const sep = safeBack.includes("?") ? "&" : "?";

  const result = await reopenMusterDay({
    projectId: String(formData.get("projectId") ?? ""),
    workDate: String(formData.get("workDate") ?? ""),
    reason: String(formData.get("reason") ?? ""),
  });

  redirect(
    result.ok
      ? `${safeBack}${sep}reopened=1`
      : `${safeBack}${sep}reopenError=${encodeURIComponent(result.error)}`,
  );
}

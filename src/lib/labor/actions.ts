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
import { UUID_REGEX } from "@/lib/validate/uuid";
import { bangkokTodayIso } from "./dates";
import { validateCorrection, validateLaborEntry } from "./validate";

type DayFraction = Database["public"]["Enums"]["day_fraction"];

const GENERIC_ERROR = "บันทึกแรงงานไม่สำเร็จ กรุณาลองใหม่อีกครั้ง";

export type LogLaborDaysResult =
  | { ok: true; failed: { workerId: string; message: string }[] }
  | { ok: false; error: string };

export type CorrectLaborLogResult = { ok: true } | { ok: false; error: string };

function rpcErrorToThai(message: string): string {
  if (message.includes("already exists")) return "มีบันทึกของวันนั้นอยู่แล้ว";
  if (message.includes("inactive")) return "คนงานถูกปิดใช้งานแล้ว";
  if (message.includes("complete")) return "งานปิดแล้ว บันทึกเพิ่มไม่ได้";
  return GENERIC_ERROR;
}

export async function logLaborDays(input: {
  workPackageId: string;
  revalidate: string;
  workDate: string;
  entries: { workerId: string; fraction: DayFraction }[];
}): Promise<LogLaborDaysResult> {
  if (!UUID_REGEX.test(input.workPackageId) || !input.revalidate.startsWith("/")) {
    return { ok: false, error: GENERIC_ERROR };
  }
  if (input.entries.some((e) => !UUID_REGEX.test(e.workerId))) {
    return { ok: false, error: GENERIC_ERROR };
  }

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

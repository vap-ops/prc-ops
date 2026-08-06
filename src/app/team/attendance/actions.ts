"use server";

// Spec 397 U3 — reopening a closed muster day from the audit report.
//
// Authorization is the DB's: `reopen_muster_day` is SECURITY DEFINER, gates on
// current_user_role() ∈ MUSTER_REOPEN_ROLES, applies can_see_project to every
// role except `procurement` (for which it is structurally false), refuses when
// wages are already booked, and writes the audit row. This action validates
// shape, checks the same role set so the surface never promises what the server
// refuses, relays, and returns an outcome CODE.
//
// It returns a code, never a sentence: the outcome travels back in the URL, and a
// Thai message there is unbounded, survives in history, and would let a crafted
// link render attacker-chosen text inside the app's own error notice. The page
// owns the copy — including the honest-copy rule, since no arm here is retryable
// in a way a "ลองใหม่" could promise.
//
// The correction loop this opens is reopen → fix → close again: close_muster_day
// is idempotent and re-derives, so re-closing is what re-settles the day.
//
// ⚠️ CORRECTED 2026-08-06 (spec 400 U3a/U3b). This header used to say the close
// was gated on SA_SURFACE_ROLES + can_see_project, which plain `procurement`
// failed on both counts, so the loop was two-person for it. Migration
// 20260813075912 widened `close_muster_day` to `procurement` AND gave that role a
// cross-project arm, so the loop is now ONE person — see closeMusterDay below,
// which is the surface half of that ruling.

import "server-only";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { requireActionRole } from "@/lib/auth/action-gate";
import {
  MUSTER_CLOSE_ROLES,
  MUSTER_CORRECT_ROLES,
  MUSTER_REOPEN_ROLES,
} from "@/lib/auth/role-home";
import { bangkokTodayIso, ISO_DATE_REGEX } from "@/lib/dates";
import { bangkokInAt } from "@/lib/muster/add-person";
import {
  addPersonReturnTo,
  closeReturnTo,
  reopenReturnTo,
  type AddPersonOutcome,
  type CloseOutcome,
  type ReopenOutcome,
} from "@/lib/muster/reopen-return";
import { UUID_REGEX } from "@/lib/validate/uuid";

export type ReopenResult = { ok: true } | { ok: false; outcome: ReopenOutcome };

export async function reopenMusterDay(input: {
  projectId: string;
  workDate: string;
  reason: string;
}): Promise<ReopenResult> {
  // requireActionRole, not getActionUser + a hand-rolled role read: it resolves
  // the caller's role through users RLS and returns NOT_SIGNED_IN vs not-permitted
  // for us. The RPC gates again — this is the friendly early check, never the
  // boundary.
  const gate = await requireActionRole(MUSTER_REOPEN_ROLES);
  if ("error" in gate) return { ok: false, outcome: "denied" };
  const auth = gate.auth;

  if (!UUID_REGEX.test(input.projectId) || !ISO_DATE_REGEX.test(input.workDate)) {
    return { ok: false, outcome: "shape" };
  }

  // Trimmed HERE, not only in the RPC: the reason is the whole audit value, and a
  // user who typed spaces should be told by the form's own server, not by a
  // database refusal that reads like a system error.
  const reason = input.reason.trim();
  if (reason.length === 0) {
    // The input is `required`, so this is the trimmed-to-empty case only.
    return { ok: false, outcome: "shape" };
  }

  const { error } = await auth.supabase.rpc("reopen_muster_day", {
    p_project: input.projectId,
    p_date: input.workDate,
    p_reason: reason,
  });

  if (error) {
    // 42501 is a permanent refusal — never "try again". The other two P0001 arms
    // describe a state the caller can see and act on, so they say what it is.
    if (error.code === "42501") return { ok: false, outcome: "denied" };
    if (error.message.includes("wages are already booked")) return { ok: false, outcome: "wages" };
    if (error.message.includes("not closed")) return { ok: false, outcome: "notclosed" };
    return { ok: false, outcome: "failed" };
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
  const result = await reopenMusterDay({
    projectId: String(formData.get("projectId") ?? ""),
    workDate: String(formData.get("workDate") ?? ""),
    reason: String(formData.get("reason") ?? ""),
  });

  // reopenReturnTo owns BOTH hazards: the off-app redirect (it runs the form
  // field through safeBackHref, which a hand-rolled startsWith check let
  // `/\evil.com` past) and the fragment — the drill's own href ends `#w-<id>`,
  // so appending the outcome naively hid it in the hash and made both banners
  // dead code.
  redirect(
    reopenReturnTo(String(formData.get("returnTo") ?? ""), result.ok ? "ok" : result.outcome),
  );
}

export type CloseResult = { ok: true } | { ok: false; outcome: CloseOutcome };

/**
 * Spec 400 U3b — the OTHER half of the loop. Spec 400 U3a widened
 * `close_muster_day` to `procurement` (migration 20260813075912), and until this
 * unit no surface offered that role the step: the report told them to hand it to
 * the SA, and the grid — the default view since U1 — carried no control at all.
 *
 * Authorization is the DB's, exactly as for reopen: the RPC is SECURITY DEFINER,
 * gates on `current_user_role() ∈ MUSTER_CLOSE_ROLES`, applies `can_see_project`
 * to every role except `procurement` (for which it is structurally false), and
 * calls `derive_muster_labor_internal` — so this is the step that BOOKS the day's
 * wages, not a bookkeeping tick.
 *
 * ⚠️ No "already closed" arm, and that is a property of the RPC rather than an
 * omission: it upserts the closure (`on conflict … do update`) and re-derives, so
 * re-closing is idempotent. Inventing a refusal here would contradict it.
 */
export async function closeMusterDay(input: {
  projectId: string;
  workDate: string;
}): Promise<CloseResult> {
  const gate = await requireActionRole(MUSTER_CLOSE_ROLES);
  if ("error" in gate) return { ok: false, outcome: "denied" };
  const auth = gate.auth;

  if (!UUID_REGEX.test(input.projectId) || !ISO_DATE_REGEX.test(input.workDate)) {
    return { ok: false, outcome: "shape" };
  }

  // The UI withholds the control for today and the future (dayCorrectionControl's
  // `dayNotOver` / `future` arms), but these are plain hidden inputs on a
  // zero-client-JS form — a hand-posted date would write a closure for
  // 2027-01-01, and U3a's own closure guard would then refuse every correction
  // scan on that day. The RPC has no date bound of its own, so the bound lives
  // here, on the server side of the same rule the surface renders.
  if (input.workDate >= bangkokTodayIso()) {
    return { ok: false, outcome: "notover" };
  }

  const { error } = await auth.supabase.rpc("close_muster_day", {
    p_project: input.projectId,
    p_date: input.workDate,
  });

  if (error) {
    // 42501 covers BOTH of the RPC's refusals — the role gate and the
    // can_see_project arm — and neither is retryable, so neither may say ลองใหม่.
    if (error.code === "42501") return { ok: false, outcome: "denied" };
    return { ok: false, outcome: "failed" };
  }

  revalidatePath("/team/attendance");
  revalidatePath("/team");
  return { ok: true };
}

export type AddPersonResult = { ok: true } | { ok: false; outcome: AddPersonOutcome };

/**
 * Spec 400 U3c-b — "he was here, add him", spec 400 §3's commonest correction and
 * the one the app never had. Three units had to land first: U3a widened
 * `muster_scan_in` to `procurement`, U4 added `muster_correct_session` so the row
 * can carry a REAL check-in time, and U3c-a added `list_muster_teams_for_day`
 * because `muster_teams` RLS refuses `procurement` outright — the picker was
 * empty for 4 of the 5 people the write was widened for.
 *
 * Authorization is the DB's: `muster_correct_session` is SECURITY DEFINER, gates
 * on `current_user_role() ∈ MUSTER_CORRECT_ROLES`, applies `can_see_project` to
 * every role except `procurement`, bounds the time to the row's own Bangkok work
 * date, refuses the INSERT path on a closed day, and delegates the insert to
 * `muster_scan_in` so the "already mustered elsewhere" invariants are not forked.
 *
 * ⚠️ `p_session` is hard-coded `regular` rather than taken from the form: an OT
 * session is ×1.5 money (spec 351) and the RPC refuses to CREATE one, so a field
 * would be an offer the server declines. `p_out_at` is null — this records an
 * arrival, and a departure is a separate correction.
 */
export async function addMusterPerson(input: {
  teamId: string;
  workerId: string;
  workDate: string;
  inTime: string;
}): Promise<AddPersonResult> {
  const gate = await requireActionRole(MUSTER_CORRECT_ROLES);
  if ("error" in gate) return { ok: false, outcome: "denied" };
  const auth = gate.auth;

  if (!UUID_REGEX.test(input.teamId) || !UUID_REGEX.test(input.workerId)) {
    return { ok: false, outcome: "shape" };
  }

  // bangkokInAt validates BOTH parts and states the +07:00 offset explicitly. A
  // bare local-time string would be read as UTC — this box, Vercel and CI all run
  // UTC — so an early-morning correction would land on the previous day and the
  // RPC's own work-date bound would refuse it.
  const inAt = bangkokInAt(input.workDate, input.inTime);
  if (inAt === null) return { ok: false, outcome: "shape" };

  // `p_out_at` is OMITTED, not passed as null: it is an optional parameter, so
  // the generated type is `p_out_at?: string` and `exactOptionalPropertyTypes`
  // rejects an explicit undefined. Omitting it takes the function's own
  // `default null`, which is the same instruction — this records an ARRIVAL, and
  // a departure is a separate correction.
  const { error } = await auth.supabase.rpc("muster_correct_session", {
    p_team: input.teamId,
    p_worker: input.workerId,
    p_session: "regular",
    p_in_at: inAt,
  });

  if (error) {
    // 42501 covers both of the RPC's permanent refusals — the role gate and the
    // can_see_project arm — and neither may ever say ลองใหม่.
    if (error.code === "42501") return { ok: false, outcome: "denied" };
    // Ordered like the RPC's own guards. The duplicate arm matches THREE
    // sentences because the insert is delegated to muster_scan_in, which words
    // the conflict differently depending on what the caller may see.
    if (error.message.includes("only be added to an open day")) {
      return { ok: false, outcome: "closed" };
    }
    if (
      error.message.includes("already in team of") ||
      error.message.includes("already mustered") ||
      error.message.includes("already in the office team")
    ) {
      return { ok: false, outcome: "duplicate" };
    }
    if (error.message.includes("team not found")) return { ok: false, outcome: "noteam" };
    return { ok: false, outcome: "failed" };
  }

  revalidatePath("/team/attendance");
  revalidatePath("/team");
  return { ok: true };
}

/** The form entry point — same shape as the other two: POST, redirect, code. */
export async function addMusterPersonFromForm(formData: FormData): Promise<void> {
  const result = await addMusterPerson({
    teamId: String(formData.get("teamId") ?? ""),
    workerId: String(formData.get("workerId") ?? ""),
    workDate: String(formData.get("workDate") ?? ""),
    inTime: String(formData.get("inTime") ?? ""),
  });

  redirect(
    addPersonReturnTo(String(formData.get("returnTo") ?? ""), result.ok ? "ok" : result.outcome),
  );
}

/** The form entry point — same shape as reopen's: POST, redirect, outcome CODE. */
export async function closeMusterDayFromForm(formData: FormData): Promise<void> {
  const result = await closeMusterDay({
    projectId: String(formData.get("projectId") ?? ""),
    workDate: String(formData.get("workDate") ?? ""),
  });

  redirect(
    closeReturnTo(String(formData.get("returnTo") ?? ""), result.ok ? "ok" : result.outcome),
  );
}

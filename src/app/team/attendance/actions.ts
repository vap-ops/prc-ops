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
// is idempotent and re-derives, so re-closing is what re-settles the day. ⚠️ That
// close is gated on SA_SURFACE_ROLES and can_see_project, which plain
// `procurement` fails on both counts — so for that role the loop is two-person
// and the page's copy must say so (spec 397 §9 Q7).

import "server-only";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { requireActionRole } from "@/lib/auth/action-gate";
import { MUSTER_REOPEN_ROLES } from "@/lib/auth/role-home";
import { ISO_DATE_REGEX } from "@/lib/dates";
import { reopenReturnTo, type ReopenOutcome } from "@/lib/muster/reopen-return";
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

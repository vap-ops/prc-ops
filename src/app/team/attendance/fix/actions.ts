"use server";

// Spec 400 U6a — the worker-day fix screen's own two write actions: retiming an
// existing session and deleting one. Both follow the exact shape of
// reopenMusterDay/closeMusterDay/addMusterPerson beside them: authorization is
// the DB's (the RPC is SECURITY DEFINER and gates itself), this is the friendly
// early check + arg mapping, and the outcome travels back as a CODE, never a
// sentence — the page owns the copy.
//
// Adding a missing person reuses `addMusterPersonFromForm` from the sibling
// route UNCHANGED (see fix/page.tsx) — MUSTER_CORRECT_ROLES is exactly
// muster_correct_session's own allowlist, so there is no scope difference
// between the two surfaces that would justify a second copy.

import "server-only";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { requireActionRole } from "@/lib/auth/action-gate";
import { MUSTER_CORRECT_ROLES } from "@/lib/auth/role-home";
import { ISO_DATE_REGEX } from "@/lib/dates";
import { bangkokInAt } from "@/lib/muster/add-person";
import {
  retimeReturnTo,
  undoReturnTo,
  type RetimeOutcome,
  type UndoOutcome,
} from "@/lib/muster/reopen-return";
import { UUID_REGEX } from "@/lib/validate/uuid";

/** Every route this page's writes can change the shape of. */
function revalidateFixSurfaces(): void {
  revalidatePath("/team/attendance/fix");
  revalidatePath("/team/attendance");
  revalidatePath("/team");
}

export type RetimeResult = { ok: true } | { ok: false; outcome: RetimeOutcome };

/**
 * Retime an EXISTING session — `muster_correct_session`'s UPDATE path.
 * `teamId` is resolved server-side by the page, never user-editable: the RPC
 * identifies the row by (worker, work_date via the team, session) and refuses
 * when the supplied team does not match the row's own, so a stale value fails
 * safely (outcome `stale`) rather than silently targeting the wrong row.
 *
 * Both times are OPTIONAL and independently omittable — a blank field means
 * "leave this one alone". At least one must be filled: an all-blank submit
 * would reach the RPC's own "nothing to correct" refusal, so it is caught here
 * as `shape` instead of spending a round trip on it.
 */
export async function correctMusterSession(input: {
  teamId: string;
  workerId: string;
  session: "regular" | "ot";
  workDate: string;
  inTime: string;
  outTime: string;
}): Promise<RetimeResult> {
  const gate = await requireActionRole(MUSTER_CORRECT_ROLES);
  if ("error" in gate) return { ok: false, outcome: "denied" };
  const auth = gate.auth;

  if (
    !UUID_REGEX.test(input.teamId) ||
    !UUID_REGEX.test(input.workerId) ||
    !ISO_DATE_REGEX.test(input.workDate) ||
    (input.session !== "regular" && input.session !== "ot")
  ) {
    return { ok: false, outcome: "shape" };
  }

  // bangkokInAt is named for the add form's ARRIVAL case but is a generic
  // Bangkok-offset timestamp builder — reused here for both directions, per
  // U6a's brief.
  const inAt = input.inTime.trim() === "" ? null : bangkokInAt(input.workDate, input.inTime);
  const outAt = input.outTime.trim() === "" ? null : bangkokInAt(input.workDate, input.outTime);
  if (
    (input.inTime.trim() !== "" && inAt === null) ||
    (input.outTime.trim() !== "" && outAt === null)
  ) {
    return { ok: false, outcome: "shape" };
  }
  if (inAt === null && outAt === null) return { ok: false, outcome: "shape" };

  const { error } = await auth.supabase.rpc("muster_correct_session", {
    p_team: input.teamId,
    p_worker: input.workerId,
    p_session: input.session,
    ...(inAt !== null ? { p_in_at: inAt } : {}),
    ...(outAt !== null ? { p_out_at: outAt } : {}),
  });

  if (error) {
    // 42501 covers both of the RPC's permanent refusals — the role gate and
    // the can_see_project arm.
    if (error.code === "42501") return { ok: false, outcome: "denied" };
    if (
      error.message.includes("must fall on the work date") ||
      error.message.includes("cannot be in the future") ||
      error.message.includes("too late for this work date") ||
      error.message.includes("cannot precede check-in")
    ) {
      return { ok: false, outcome: "bounds" };
    }
    if (error.message.includes("cannot be replaced")) return { ok: false, outcome: "locked" };
    if (error.message.includes("wages are already booked")) return { ok: false, outcome: "booked" };
    // "worker is in another team today" / "team not found" both mean the
    // page's server-resolved team_id no longer matches live data — reloading
    // the page re-resolves it, so this is genuinely retryable, unlike the
    // permanent refusals above.
    if (error.message.includes("another team today") || error.message.includes("team not found")) {
      return { ok: false, outcome: "stale" };
    }
    return { ok: false, outcome: "failed" };
  }

  revalidateFixSurfaces();
  return { ok: true };
}

/** The form entry point — same shape as every other muster form on this app. */
export async function correctMusterSessionFromForm(formData: FormData): Promise<void> {
  const rawSession = String(formData.get("session") ?? "");
  const result = await correctMusterSession({
    teamId: String(formData.get("teamId") ?? ""),
    workerId: String(formData.get("workerId") ?? ""),
    // Validated inside correctMusterSession; an unexpected value hits `shape`.
    session: rawSession as "regular" | "ot",
    workDate: String(formData.get("workDate") ?? ""),
    inTime: String(formData.get("inTime") ?? ""),
    outTime: String(formData.get("outTime") ?? ""),
  });
  redirect(
    retimeReturnTo(String(formData.get("returnTo") ?? ""), result.ok ? "ok" : result.outcome),
  );
}

export type UndoResult = { ok: true } | { ok: false; outcome: UndoOutcome };

/**
 * Delete one session via `muster_undo_scan`. Keyed by (worker, work_date,
 * session) — the RPC's own unique key — so no team id is needed here, unlike
 * retime.
 */
export async function undoAttendanceSession(input: {
  workerId: string;
  workDate: string;
  session: "regular" | "ot";
}): Promise<UndoResult> {
  const gate = await requireActionRole(MUSTER_CORRECT_ROLES);
  if ("error" in gate) return { ok: false, outcome: "denied" };
  const auth = gate.auth;

  if (
    !UUID_REGEX.test(input.workerId) ||
    !ISO_DATE_REGEX.test(input.workDate) ||
    (input.session !== "regular" && input.session !== "ot")
  ) {
    return { ok: false, outcome: "shape" };
  }

  const { error } = await auth.supabase.rpc("muster_undo_scan", {
    p_worker: input.workerId,
    p_date: input.workDate,
    p_session: input.session,
  });

  if (error) {
    if (error.code === "42501") return { ok: false, outcome: "denied" };
    if (error.message.includes("no check-in to undo")) return { ok: false, outcome: "gone" };
    if (error.message.includes("already closed")) return { ok: false, outcome: "closed" };
    if (error.message.includes("wages are already booked")) return { ok: false, outcome: "booked" };
    if (error.message.includes("undo the OT session first"))
      return { ok: false, outcome: "otFirst" };
    return { ok: false, outcome: "failed" };
  }

  revalidateFixSurfaces();
  return { ok: true };
}

/** The form entry point — same shape as every other muster form on this app. */
export async function undoAttendanceSessionFromForm(formData: FormData): Promise<void> {
  const rawSession = String(formData.get("session") ?? "");
  const result = await undoAttendanceSession({
    workerId: String(formData.get("workerId") ?? ""),
    workDate: String(formData.get("workDate") ?? ""),
    session: rawSession as "regular" | "ot",
  });
  redirect(undoReturnTo(String(formData.get("returnTo") ?? ""), result.ok ? "ok" : result.outcome));
}

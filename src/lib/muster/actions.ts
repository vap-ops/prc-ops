"use server";

// Spec 306 U3 — muster cockpit actions. Authorization is the DB's: the muster
// RPCs (open_muster_team / muster_scan_in / muster_scan_out / set_muster_team_wps)
// are SECURITY DEFINER, gate on current_user_role() ∈ (site_admin, super_admin,
// procurement_manager — spec 348 SA-parity) +
// can_see_project, and enforce the one-team-per-(worker,date) rule. Actions
// validate shape, relay to the RPC, and map its errors to Thai for the SA.

import "server-only";

import { revalidatePath } from "next/cache";
import type { Database } from "@/lib/db/database.types";
import { getActionUser, NOT_SIGNED_IN } from "@/lib/auth/action-gate";
import { UUID_REGEX } from "@/lib/validate/uuid";
import { ISO_DATE_REGEX } from "@/lib/dates";

type MusterMethod = Database["public"]["Enums"]["muster_method"];
type MusterSession = Database["public"]["Enums"]["muster_session"];
type MusterTeamKind = Database["public"]["Enums"]["muster_team_kind"];

const GENERIC = "เช็คชื่อไม่สำเร็จ กรุณาลองใหม่อีกครั้ง";

export type MusterResult =
  | { ok: true; id: string }
  // Spec 306 §5 — `reason` lets a caller tell a BENIGN refusal from a real one
  // without substring-matching Thai copy in a component. `already_out` means the
  // session was closed before this call: the write did not happen, but the state
  // the caller wanted is the state that exists, so a red chip and an error sound
  // would misdescribe it. Everything else stays an ordinary failure.
  | { ok: false; error: string; reason?: "already_out" };
export type MusterVoidResult = { ok: true } | { ok: false; error: string };

function scanErrorToThai(message: string): string {
  // Spec 397 U4 — the office team has NO lead, so it cannot be named the way a
  // crew is ("อยู่ในทีมของ <หัวหน้า>"). Without this arm the RPC's own office
  // message falls through to the generic and the SA is told the worker is "in
  // another team" with nothing to go on. ⚠️ Must stay ABOVE the `already in team
  // of` arm: this mapper is ordered substring matching.
  if (message.includes("already in the office team")) {
    return "คนนี้เช็คชื่อในทีมสำนักงานแล้ววันนี้";
  }
  // The worker is already mustered on another team today (scan-in) — the RPC
  // reveals the other lead's name only inside the caller's visibility.
  if (message.includes("already in team of")) {
    const lead = message
      .split("already in team of")[1]
      ?.replace(/today.*/, "")
      .trim();
    return lead ? `ช่างคนนี้อยู่ในทีมของ ${lead} แล้ววันนี้` : "ช่างคนนี้อยู่ในทีมอื่นแล้ววันนี้";
  }
  if (message.includes("mustered elsewhere") || message.includes("concurrent")) {
    return "ช่างคนนี้อยู่ในทีมอื่นแล้ววันนี้";
  }
  // Spec 306 §5 — muster_scan_out now REFUSES an already-out worker instead of
  // overwriting their real departure (and, for an ot session, re-pricing it).
  //
  // ⚠️ This arm must stay ABOVE the `no attendance` one below. That arm answers
  // ยังไม่ได้เช็คชื่อ — "this worker never checked IN" — which is the opposite claim,
  // and the RPC's message for this refusal is
  // `muster_scan_out: already checked out at HH:MM`. The two do not overlap
  // today, but the mapper is ordered substring matching and a reword could make
  // them, so the position is deliberate. The wording is pinned in pgTAP.
  //
  // The time comes back in the message because "nothing happened" is not an
  // answer: the SA needs to know the worker already went out, and when, to tell
  // a duplicate tap apart from a genuinely wrong record.
  if (message.includes("already checked out")) {
    const at = message.split("already checked out at")[1]?.trim();
    return at ? `ช่างคนนี้ออกงานแล้วเมื่อ ${at} น.` : "ช่างคนนี้ออกงานแล้ว";
  }
  // Spec 400 U4 — muster_scan_out now refuses a session whose day is over.
  //
  // ⚠️ Must stay ABOVE `no attendance`: that arm answers ยังไม่ได้เช็คชื่อ ("this
  // worker never checked IN"), a different claim, and this mapper is ordered
  // substring matching. It is below `already checked out` because that refusal is
  // more specific and carries a `reason` two components branch on.
  //
  // Why the copy exists at all: the refusal is PERMANENT for this caller, so the
  // GENERIC fallback ("กรุณาลองใหม่อีกครั้ง") would invite a retry that can never
  // succeed. The RPC previously had no date check, so an SA could stamp now() on
  // 2026-07-24's still-open OT sessions and price ~13 days of overtime.
  //
  // It names a FACT and no actor: the readers are muster_scan_out's whole gate —
  // {site_admin, super_admin, procurement_manager} — and only the last two are in
  // the correction audience, so "ask X" would be true for some and false for the
  // rest. It also must not name /team/attendance, which site_admin cannot open
  // (not in ATTENDANCE_AUDIT_ROLES). Same reasoning as undoErrorToThai's
  // `already closed` arm.
  if (message.includes("belongs to an earlier day")) {
    return "หมดเวลาบันทึกออกงานของวันนั้นแล้ว — ต้องแก้เวลาย้อนหลัง";
  }
  // Spec 351 — an OT scan-in without the worker's regular session on this team.
  if (message.includes("no regular session")) return "ต้องเช็คชื่อเข้างานปกติในทีมนี้ก่อนทำ OT";
  if (message.includes("no attendance")) return "ยังไม่ได้เช็คชื่อเข้าของช่างคนนี้";
  // move_muster_worker guards (spec 306 move UI).
  if (message.includes("cannot move across projects")) return "ย้ายข้ามโครงการไม่ได้";
  if (message.includes("target team is not for this date")) return "ทีมปลายทางไม่ใช่ของวันนี้";
  if (message.includes("target team not found")) return "ไม่พบทีมปลายทาง";
  if (message.includes("another team")) return "ช่างอยู่คนละทีม — ต้องย้ายก่อน";
  if (message.includes("role not permitted")) return "ไม่มีสิทธิ์เช็คชื่อ";
  if (message.includes("not a member of this project")) return "ไม่มีสิทธิ์ในโครงการนี้";
  if (message.includes("unknown worker") || message.includes("unknown lead")) return "ไม่พบช่าง";
  return GENERIC;
}

// Spec 379 U2 (D7) — `muster_undo_scan`'s refusals get their OWN copy, and
// scanErrorToThai is deliberately not reused. Its `role not permitted` arm
// answers ไม่มีสิทธิ์เช็คชื่อ — "no permission to TAKE attendance" — which is a
// claim about the wrong action, and none of its arms tells the SA what to do
// next about a closed day or a booked wage. Each arm below therefore names the
// retraction and, where the SA cannot fix it herself, who can.
const UNDO_GENERIC = "ยกเลิกไม่สำเร็จ กรุณาลองใหม่อีกครั้ง";

function undoErrorToThai(message: string): string {
  if (message.includes("role not permitted")) return "ไม่มีสิทธิ์ยกเลิกการเช็คชื่อ";
  // Also the answer for a row in a project the caller cannot see: the RPC folds
  // can_see_project INTO the lookup so an invisible check-in reads as an absent
  // one, and this copy must not contradict that by implying it exists.
  if (message.includes("no check-in to undo")) return "ไม่พบการเช็คชื่อนี้ — อาจถูกยกเลิกไปแล้ว";
  // Spec 397 U3 gave this refusal a way out — reopen_muster_day — so "ยกเลิกไม่ได้"
  // is no longer true and the old copy sent the SA to a manager for nothing.
  // ⚠️ It deliberately does NOT name the surface: the reopen form lives on
  // /team/attendance, which `site_admin` (the main cockpit user) cannot open —
  // it is not in ATTENDANCE_AUDIT_ROLES — so naming it would repeat the
  // affordance-that-is-not-there defect one layer down. It states the
  // PRECONDITION, which is true for every reader; who can lift it is §9 Q7.
  if (message.includes("already closed"))
    return "ปิดวันแล้ว — ต้องเปิดวันนั้นอีกครั้งก่อนจึงจะยกเลิกรายการได้";
  if (message.includes("wages are already booked")) {
    return "บันทึกค่าแรงของรายการนี้แล้ว — ต้องแจ้งผู้จัดการให้แก้ไข";
  }
  // The one refusal the SA can clear herself — the OT round carries its own
  // undo control, so this instruction points at something that exists.
  if (message.includes("undo the OT session first")) return "ต้องยกเลิก OT ของช่างคนนี้ก่อน";
  return UNDO_GENERIC;
}

/**
 * Spec 379 U2 — retract ONE worker's check-in for a (date, session). The RPC
 * owns every guard (role parity with muster_scan_in/_out + can_see_project,
 * day-not-closed, no current wage row, no surviving OT session under a regular
 * retraction) and writes the whole deleted row to audit_log before deleting it.
 */
export async function undoMusterScan(input: {
  workerId: string;
  date: string;
  session: MusterSession;
  revalidate: string;
}): Promise<MusterVoidResult> {
  if (
    !UUID_REGEX.test(input.workerId) ||
    !ISO_DATE_REGEX.test(input.date) ||
    !input.revalidate.startsWith("/")
  ) {
    return { ok: false, error: UNDO_GENERIC };
  }
  const auth = await getActionUser();
  if (!auth) return { ok: false, error: NOT_SIGNED_IN };

  const { error } = await auth.supabase.rpc("muster_undo_scan", {
    p_worker: input.workerId,
    p_date: input.date,
    p_session: input.session,
  });
  if (error) return { ok: false, error: undoErrorToThai(error.message) };
  revalidatePath(input.revalidate);
  return { ok: true };
}

/**
 * Spec 397 U5 — `kind` defaults to `crew`, so every existing caller is unchanged.
 *
 * The lead requirement is PER KIND, mirroring the RPC's own guard: a crew team
 * groups the cockpit board by its lead and must have one, while an office team is
 * legitimately leadless (there are no `site_owner` users yet, and a team that
 * cannot open until an appointment lands is a team nobody can check into). A
 * non-null lead is still shape-validated for both — `null` is allowed, garbage is
 * not.
 */
export async function openMusterTeam(input: {
  projectId: string;
  date: string;
  leadWorkerId: string | null;
  kind?: MusterTeamKind;
  revalidate: string;
}): Promise<MusterResult> {
  const kind: MusterTeamKind = input.kind ?? "crew";
  const leadShapeOk =
    input.leadWorkerId === null ? kind === "office" : UUID_REGEX.test(input.leadWorkerId);
  if (
    !UUID_REGEX.test(input.projectId) ||
    !leadShapeOk ||
    !ISO_DATE_REGEX.test(input.date) ||
    !input.revalidate.startsWith("/")
  ) {
    return { ok: false, error: GENERIC };
  }
  const auth = await getActionUser();
  if (!auth) return { ok: false, error: NOT_SIGNED_IN };

  // ⚠️ The generator types `p_lead_worker` as a bare `string` because the argument
  // carries no SQL DEFAULT — it cannot express "nullable uuid argument". The
  // function itself accepts NULL and enforces the real rule per kind
  // (`muster_teams_crew_has_lead` + its own P0001). Narrowed through `unknown`
  // with that reason rather than widened with `any`, and the null path is pinned
  // in office-team-open.test.ts.
  const args = {
    p_project: input.projectId,
    p_date: input.date,
    p_lead_worker: input.leadWorkerId,
    p_kind: kind,
  } as unknown as Database["public"]["Functions"]["open_muster_team"]["Args"];
  const { data, error } = await auth.supabase.rpc("open_muster_team", args);
  if (error) return { ok: false, error: scanErrorToThai(error.message) };
  revalidatePath(input.revalidate);
  return { ok: true, id: data as string };
}

export async function musterScan(input: {
  teamId: string;
  workerId: string;
  mode: "in" | "out";
  method: MusterMethod;
  // Spec 351 — which session this scan belongs to (regular hours vs OT).
  session: MusterSession;
  revalidate: string;
}): Promise<MusterResult> {
  if (
    !UUID_REGEX.test(input.teamId) ||
    !UUID_REGEX.test(input.workerId) ||
    !input.revalidate.startsWith("/")
  ) {
    return { ok: false, error: GENERIC };
  }
  const auth = await getActionUser();
  if (!auth) return { ok: false, error: NOT_SIGNED_IN };

  const { data, error } = await auth.supabase.rpc(
    input.mode === "in" ? "muster_scan_in" : "muster_scan_out",
    {
      p_team: input.teamId,
      p_worker: input.workerId,
      p_method: input.method,
      p_session: input.session,
    },
  );
  if (error) {
    // Spec 306 §5 — flag the benign refusal at the seam that still has the RAW
    // SQLSTATE message, so no caller has to match Thai copy to recognise it.
    const alreadyOut = error.message.includes("already checked out");
    return {
      ok: false,
      error: scanErrorToThai(error.message),
      ...(alreadyOut ? { reason: "already_out" as const } : {}),
    };
  }
  revalidatePath(input.revalidate);
  return { ok: true, id: data as string };
}

/**
 * Spec 306 close-day cure (operator 2026-07-26) — close every OT session the SA
 * still has open, right now, so ปิดวัน never has to lose one.
 *
 * Why this exists: `close_muster_day` auto-outs REGULAR sessions only, so an OT
 * left open at close keeps `ot_hours` NULL forever, and `muster_scan_out` prices
 * the span from `now()` — closing it tomorrow would bill garbage. 07-24 lost nine
 * of them that way. The confirm therefore offers this instead of a bare warning.
 *
 * The list comes from the CLIENT because the board it is looking at is the same
 * board the SA is: forging it buys nothing, since `muster_scan_out` re-checks the
 * role, project membership and the worker's team on every single call. Every id
 * is validated BEFORE the first write, so a malformed list writes nothing rather
 * than half-closing the day's OT.
 */
export async function closeOpenOt(input: {
  sessions: { teamId: string; workerId: string }[];
  revalidate: string;
}): Promise<{ ok: true; closed: number } | { ok: false; error: string }> {
  if (!input.revalidate.startsWith("/")) return { ok: false, error: GENERIC };
  if (input.sessions.some((s) => !UUID_REGEX.test(s.teamId) || !UUID_REGEX.test(s.workerId))) {
    return { ok: false, error: GENERIC };
  }
  if (input.sessions.length === 0) return { ok: true, closed: 0 };

  const auth = await getActionUser();
  if (!auth) return { ok: false, error: NOT_SIGNED_IN };

  // Sequential, not parallel: these are money writes and a shared-pooler burst of
  // ~20 DEFINER calls is how the pgTAP "failed to connect as temp role" transients
  // happen. A partial close must be REPORTED, never rounded up to success — the
  // caller only closes the day when every OT actually closed.
  let closed = 0;
  for (const s of input.sessions) {
    const { error } = await auth.supabase.rpc("muster_scan_out", {
      p_team: s.teamId,
      p_worker: s.workerId,
      p_method: "manual" satisfies MusterMethod,
      p_session: "ot" satisfies MusterSession,
    });
    // Spec 306 §5 — an ALREADY-CLOSED session is not a failure of this cure.
    //
    // The cure's postcondition is "no OT is left open", and a session someone
    // else (or this SA's own earlier partial run) already closed satisfies it.
    // The session list comes from the CLIENT's board, which refreshes only on
    // sheet close, so a stale `true` here is the NORMAL state after a partial
    // cure — and before muster_scan_out learned to refuse, this call silently
    // succeeded. Treating the refusal as an error would make the retry after a
    // partial cure fail on the sessions that already worked, and ปิดวัน is the
    // one action the 07-24 incident exists to protect: closing is recoverable,
    // NOT closing is not.
    //
    // It is NOT counted as `closed` — that number reports what this call did,
    // and a caller comparing it against the list it sent must be able to see
    // the difference.
    if (error && !error.message.includes("already checked out")) {
      revalidatePath(input.revalidate);
      return { ok: false, error: scanErrorToThai(error.message) };
    }
    if (!error) closed += 1;
  }
  revalidatePath(input.revalidate);
  return { ok: true, closed };
}

export async function setMusterTeamWps(input: {
  teamId: string;
  wpIds: string[];
  revalidate: string;
}): Promise<MusterVoidResult> {
  if (
    !UUID_REGEX.test(input.teamId) ||
    input.wpIds.some((id) => !UUID_REGEX.test(id)) ||
    !input.revalidate.startsWith("/")
  ) {
    return { ok: false, error: GENERIC };
  }
  const auth = await getActionUser();
  if (!auth) return { ok: false, error: NOT_SIGNED_IN };

  const { error } = await auth.supabase.rpc("set_muster_team_wps", {
    p_team: input.teamId,
    p_wp_ids: input.wpIds,
  });
  if (error) return { ok: false, error: scanErrorToThai(error.message) };
  revalidatePath(input.revalidate);
  return { ok: true };
}

// Spec 306 (deferred move UI, 2026-07-19; UI removed by spec 357 U-E — kept as
// the future OT-team-change substrate) — day-of correction: move a worker's
// attendance to another team on the SAME date. move_muster_worker owns the
// guards (SA/super/procurement_manager per spec 348 + can_see_project,
// same-date team, same-project, attendance exists, no-op when already there)
// and audits crew_change/muster_move.
export async function moveMusterWorker(input: {
  workerId: string;
  date: string;
  toTeamId: string;
  revalidate: string;
}): Promise<MusterResult> {
  if (
    !UUID_REGEX.test(input.workerId) ||
    !UUID_REGEX.test(input.toTeamId) ||
    !ISO_DATE_REGEX.test(input.date) ||
    !input.revalidate.startsWith("/")
  ) {
    return { ok: false, error: GENERIC };
  }
  const auth = await getActionUser();
  if (!auth) return { ok: false, error: NOT_SIGNED_IN };

  const { data, error } = await auth.supabase.rpc("move_muster_worker", {
    p_worker: input.workerId,
    p_date: input.date,
    p_to_team: input.toTeamId,
  });
  if (error) return { ok: false, error: scanErrorToThai(error.message) };
  revalidatePath(input.revalidate);
  return { ok: true, id: data as string };
}

// Spec 306 U4 — ปิดวัน (close the muster day). close_muster_day auto-outs any
// still-in worker at the 17:00 day-end (out_auto=true, never before their in_at)
// and records the closure; it is idempotent (a re-close after a late scan
// re-stamps). Money (labor cost derivation) is U5 and keys off this closure.
export async function closeMusterDay(input: {
  projectId: string;
  date: string;
  revalidate: string;
}): Promise<MusterVoidResult> {
  if (
    !UUID_REGEX.test(input.projectId) ||
    !ISO_DATE_REGEX.test(input.date) ||
    !input.revalidate.startsWith("/")
  ) {
    return { ok: false, error: GENERIC };
  }
  const auth = await getActionUser();
  if (!auth) return { ok: false, error: NOT_SIGNED_IN };

  const { error } = await auth.supabase.rpc("close_muster_day", {
    p_project: input.projectId,
    p_date: input.date,
  });
  if (error) return { ok: false, error: scanErrorToThai(error.message) };
  revalidatePath(input.revalidate);
  return { ok: true };
}

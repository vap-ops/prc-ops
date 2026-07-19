"use server";

// Spec 306 U3 — muster cockpit actions. Authorization is the DB's: the muster
// RPCs (open_muster_team / muster_scan_in / muster_scan_out / set_muster_team_wps)
// are SECURITY DEFINER, gate on current_user_role() ∈ (site_admin, super_admin) +
// can_see_project, and enforce the one-team-per-(worker,date) rule. Actions
// validate shape, relay to the RPC, and map its errors to Thai for the SA.

import "server-only";

import { revalidatePath } from "next/cache";
import type { Database } from "@/lib/db/database.types";
import { getActionUser, NOT_SIGNED_IN } from "@/lib/auth/action-gate";
import { UUID_REGEX } from "@/lib/validate/uuid";
import { ISO_DATE_REGEX } from "@/lib/dates";

type MusterMethod = Database["public"]["Enums"]["muster_method"];

const GENERIC = "เช็คชื่อไม่สำเร็จ กรุณาลองใหม่อีกครั้ง";

export type MusterResult = { ok: true; id: string } | { ok: false; error: string };
export type MusterVoidResult = { ok: true } | { ok: false; error: string };

function scanErrorToThai(message: string): string {
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

export async function openMusterTeam(input: {
  projectId: string;
  date: string;
  leadWorkerId: string;
  revalidate: string;
}): Promise<MusterResult> {
  if (
    !UUID_REGEX.test(input.projectId) ||
    !UUID_REGEX.test(input.leadWorkerId) ||
    !ISO_DATE_REGEX.test(input.date) ||
    !input.revalidate.startsWith("/")
  ) {
    return { ok: false, error: GENERIC };
  }
  const auth = await getActionUser();
  if (!auth) return { ok: false, error: NOT_SIGNED_IN };

  const { data, error } = await auth.supabase.rpc("open_muster_team", {
    p_project: input.projectId,
    p_date: input.date,
    p_lead_worker: input.leadWorkerId,
  });
  if (error) return { ok: false, error: scanErrorToThai(error.message) };
  revalidatePath(input.revalidate);
  return { ok: true, id: data as string };
}

export async function musterScan(input: {
  teamId: string;
  workerId: string;
  mode: "in" | "out";
  method: MusterMethod;
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
    { p_team: input.teamId, p_worker: input.workerId, p_method: input.method },
  );
  if (error) return { ok: false, error: scanErrorToThai(error.message) };
  revalidatePath(input.revalidate);
  return { ok: true, id: data as string };
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

// Spec 306 (deferred move UI, 2026-07-19) — day-of correction: move a worker's
// attendance to another team on the SAME date. move_muster_worker owns the
// guards (SA/super + can_see_project, same-date team, same-project, attendance
// exists, no-op when already there) and audits crew_change/muster_move.
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

"use server";

// Spec 298 U2 — the SA's no-phone add: the client uploads a passbook photo to the
// walled sa-bank-capture/ store first, then this relays {identity + photoPath} to the
// sa_add_project_worker_with_bank DEFINER RPC (gates site_admin|super_admin +
// can_see_project, validates Thai national-ID + age + dedup + the photo path, creates
// the phoneless worker + a pending_pm capture with NO money set). Validates shape and
// maps the RPC's errors to Thai. (The plain sa_add_project_worker RPC — spec 279 U4 —
// remains, exercised by pgTAP 281; its client action was retired with the inline form.)

import "server-only";
import { revalidatePath } from "next/cache";
import { getActionUser, NOT_SIGNED_IN } from "@/lib/auth/action-gate";
import { UUID_REGEX } from "@/lib/validate/uuid";

const GENERIC = "เพิ่มช่างไม่สำเร็จ กรุณาลองใหม่อีกครั้ง";

// Field bug 2026-07-27: the caller now CONFIRMS the add in place, so it needs the
// receipt the SA can quote later — the generated employee_id. `null` when the
// follow-up read comes back empty; the confirmation degrades to the name alone
// rather than failing an add that already committed.
export type AddProjectWorkerResult =
  | { ok: true; employeeId: string | null }
  | { ok: false; error: string };

function rpcErrorToThai(message: string): string {
  if (message.includes("invalid Thai national-ID")) return "เลขบัตรประชาชนไม่ถูกต้อง (13 หลัก)";
  if (message.includes("at least 18")) return "ต้องอายุอย่างน้อย 18 ปี";
  if (message.includes("already on a worker") || message.includes("already a pending"))
    return "เลขบัตรนี้มีอยู่แล้วในระบบ";
  if (message.includes("not a member") || message.includes("not permitted"))
    return "ไม่มีสิทธิ์เพิ่มช่างในโครงการนี้";
  if (message.includes("name required")) return "กรุณากรอกชื่อ";
  if (message.includes("passbook photo is required")) return "กรุณาถ่ายรูปสมุดบัญชี";
  return GENERIC;
}

// Spec 298 U2 — the no-phone add that carries a REQUIRED capture-blind passbook
// photo. The client uploads the photo to the walled sa-bank-capture/ path first
// (unreadable back to the SA), then this relays {identity + photoPath} to the
// DEFINER RPC sa_add_project_worker_with_bank, which creates the phoneless worker
// AND a pending_pm worker_bank_capture row atomically. A PM later transcribes the
// photo into workers.bank_* (spec 298 U3). The SA sets no bank + no pay (ADR 0079).
export async function addProjectWorkerWithBank(input: {
  projectId: string;
  name: string;
  nationalId: string;
  dob: string;
  photoPath: string;
}): Promise<AddProjectWorkerResult> {
  if (!UUID_REGEX.test(input.projectId)) return { ok: false, error: GENERIC };
  if (!/^\d{13}$/.test(input.nationalId))
    return { ok: false, error: "เลขบัตรประชาชนไม่ถูกต้อง (13 หลัก)" };
  if (!input.dob) return { ok: false, error: "กรุณากรอกวันเกิด" };
  if (!input.photoPath || !input.photoPath.startsWith("sa-bank-capture/"))
    return { ok: false, error: "กรุณาถ่ายรูปสมุดบัญชี" };

  const auth = await getActionUser();
  if (!auth) return { ok: false, error: NOT_SIGNED_IN };
  const { supabase } = auth;

  const { data: workerId, error } = await supabase.rpc("sa_add_project_worker_with_bank", {
    p_project: input.projectId,
    p_name: input.name,
    p_national_id: input.nationalId,
    p_dob: input.dob,
    p_photo_path: input.photoPath,
  });
  if (error) return { ok: false, error: rpcErrorToThai(error.message) };

  // The RPC returns the new worker's id; its employee_id is minted inside, so read
  // it back for the confirmation. Best-effort by design — the worker exists either
  // way, and reporting a failed add over a committed one is the worse lie.
  let employeeId: string | null = null;
  if (typeof workerId === "string") {
    try {
      const { data: row } = await supabase
        .from("workers")
        .select("employee_id")
        .eq("id", workerId)
        .maybeSingle();
      employeeId = row?.employee_id ?? null;
    } catch {
      employeeId = null;
    }
  }

  revalidatePath("/sa/crew");
  return { ok: true, employeeId };
}

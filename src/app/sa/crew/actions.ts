"use server";

// Spec 279 U4 — the SA's direct "เพิ่มเอง" add: relays to the sa_add_project_worker
// DEFINER RPC (which gates site_admin|super_admin + can_see_project, validates the
// Thai national-ID + age + dedup, and creates the worker with NO money set). The
// action validates shape and maps the RPC's errors to Thai.

import "server-only";
import { revalidatePath } from "next/cache";
import { getActionUser, NOT_SIGNED_IN } from "@/lib/auth/action-gate";
import { UUID_REGEX } from "@/lib/validate/uuid";

const GENERIC = "เพิ่มช่างไม่สำเร็จ กรุณาลองใหม่อีกครั้ง";

export type AddProjectWorkerResult = { ok: true } | { ok: false; error: string };

function rpcErrorToThai(message: string): string {
  if (message.includes("invalid Thai national-ID")) return "เลขบัตรประชาชนไม่ถูกต้อง (13 หลัก)";
  if (message.includes("at least 18")) return "ต้องอายุอย่างน้อย 18 ปี";
  if (message.includes("already on a worker") || message.includes("already a pending"))
    return "เลขบัตรนี้มีอยู่แล้วในระบบ";
  if (message.includes("not a member") || message.includes("not permitted"))
    return "ไม่มีสิทธิ์เพิ่มช่างในโครงการนี้";
  if (message.includes("name required")) return "กรุณากรอกชื่อ";
  return GENERIC;
}

export async function addProjectWorker(input: {
  projectId: string;
  name: string;
  nationalId: string;
  dob: string;
}): Promise<AddProjectWorkerResult> {
  if (!UUID_REGEX.test(input.projectId)) return { ok: false, error: GENERIC };
  if (!/^\d{13}$/.test(input.nationalId))
    return { ok: false, error: "เลขบัตรประชาชนไม่ถูกต้อง (13 หลัก)" };
  if (!input.dob) return { ok: false, error: "กรุณากรอกวันเกิด" };

  const auth = await getActionUser();
  if (!auth) return { ok: false, error: NOT_SIGNED_IN };
  const { supabase } = auth;

  const { error } = await supabase.rpc("sa_add_project_worker", {
    p_project: input.projectId,
    p_name: input.name,
    p_national_id: input.nationalId,
    p_dob: input.dob,
  });
  if (error) return { ok: false, error: rpcErrorToThai(error.message) };

  revalidatePath("/sa/crew");
  return { ok: true };
}

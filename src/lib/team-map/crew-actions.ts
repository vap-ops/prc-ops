"use server";

// Spec 330 U3b — crew manage actions for the per-project team map.
// Authorization is the DB's: every crew RPC is SECURITY DEFINER and gates on
// is_back_office (the create_crew family's own audience — see mig 075817), and
// the spec-328 §2.4 money wall lives in Postgres too (function arms + triggers,
// mig 075818). These actions validate shape, relay to the RPC, and map its
// errors to Thai — the same division of labour as spec 306's muster actions.

import "server-only";

import { revalidatePath } from "next/cache";

import { getActionUser, NOT_SIGNED_IN } from "@/lib/auth/action-gate";
import { UUID_REGEX } from "@/lib/validate/uuid";

const GENERIC = "จัดการทีมช่างไม่สำเร็จ กรุณาลองใหม่อีกครั้ง";

// The DB's own bound (crews.name check) — mirrored client-side so the user
// gets a Thai message instead of a raw 23514.
const NAME_MAX = 80;

export type CrewResult = { ok: true; id: string } | { ok: false; error: string };

function crewErrorToThai(message: string): string {
  // Spec 330 U3a money wall — the arm a PM actually meets: a subcon member is
  // paid by their firm, so they can never enter the crew graph (which feeds
  // the plan → mark-present → labor_logs → payroll chain).
  if (message.includes("pay-exempt")) {
    return "ช่างของผู้รับเหมาไม่สามารถอยู่ในทีมช่างได้ (ผู้รับเหมาเป็นผู้จ่ายค่าแรงเอง)";
  }
  if (message.includes("not authorized")) return "ไม่มีสิทธิ์จัดการทีมช่าง";
  if (message.includes("crew is dissolved") || message.includes("target crew is dissolved")) {
    return "ทีมนี้ถูกยุบแล้ว";
  }
  if (message.includes("worker not found") || message.includes("lead worker not found")) {
    return "ไม่พบช่าง หรือช่างไม่ได้ทำงานอยู่";
  }
  if (message.includes("belongs to another project")) return "ช่างอยู่คนละโครงการกับทีมนี้";
  if (message.includes("not an active member of the source crew")) {
    return "ช่างไม่ได้อยู่ในทีมต้นทาง";
  }
  if (message.includes("not an active member of this crew")) return "ช่างไม่ได้อยู่ในทีมนี้";
  if (message.includes("lead must be an active member")) {
    return "หัวหน้าทีมต้องเป็นสมาชิกของทีมนี้ก่อน";
  }
  if (message.includes("name must not be blank")) return "ต้องตั้งชื่อทีม";
  if (message.includes("concurrent")) return "มีการแก้ไขพร้อมกัน กรุณาลองใหม่อีกครั้ง";
  if (message.includes("crew not found") || message.includes("target crew not found")) {
    return "ไม่พบทีม";
  }
  if (message.includes("invalid crew kind")) return "ประเภททีมไม่ถูกต้อง";
  return GENERIC;
}

// Shape checks run BEFORE the auth gate (muster precedent): a malformed call
// never reaches the session or the database.
function badShape(revalidate: string, ...ids: string[]): boolean {
  return !revalidate.startsWith("/") || ids.some((id) => !UUID_REGEX.test(id));
}

function cleanName(name: string): string | null {
  const trimmed = name.trim();
  if (trimmed === "" || trimmed.length > NAME_MAX) return null;
  return trimmed;
}

async function relay(
  rpc: "add_worker_to_crew" | "remove_worker_from_crew" | "set_crew_lead",
  args: { p_crew: string; p_worker: string },
  revalidate: string,
): Promise<CrewResult> {
  const auth = await getActionUser();
  if (!auth) return { ok: false, error: NOT_SIGNED_IN };
  const { data, error } = await auth.supabase.rpc(rpc, args);
  if (error) return { ok: false, error: crewErrorToThai(error.message) };
  revalidatePath(revalidate);
  return { ok: true, id: String(data) };
}

export async function addWorkerToCrew(input: {
  crewId: string;
  workerId: string;
  revalidate: string;
}): Promise<CrewResult> {
  if (badShape(input.revalidate, input.crewId, input.workerId)) {
    return { ok: false, error: GENERIC };
  }
  return relay(
    "add_worker_to_crew",
    { p_crew: input.crewId, p_worker: input.workerId },
    input.revalidate,
  );
}

export async function removeWorkerFromCrew(input: {
  crewId: string;
  workerId: string;
  revalidate: string;
}): Promise<CrewResult> {
  if (badShape(input.revalidate, input.crewId, input.workerId)) {
    return { ok: false, error: GENERIC };
  }
  return relay(
    "remove_worker_from_crew",
    { p_crew: input.crewId, p_worker: input.workerId },
    input.revalidate,
  );
}

export async function setCrewLead(input: {
  crewId: string;
  workerId: string;
  revalidate: string;
}): Promise<CrewResult> {
  if (badShape(input.revalidate, input.crewId, input.workerId)) {
    return { ok: false, error: GENERIC };
  }
  return relay(
    "set_crew_lead",
    { p_crew: input.crewId, p_worker: input.workerId },
    input.revalidate,
  );
}

export async function moveWorkerBetweenCrews(input: {
  fromCrewId: string;
  toCrewId: string;
  workerId: string;
  revalidate: string;
}): Promise<CrewResult> {
  if (badShape(input.revalidate, input.fromCrewId, input.toCrewId, input.workerId)) {
    return { ok: false, error: GENERIC };
  }
  const auth = await getActionUser();
  if (!auth) return { ok: false, error: NOT_SIGNED_IN };
  const { data, error } = await auth.supabase.rpc("move_worker_between_crews", {
    p_from: input.fromCrewId,
    p_to: input.toCrewId,
    p_worker: input.workerId,
  });
  if (error) return { ok: false, error: crewErrorToThai(error.message) };
  revalidatePath(input.revalidate);
  return { ok: true, id: String(data) };
}

export async function createCrew(input: {
  projectId: string;
  name: string;
  revalidate: string;
}): Promise<CrewResult> {
  const name = cleanName(input.name);
  if (badShape(input.revalidate, input.projectId) || name === null) {
    return { ok: false, error: input.name.trim() === "" ? "ต้องตั้งชื่อทีม" : GENERIC };
  }
  const auth = await getActionUser();
  if (!auth) return { ok: false, error: NOT_SIGNED_IN };
  // p_lead_worker is deliberately omitted: a crew's lead must be one of its
  // members (set_crew_lead), and a brand-new crew has none yet.
  const { data, error } = await auth.supabase.rpc("create_crew", {
    p_project: input.projectId,
    p_name: name,
  });
  if (error) return { ok: false, error: crewErrorToThai(error.message) };
  revalidatePath(input.revalidate);
  return { ok: true, id: String(data) };
}

export async function renameCrew(input: {
  crewId: string;
  name: string;
  revalidate: string;
}): Promise<CrewResult> {
  const name = cleanName(input.name);
  if (badShape(input.revalidate, input.crewId) || name === null) {
    return { ok: false, error: input.name.trim() === "" ? "ต้องตั้งชื่อทีม" : GENERIC };
  }
  const auth = await getActionUser();
  if (!auth) return { ok: false, error: NOT_SIGNED_IN };
  const { data, error } = await auth.supabase.rpc("rename_crew", {
    p_crew: input.crewId,
    p_name: name,
  });
  if (error) return { ok: false, error: crewErrorToThai(error.message) };
  revalidatePath(input.revalidate);
  return { ok: true, id: String(data) };
}

export async function dissolveCrew(input: {
  crewId: string;
  revalidate: string;
}): Promise<CrewResult> {
  if (badShape(input.revalidate, input.crewId)) return { ok: false, error: GENERIC };
  const auth = await getActionUser();
  if (!auth) return { ok: false, error: NOT_SIGNED_IN };
  const { data, error } = await auth.supabase.rpc("dissolve_crew", { p_crew: input.crewId });
  if (error) return { ok: false, error: crewErrorToThai(error.message) };
  revalidatePath(input.revalidate);
  return { ok: true, id: String(data) };
}

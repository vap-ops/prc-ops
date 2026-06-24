"use server";

// Spec 46 P1 — worker roster actions (/workers, pm/super). The RPCs
// are SECURITY DEFINER and gate on current_user_role() themselves —
// these actions validate shape and relay. Rates flow ONLY through
// these calls; the workers.day_rate column has no authenticated grant.

import "server-only";

import { revalidatePath } from "next/cache";
import { createClient as createServerSupabase } from "@/lib/db/server";
import type { Database } from "@/lib/db/database.types";
import { UUID_REGEX } from "@/lib/validate/uuid";
import { validateNotes } from "@/lib/notes/validate";

type WorkerType = Database["public"]["Enums"]["worker_type"];
type DcArrangement = Database["public"]["Enums"]["dc_arrangement"];

const GENERIC_ERROR = "บันทึกทีมงานไม่สำเร็จ กรุณาลองใหม่อีกครั้ง";

export type WorkerActionResult = { ok: true } | { ok: false; error: string };

function validName(name: string): boolean {
  const trimmed = name.trim();
  return trimmed.length > 0 && trimmed.length <= 120;
}

function validRate(rate: number): boolean {
  return Number.isFinite(rate) && rate >= 0;
}

// ADR 0062 U1: a DC is a self-sufficient worker — arrangement + payee fields.
export interface WorkerPayeeInput {
  arrangement?: DcArrangement | null;
  phone?: string;
  taxId?: string;
  bankName?: string;
  bankAccountNumber?: string;
  bankAccountName?: string;
}

const clean = (v: string | undefined): string | undefined => {
  const t = v?.trim();
  return t ? t : undefined;
};

// Only forward DC payee/arrangement params that carry a value (DC workers only —
// the RPC rejects an arrangement on a non-dc worker).
function payeeRpcParams(workerType: WorkerType, input: WorkerPayeeInput) {
  if (workerType !== "dc") return {};
  const phone = clean(input.phone);
  const taxId = clean(input.taxId);
  const bankName = clean(input.bankName);
  const bankAccountNumber = clean(input.bankAccountNumber);
  const bankAccountName = clean(input.bankAccountName);
  return {
    ...(input.arrangement ? { p_arrangement: input.arrangement } : {}),
    ...(phone ? { p_phone: phone } : {}),
    ...(taxId ? { p_tax_id: taxId } : {}),
    ...(bankName ? { p_bank_name: bankName } : {}),
    ...(bankAccountNumber ? { p_bank_account_number: bankAccountNumber } : {}),
    ...(bankAccountName ? { p_bank_account_name: bankAccountName } : {}),
  };
}

export async function createWorker(
  input: {
    name: string;
    workerType: WorkerType;
    dayRate: number;
    // Legacy: a subcontractor's crew member is a worker tied to the contractor
    // (contact-crew-section). A directly-hired DC worker has no parent (ADR 0062).
    contractorId?: string | null;
    // Spec 75: optional roster note.
    note?: string;
    // Spec 200 U2: optionally put the new worker on a project at creation (a
    // create + assign — reuses assign_worker_to_project, no new RPC).
    projectId?: string | null;
  } & WorkerPayeeInput,
): Promise<WorkerActionResult> {
  if (!validName(input.name) || !validRate(input.dayRate)) {
    return { ok: false, error: GENERIC_ERROR };
  }
  const noteResult = validateNotes(input.note ?? "");
  if (!noteResult.ok) return { ok: false, error: noteResult.error };
  const projectId = input.projectId && input.projectId !== "" ? input.projectId : null;
  if (projectId !== null && !UUID_REGEX.test(projectId)) return { ok: false, error: GENERIC_ERROR };

  const supabase = await createServerSupabase();
  const { data: workerId, error } = await supabase.rpc("create_worker", {
    p_name: input.name.trim(),
    p_type: input.workerType,
    p_day_rate: input.dayRate,
    ...(input.contractorId && UUID_REGEX.test(input.contractorId)
      ? { p_contractor: input.contractorId }
      : {}),
    ...(noteResult.value !== null ? { p_note: noteResult.value } : {}),
    ...payeeRpcParams(input.workerType, input),
  });
  if (error || !workerId) return { ok: false, error: GENERIC_ERROR };

  // Optional initial project assignment (the worker exists either way — a failed
  // assign is soft: it can be set from the row's edit sheet).
  if (projectId !== null) {
    const { error: assignError } = await supabase.rpc("assign_worker_to_project", {
      p_worker: workerId,
      p_project: projectId,
    });
    if (assignError) {
      revalidatePath("/workers");
      return { ok: false, error: "เพิ่มทีมงานแล้ว แต่กำหนดโครงการไม่สำเร็จ — กำหนดได้ในเมนูแก้ไข" };
    }
  }

  revalidatePath("/workers");
  return { ok: true };
}

export async function updateWorker(input: {
  id: string;
  name?: string;
  active?: boolean;
  // Spec 75: pass to set/clear the note ("" clears); omit to preserve it.
  note?: string;
}): Promise<WorkerActionResult> {
  if (!UUID_REGEX.test(input.id)) return { ok: false, error: GENERIC_ERROR };
  if (input.name !== undefined && !validName(input.name)) {
    return { ok: false, error: GENERIC_ERROR };
  }
  if (input.note !== undefined) {
    const noteResult = validateNotes(input.note);
    if (!noteResult.ok) return { ok: false, error: noteResult.error };
  }

  const supabase = await createServerSupabase();
  const { error } = await supabase.rpc("update_worker", {
    p_id: input.id,
    ...(input.name !== undefined ? { p_name: input.name.trim() } : {}),
    ...(input.active !== undefined ? { p_active: input.active } : {}),
    // Pass the raw value (incl. "") so the RPC can clear; omit to preserve.
    ...(input.note !== undefined ? { p_note: input.note } : {}),
  });
  if (error) return { ok: false, error: GENERIC_ERROR };

  revalidatePath("/workers");
  return { ok: true };
}

export async function setWorkerDayRate(input: {
  id: string;
  dayRate: number;
}): Promise<WorkerActionResult> {
  if (!UUID_REGEX.test(input.id) || !validRate(input.dayRate)) {
    return { ok: false, error: GENERIC_ERROR };
  }

  const supabase = await createServerSupabase();
  const { error } = await supabase.rpc("set_worker_day_rate", {
    p_id: input.id,
    p_rate: input.dayRate,
  });
  if (error) return { ok: false, error: GENERIC_ERROR };

  revalidatePath("/workers");
  return { ok: true };
}

// Spec 170 U4a / ADR 0062 — a PM issues a single-use, 14-day claim link a DC
// opens to bind their LINE login to this WORKER (the portal binds on
// workers.user_id, not a contractor party). create_worker_invite (SECURITY
// DEFINER, pm/super/director) mints the token; the UI wraps it into the
// /portal/claim URL. Relayed through the RLS session so the RPC gate resolves.
export type WorkerInviteResult = { ok: true; token: string } | { ok: false; error: string };

export async function createWorkerInvite(input: { workerId: string }): Promise<WorkerInviteResult> {
  if (!UUID_REGEX.test(input.workerId)) return { ok: false, error: GENERIC_ERROR };

  const supabase = await createServerSupabase();
  const { data, error } = await supabase.rpc("create_worker_invite", {
    p_worker: input.workerId,
  });
  if (error || !data) return { ok: false, error: GENERIC_ERROR };
  return { ok: true, token: data };
}

// Spec 200: assign a worker to a project (workers.project_id — one project at a
// time). Calls the assign_worker_to_project definer RPC (gate PM/super/director/
// procurement, append-only move trail). A null/"" project unassigns (the RPC's
// p_project defaults to null → cleared).
export async function assignWorkerToProject(input: {
  workerId: string;
  projectId: string | null;
}): Promise<WorkerActionResult> {
  if (!UUID_REGEX.test(input.workerId)) return { ok: false, error: GENERIC_ERROR };
  const projectId = input.projectId && input.projectId !== "" ? input.projectId : null;
  if (projectId !== null && !UUID_REGEX.test(projectId)) return { ok: false, error: GENERIC_ERROR };

  const supabase = await createServerSupabase();
  const { error } = await supabase.rpc("assign_worker_to_project", {
    p_worker: input.workerId,
    // Omit p_project to unassign (the RPC's default null clears project_id).
    ...(projectId !== null ? { p_project: projectId } : {}),
  });
  if (error) return { ok: false, error: GENERIC_ERROR };

  revalidatePath("/workers");
  return { ok: true };
}

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

type WorkerType = Database["public"]["Enums"]["worker_type"];

const GENERIC_ERROR = "บันทึกคนงานไม่สำเร็จ กรุณาลองใหม่อีกครั้ง";

export type WorkerActionResult = { ok: true } | { ok: false; error: string };

function validName(name: string): boolean {
  const trimmed = name.trim();
  return trimmed.length > 0 && trimmed.length <= 120;
}

function validRate(rate: number): boolean {
  return Number.isFinite(rate) && rate >= 0;
}

export async function createWorker(input: {
  name: string;
  workerType: WorkerType;
  dayRate: number;
  contractorId: string | null;
}): Promise<WorkerActionResult> {
  if (!validName(input.name) || !validRate(input.dayRate)) {
    return { ok: false, error: GENERIC_ERROR };
  }
  if (input.workerType === "dc" && !UUID_REGEX.test(input.contractorId ?? "")) {
    return { ok: false, error: "คนงาน DC ต้องเลือกผู้รับเหมา" };
  }

  const supabase = await createServerSupabase();
  const { error } = await supabase.rpc("create_worker", {
    p_name: input.name.trim(),
    p_type: input.workerType,
    p_day_rate: input.dayRate,
    ...(input.workerType === "dc" && input.contractorId
      ? { p_contractor: input.contractorId }
      : {}),
  });
  if (error) return { ok: false, error: GENERIC_ERROR };

  revalidatePath("/workers");
  return { ok: true };
}

export async function updateWorker(input: {
  id: string;
  name?: string;
  active?: boolean;
}): Promise<WorkerActionResult> {
  if (!UUID_REGEX.test(input.id)) return { ok: false, error: GENERIC_ERROR };
  if (input.name !== undefined && !validName(input.name)) {
    return { ok: false, error: GENERIC_ERROR };
  }

  const supabase = await createServerSupabase();
  const { error } = await supabase.rpc("update_worker", {
    p_id: input.id,
    ...(input.name !== undefined ? { p_name: input.name.trim() } : {}),
    ...(input.active !== undefined ? { p_active: input.active } : {}),
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

"use server";

// Spec 268 — /equipment/rentals server actions (MONEY, back office). Both
// writes go through the spec-146 SECURITY DEFINER RPCs — the real role gate
// (pm/super/procurement/procurement_manager/project_director) + validation +
// audit rows live in the DB; equipment_rental_batches /
// equipment_project_allocations are zero-grant tables with no other write
// path. requireRole(BACK_OFFICE_ROLES) here is defense-in-depth and matches
// the definer gates. The RLS server client carries the caller's session to
// the definer (the labor/usage-actions posture — never the admin client for
// writes).

import "server-only";

import { revalidatePath } from "next/cache";
import { createClient as createServerSupabase } from "@/lib/db/server";
import { requireRole } from "@/lib/auth/require-role";
import { BACK_OFFICE_ROLES } from "@/lib/auth/role-home";
import { UUID_REGEX } from "@/lib/validate/uuid";
import { validateRentalBatch } from "@/lib/equipment/validate-rental-batch";
import { validateAllocation } from "@/lib/equipment/validate-allocation";
import type { RentalRatePeriod } from "@/lib/equipment/rental-view";

const GENERIC_ERROR = "บันทึกการเช่าไม่สำเร็จ กรุณาลองใหม่อีกครั้ง";
const NO_PERMISSION = "ไม่มีสิทธิ์บันทึกการเช่าอุปกรณ์";

export type RentalActionResult = { ok: true } | { ok: false; error: string };

const RATE_PERIODS: ReadonlyArray<RentalRatePeriod> = ["monthly", "daily"];

export async function createRentalBatch(input: {
  supplierId: string;
  rate: number;
  ratePeriod: string;
  startsOn: string;
  endsOn: string | null;
  note: string;
  projectId: string | null;
  depositAmount: number;
  minRentalDays: number | null;
}): Promise<RentalActionResult> {
  await requireRole(BACK_OFFICE_ROLES);

  if (!UUID_REGEX.test(input.supplierId)) return { ok: false, error: "กรุณาเลือกผู้ให้เช่า" };
  if (!RATE_PERIODS.includes(input.ratePeriod as RentalRatePeriod)) {
    return { ok: false, error: GENERIC_ERROR };
  }
  const batch = validateRentalBatch({
    monthlyRate: input.rate,
    startsOn: input.startsOn,
    endsOn: input.endsOn,
  });
  if (!batch.ok) return batch;
  if (input.projectId !== null && !UUID_REGEX.test(input.projectId)) {
    return { ok: false, error: GENERIC_ERROR };
  }
  if (!Number.isFinite(input.depositAmount) || input.depositAmount < 0) {
    return { ok: false, error: GENERIC_ERROR };
  }
  if (
    input.minRentalDays !== null &&
    (!Number.isInteger(input.minRentalDays) || input.minRentalDays <= 0)
  ) {
    return { ok: false, error: GENERIC_ERROR };
  }
  const note = input.note.trim();
  if (note.length > 2000) return { ok: false, error: GENERIC_ERROR };

  const supabase = await createServerSupabase();
  const { data: batchId, error } = await supabase.rpc("create_equipment_rental_batch", {
    p_supplier_id: input.supplierId,
    p_monthly_rate: batch.value.monthlyRate,
    p_starts_on: batch.value.startsOn,
    ...(batch.value.endsOn !== null ? { p_ends_on: batch.value.endsOn } : {}),
    ...(note.length > 0 ? { p_note: note } : {}),
    p_rate_period: input.ratePeriod as RentalRatePeriod,
    p_deposit_amount: input.depositAmount,
    ...(input.minRentalDays !== null ? { p_min_rental_days: input.minRentalDays } : {}),
  });
  if (error || !batchId) {
    if (error?.code === "42501") return { ok: false, error: NO_PERMISSION };
    if (error?.code === "P0001")
      return { ok: false, error: "ข้อมูลการเช่าไม่ถูกต้อง หรือไม่พบผู้ให้เช่า" };
    return { ok: false, error: GENERIC_ERROR };
  }

  if (input.projectId !== null) {
    const { error: allocError } = await supabase.rpc("create_equipment_project_allocation", {
      p_batch_id: batchId,
      p_project_id: input.projectId,
      p_starts_on: batch.value.startsOn,
      ...(batch.value.endsOn !== null ? { p_ends_on: batch.value.endsOn } : {}),
    });
    if (allocError) {
      // The batch row exists (definer writes are not transactional across two
      // RPCs) — report the partial outcome honestly instead of a fake rollback.
      revalidatePath("/equipment/rentals");
      return {
        ok: false,
        error: "บันทึกการเช่าแล้ว แต่ผูกโครงการไม่สำเร็จ — กดผูกโครงการที่รายการอีกครั้ง",
      };
    }
  }

  revalidatePath("/equipment/rentals");
  return { ok: true };
}

export async function createRentalAllocation(input: {
  batchId: string;
  projectId: string;
  startsOn: string;
  endsOn: string | null;
}): Promise<RentalActionResult> {
  await requireRole(BACK_OFFICE_ROLES);

  if (!UUID_REGEX.test(input.batchId)) return { ok: false, error: GENERIC_ERROR };
  if (!UUID_REGEX.test(input.projectId)) return { ok: false, error: "กรุณาเลือกโครงการ" };
  const period = validateAllocation({ startsOn: input.startsOn, endsOn: input.endsOn });
  if (!period.ok) return period;

  const supabase = await createServerSupabase();
  const { error } = await supabase.rpc("create_equipment_project_allocation", {
    p_batch_id: input.batchId,
    p_project_id: input.projectId,
    p_starts_on: period.value.startsOn,
    ...(period.value.endsOn !== null ? { p_ends_on: period.value.endsOn } : {}),
  });
  if (error) {
    if (error.code === "42501") return { ok: false, error: NO_PERMISSION };
    if (error.code === "P0001")
      return { ok: false, error: "ไม่พบรายการเช่าหรือโครงการ หรือช่วงเวลาไม่ถูกต้อง" };
    return { ok: false, error: GENERIC_ERROR };
  }

  revalidatePath("/equipment/rentals");
  return { ok: true };
}

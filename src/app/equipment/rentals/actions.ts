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
import type { ReceiptMethod } from "@/lib/equipment/rental-settlement-view";

const GENERIC_ERROR = "บันทึกการเช่าไม่สำเร็จ กรุณาลองใหม่อีกครั้ง";
const NO_PERMISSION = "ไม่มีสิทธิ์บันทึกการเช่าอุปกรณ์";

export type RentalActionResult =
  | { ok: true }
  // `code` discriminates the partial outcome (batch saved, allocation RPC
  // failed) so a caller can localize the recovery hint to its surface — the
  // default `error` text points at the per-card control, which only exists on
  // the settings overview, not the project-locked recorder.
  | { ok: false; error: string; code?: "allocation_failed" };

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
        code: "allocation_failed",
      };
    }
  }

  revalidatePath("/equipment/rentals");
  return { ok: true };
}

// Spec 275 U3 — the rental SETTLEMENT (vendor invoice) writes. A settlement is a
// back-office vendor invoice against a rental agreement: base + overtime + fees =
// net (the deposit is resolved separately, never netted), plus VAT/WHT stored as
// data and a payment method. Both writes go through the two spec-275 SECURITY
// DEFINER RPCs (the real 5-role gate + net/deposit validation + audit + GL live
// in the DB); rental_settlements is a zero-grant table with no other write path.
const SETTLEMENT_GENERIC_ERROR = "บันทึกการชำระค่าเช่าไม่สำเร็จ กรุณาลองใหม่อีกครั้ง";
const SETTLEMENT_NO_PERMISSION = "ไม่มีสิทธิ์บันทึกการชำระค่าเช่า";
// P0001 from either RPC = a business-rule failure: net ≠ base+overtime+fees, the
// deposit release exceeds the agreement's deposit, or the agreement was not found.
const SETTLEMENT_INVALID =
  "ข้อมูลการชำระไม่ถูกต้อง (ยอดสุทธิหรือเงินมัดจำไม่สอดคล้อง) หรือไม่พบสัญญาเช่า";

const RECEIPT_METHODS: ReadonlyArray<ReceiptMethod> = ["bank_transfer", "cheque", "cash"];

export interface RentalSettlementInput {
  agreementId: string;
  invoiceNo: string;
  invoiceDate: string;
  base: number;
  overtime: number;
  fees: number;
  vat: number;
  depositRefunded: number;
  depositForfeited: number;
  method: string;
  note: string;
}

type SettlementArgs = {
  p_invoice_no: string;
  p_invoice_date: string;
  p_base: number;
  p_overtime: number;
  p_fees: number;
  p_vat: number;
  p_deposit_refunded: number;
  p_deposit_forfeited: number;
  p_method: ReceiptMethod;
  p_note?: string;
};

// Shared payload validation + arg shaping for both record and supersede. Agreement
// id (record) and settlement id + correction reason (supersede) are checked by the
// callers — they diverge between the two RPCs.
function buildSettlementArgs(
  input: RentalSettlementInput,
): { ok: true; args: SettlementArgs } | { ok: false; error: string } {
  const invoiceNo = input.invoiceNo.trim();
  if (invoiceNo === "") return { ok: false, error: "กรุณาระบุเลขที่ใบแจ้งหนี้" };
  if (invoiceNo.length > 100) return { ok: false, error: SETTLEMENT_GENERIC_ERROR };
  if (input.invoiceDate.trim() === "") return { ok: false, error: "กรุณาระบุวันที่ใบแจ้งหนี้" };

  const amounts = [
    input.base,
    input.overtime,
    input.fees,
    input.vat,
    input.depositRefunded,
    input.depositForfeited,
  ];
  if (amounts.some((n) => !Number.isFinite(n) || n < 0)) {
    return { ok: false, error: SETTLEMENT_GENERIC_ERROR };
  }
  if (!RECEIPT_METHODS.includes(input.method as ReceiptMethod)) {
    return { ok: false, error: SETTLEMENT_GENERIC_ERROR };
  }
  const note = input.note.trim();
  if (note.length > 2000) return { ok: false, error: SETTLEMENT_GENERIC_ERROR };

  return {
    ok: true,
    args: {
      p_invoice_no: invoiceNo,
      p_invoice_date: input.invoiceDate,
      p_base: input.base,
      p_overtime: input.overtime,
      p_fees: input.fees,
      p_vat: input.vat,
      p_deposit_refunded: input.depositRefunded,
      p_deposit_forfeited: input.depositForfeited,
      p_method: input.method as ReceiptMethod,
      ...(note.length > 0 ? { p_note: note } : {}),
    },
  };
}

function mapSettlementError(code: string | undefined): string {
  if (code === "42501") return SETTLEMENT_NO_PERMISSION;
  if (code === "P0001") return SETTLEMENT_INVALID;
  return SETTLEMENT_GENERIC_ERROR;
}

export async function recordRentalSettlement(
  input: RentalSettlementInput,
): Promise<RentalActionResult> {
  await requireRole(BACK_OFFICE_ROLES);

  if (!UUID_REGEX.test(input.agreementId)) return { ok: false, error: "กรุณาเลือกสัญญาเช่า" };
  const built = buildSettlementArgs(input);
  if (!built.ok) return built;

  const supabase = await createServerSupabase();
  const { data, error } = await supabase.rpc("record_rental_settlement", {
    p_agreement_id: input.agreementId,
    ...built.args,
  });
  if (error || !data) return { ok: false, error: mapSettlementError(error?.code) };

  revalidatePath("/equipment/rentals");
  return { ok: true };
}

export async function supersedeRentalSettlement(
  input: RentalSettlementInput & { settlementId: string; correctionReason: string },
): Promise<RentalActionResult> {
  await requireRole(BACK_OFFICE_ROLES);

  if (!UUID_REGEX.test(input.settlementId)) return { ok: false, error: SETTLEMENT_GENERIC_ERROR };
  const reason = input.correctionReason.trim();
  if (reason === "") return { ok: false, error: "กรุณาระบุเหตุผลการแก้ไข" };
  if (reason.length > 2000) return { ok: false, error: SETTLEMENT_GENERIC_ERROR };
  const built = buildSettlementArgs(input);
  if (!built.ok) return built;

  const supabase = await createServerSupabase();
  const { data, error } = await supabase.rpc("supersede_rental_settlement", {
    p_settlement_id: input.settlementId,
    p_correction_reason: reason,
    ...built.args,
  });
  if (error || !data) return { ok: false, error: mapSettlementError(error?.code) };

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

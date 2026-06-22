"use server";

// Spec 177 U2 — store stock-in (รับเข้า) action. Calls the SECURITY DEFINER
// record_stock_in RPC, which carries the BACK_OFFICE role gate + membership
// (can_see_project OR procurement) + the cost/qty validations and the additive
// on-hand upsert; this maps its error codes for the UI.

import "server-only";

import { revalidatePath } from "next/cache";
import { getActionUser, NOT_SIGNED_IN } from "@/lib/auth/action-gate";
import { UUID_REGEX } from "@/lib/validate/uuid";

export type StockInResult = { ok: true } | { ok: false; error: string };

const FAILED = "รับเข้าสต๊อกไม่สำเร็จ กรุณาลองใหม่อีกครั้ง";
const NO_PERMISSION = "ไม่มีสิทธิ์ (เฉพาะฝ่ายจัดซื้อ/ผู้จัดการ)";

export async function recordStockIn(input: {
  projectId: string;
  catalogItemId: string;
  qty: number;
  unitCost: number;
  supplierId: string;
  note: string;
}): Promise<StockInResult> {
  if (!UUID_REGEX.test(input.projectId) || !UUID_REGEX.test(input.catalogItemId)) {
    return { ok: false, error: FAILED };
  }
  // Supplier is optional; only validate the shape when one is given.
  const supplierId = input.supplierId === "" ? null : input.supplierId;
  if (supplierId !== null && !UUID_REGEX.test(supplierId)) {
    return { ok: false, error: FAILED };
  }
  if (!Number.isFinite(input.qty) || input.qty <= 0) {
    return { ok: false, error: "จำนวนต้องมากกว่า 0" };
  }
  if (!Number.isFinite(input.unitCost) || input.unitCost < 0) {
    return { ok: false, error: "ราคาต้นทุนต้องไม่ติดลบ" };
  }

  const auth = await getActionUser();
  if (!auth) return { ok: false, error: NOT_SIGNED_IN };

  const { error } = await auth.supabase.rpc("record_stock_in", {
    p_project_id: input.projectId,
    p_catalog_item_id: input.catalogItemId,
    p_qty: input.qty,
    p_unit_cost: input.unitCost,
    p_note: input.note,
    // p_supplier_id carries DEFAULT NULL (migration 20260809000100) so typegen
    // marks it optional; OMIT the key entirely when no supplier was chosen
    // (exactOptionalPropertyTypes forbids an explicit undefined).
    ...(supplierId !== null ? { p_supplier_id: supplierId } : {}),
  });
  if (error) {
    if (error.code === "42501") return { ok: false, error: NO_PERMISSION };
    if (error.code === "22023")
      return { ok: false, error: "ข้อมูลไม่ถูกต้อง กรุณาตรวจสอบอีกครั้ง" };
    return { ok: false, error: FAILED };
  }

  revalidatePath("/store");
  return { ok: true };
}

// Spec 177 U3/U4 — เบิก/issue-out. Calls the SECURITY DEFINER issue_stock RPC,
// which carries the SITE_STAFF gate + membership + the sufficient-on-hand guard
// and decrements on-hand at the moving-average cost; this maps its error codes.
const ISSUE_FAILED = "เบิกสต๊อกไม่สำเร็จ กรุณาลองใหม่อีกครั้ง";

export async function issueStock(input: {
  projectId: string;
  catalogItemId: string;
  workPackageId: string;
  qty: number;
  note: string;
}): Promise<StockInResult> {
  if (
    !UUID_REGEX.test(input.projectId) ||
    !UUID_REGEX.test(input.catalogItemId) ||
    !UUID_REGEX.test(input.workPackageId)
  ) {
    return { ok: false, error: ISSUE_FAILED };
  }
  if (!Number.isFinite(input.qty) || input.qty <= 0) {
    return { ok: false, error: "จำนวนต้องมากกว่า 0" };
  }

  const auth = await getActionUser();
  if (!auth) return { ok: false, error: NOT_SIGNED_IN };

  const { error } = await auth.supabase.rpc("issue_stock", {
    p_project_id: input.projectId,
    p_catalog_item_id: input.catalogItemId,
    p_work_package_id: input.workPackageId,
    p_qty: input.qty,
    p_note: input.note,
  });
  if (error) {
    if (error.code === "42501") return { ok: false, error: NO_PERMISSION };
    // 22023 covers insufficient stock, a WP from another project, an inactive
    // item, or qty ≤ 0 — all "check what you entered" from the user's side.
    if (error.code === "22023") {
      return { ok: false, error: "สต๊อกไม่พอ หรือข้อมูลไม่ถูกต้อง" };
    }
    return { ok: false, error: ISSUE_FAILED };
  }

  revalidatePath("/store");
  return { ok: true };
}

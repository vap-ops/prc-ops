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

// Spec 177 U10 — record a physical count. Calls the SECURITY DEFINER
// record_stock_count RPC (SITE_STAFF gate + member), which reconciles on-hand to
// the counted truth and logs the variance (shrinkage) at the moving-average cost.
export async function recordStockCount(input: {
  projectId: string;
  catalogItemId: string;
  countedQty: number;
  note: string;
}): Promise<StockInResult> {
  if (!UUID_REGEX.test(input.projectId) || !UUID_REGEX.test(input.catalogItemId)) {
    return { ok: false, error: "บันทึกการนับไม่สำเร็จ" };
  }
  if (!Number.isFinite(input.countedQty) || input.countedQty < 0) {
    return { ok: false, error: "จำนวนที่นับได้ต้องไม่ติดลบ" };
  }

  const auth = await getActionUser();
  if (!auth) return { ok: false, error: NOT_SIGNED_IN };

  const { error } = await auth.supabase.rpc("record_stock_count", {
    p_project_id: input.projectId,
    p_catalog_item_id: input.catalogItemId,
    p_counted_qty: input.countedQty,
    p_note: input.note,
  });
  if (error) {
    if (error.code === "42501") return { ok: false, error: NO_PERMISSION };
    if (error.code === "22023") {
      return { ok: false, error: "ตรวจนับได้เฉพาะวัสดุที่มีในสโตร์ หรือข้อมูลไม่ถูกต้อง" };
    }
    return { ok: false, error: "บันทึกการนับไม่สำเร็จ กรุณาลองใหม่อีกครั้ง" };
  }

  revalidatePath("/store");
  return { ok: true };
}

// Spec 177 U11/U12 — reverse a wrong รับเข้า / เบิก. Calls the SECURITY DEFINER
// reverse_stock_receipt / reverse_stock_issue RPCs, which undo the on-hand effect
// (append-only) and block a double reversal.
export async function reverseStockReceipt(input: { receiptId: string }): Promise<StockInResult> {
  if (!UUID_REGEX.test(input.receiptId)) {
    return { ok: false, error: "กลับรายการไม่สำเร็จ" };
  }
  const auth = await getActionUser();
  if (!auth) return { ok: false, error: NOT_SIGNED_IN };

  const { error } = await auth.supabase.rpc("reverse_stock_receipt", {
    p_receipt_id: input.receiptId,
  });
  if (error) {
    if (error.code === "42501") return { ok: false, error: NO_PERMISSION };
    if (error.code === "23505") return { ok: false, error: "รายการนี้ถูกกลับไปแล้ว" };
    if (error.code === "22023") {
      return { ok: false, error: "ของถูกเบิกออกไปแล้ว กลับรายการรับเข้าไม่ได้" };
    }
    return { ok: false, error: "กลับรายการไม่สำเร็จ กรุณาลองใหม่อีกครั้ง" };
  }

  revalidatePath("/store");
  return { ok: true };
}

export async function reverseStockIssue(input: { issueId: string }): Promise<StockInResult> {
  if (!UUID_REGEX.test(input.issueId)) {
    return { ok: false, error: "กลับรายการไม่สำเร็จ" };
  }
  const auth = await getActionUser();
  if (!auth) return { ok: false, error: NOT_SIGNED_IN };

  const { error } = await auth.supabase.rpc("reverse_stock_issue", { p_issue_id: input.issueId });
  if (error) {
    if (error.code === "42501") return { ok: false, error: NO_PERMISSION };
    if (error.code === "23505") return { ok: false, error: "รายการนี้ถูกกลับไปแล้ว" };
    if (error.code === "22023") return { ok: false, error: "ข้อมูลไม่ถูกต้อง" };
    return { ok: false, error: "กลับรายการไม่สำเร็จ กรุณาลองใหม่อีกครั้ง" };
  }

  revalidatePath("/store");
  return { ok: true };
}

// Spec 177 U8 — the receiver worker attests receipt of an issued item (the worker
// portal). Calls the SECURITY DEFINER confirm_stock_issue RPC, which enforces that
// current_user_worker_id equals the issue's named receiver.
export async function confirmStockIssue(input: { issueId: string }): Promise<StockInResult> {
  if (!UUID_REGEX.test(input.issueId)) {
    return { ok: false, error: "ยืนยันการรับไม่สำเร็จ" };
  }

  const auth = await getActionUser();
  if (!auth) return { ok: false, error: NOT_SIGNED_IN };

  const { error } = await auth.supabase.rpc("confirm_stock_issue", { p_issue_id: input.issueId });
  if (error) {
    if (error.code === "42501") return { ok: false, error: "ไม่มีสิทธิ์ยืนยันรายการนี้" };
    if (error.code === "22023")
      return { ok: false, error: "รายการนี้ยืนยันรับไปแล้ว หรือไม่พบรายการ" };
    return { ok: false, error: "ยืนยันการรับไม่สำเร็จ กรุณาลองใหม่อีกครั้ง" };
  }

  revalidatePath("/portal");
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
  receiverWorkerId?: string;
}): Promise<StockInResult> {
  if (
    !UUID_REGEX.test(input.projectId) ||
    !UUID_REGEX.test(input.catalogItemId) ||
    !UUID_REGEX.test(input.workPackageId)
  ) {
    return { ok: false, error: ISSUE_FAILED };
  }
  // The receiver worker is optional; validate its shape only when given.
  const receiverWorkerId =
    input.receiverWorkerId && input.receiverWorkerId !== "" ? input.receiverWorkerId : null;
  if (receiverWorkerId !== null && !UUID_REGEX.test(receiverWorkerId)) {
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
    // p_receiver_worker_id carries DEFAULT NULL; omit the key when no receiver
    // (exactOptionalPropertyTypes forbids an explicit undefined).
    ...(receiverWorkerId !== null ? { p_receiver_worker_id: receiverWorkerId } : {}),
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

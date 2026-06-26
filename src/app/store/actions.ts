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

// Spec 198 U1 — multi-line รับเข้า. Records many check-in lines in ONE atomic
// call via the record_stock_in_bulk definer RPC (same gate/validation as the
// single record_stock_in; any bad line rolls back the whole batch). The single
// record_stock_in stays for the spec-195 P3 auto-receipt.
export async function recordStockInBulk(input: {
  projectId: string;
  lines: {
    catalogItemId: string;
    qty: number;
    unitCost: number;
    supplierId: string;
    note: string;
  }[];
}): Promise<StockInResult> {
  if (!UUID_REGEX.test(input.projectId)) return { ok: false, error: FAILED };
  if (input.lines.length === 0) return { ok: false, error: FAILED };
  for (const l of input.lines) {
    if (!UUID_REGEX.test(l.catalogItemId)) return { ok: false, error: FAILED };
    const supplierId = l.supplierId === "" ? null : l.supplierId;
    if (supplierId !== null && !UUID_REGEX.test(supplierId)) return { ok: false, error: FAILED };
    if (!Number.isFinite(l.qty) || l.qty <= 0) return { ok: false, error: "จำนวนต้องมากกว่า 0" };
    if (!Number.isFinite(l.unitCost) || l.unitCost < 0) {
      return { ok: false, error: "ราคาต้นทุนต้องไม่ติดลบ" };
    }
  }

  const auth = await getActionUser();
  if (!auth) return { ok: false, error: NOT_SIGNED_IN };

  const { error } = await auth.supabase.rpc("record_stock_in_bulk", {
    p_project_id: input.projectId,
    // The RPC reads supplier_id with nullif(…, '') so an empty string → NULL.
    p_lines: input.lines.map((l) => ({
      catalog_item_id: l.catalogItemId,
      qty: l.qty,
      unit_cost: l.unitCost,
      supplier_id: l.supplierId,
      note: l.note,
    })),
  });
  if (error) {
    if (error.code === "42501") return { ok: false, error: NO_PERMISSION };
    if (error.code === "22023")
      return { ok: false, error: "ข้อมูลไม่ถูกต้อง กรุณาตรวจสอบอีกครั้ง" };
    return { ok: false, error: FAILED };
  }

  revalidatePath(`/projects/${input.projectId}/store`);
  return { ok: true };
}

// Spec 198 U2 / ADR 0064 — divert a delivered WP-bound purchase into the store.
// Calls the divert_purchase_to_store definer RPC (SITE_STAFF gate + member),
// which transfers the cost WP-WIP -> Inventory (reverse the WP purchase + book a
// stock_receipt) and reclassifies the PR store-bound. Maps its error codes.
export async function divertPurchaseToStore(input: { requestId: string }): Promise<StockInResult> {
  if (!UUID_REGEX.test(input.requestId)) return { ok: false, error: FAILED };

  const auth = await getActionUser();
  if (!auth) return { ok: false, error: NOT_SIGNED_IN };

  const { error } = await auth.supabase.rpc("divert_purchase_to_store", {
    p_request_id: input.requestId,
  });
  if (error) {
    if (error.code === "42501") return { ok: false, error: NO_PERMISSION };
    if (error.code === "22023")
      return { ok: false, error: "ย้ายเข้าคลังไม่ได้ — ตรวจสอบสถานะรายการ" };
    return { ok: false, error: FAILED };
  }

  // The diverted line leaves the WP and becomes store stock — revalidate the
  // project surfaces (คลัง + WP detail). The คลัง list also router.refresh()es.
  revalidatePath("/projects", "layout");
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

// Spec 178 B5 — confirm-on-behalf: a PM-tier manager (not the issuer) attests
// receipt for a login-less receiver worker. The confirm_stock_issue_on_behalf RPC
// carries the gate (PM tier, member, not-issuer) + the audit stamp.
export async function confirmStockIssueOnBehalf(input: {
  issueId: string;
}): Promise<StockInResult> {
  if (!UUID_REGEX.test(input.issueId)) {
    return { ok: false, error: "ยืนยันการรับไม่สำเร็จ" };
  }

  const auth = await getActionUser();
  if (!auth) return { ok: false, error: NOT_SIGNED_IN };

  const { error } = await auth.supabase.rpc("confirm_stock_issue_on_behalf", {
    p_issue_id: input.issueId,
  });
  if (error) {
    if (error.code === "42501")
      return { ok: false, error: "ไม่มีสิทธิ์ยืนยันรับแทน (ผู้เบิกยืนยันเองไม่ได้)" };
    if (error.code === "22023")
      return { ok: false, error: "ยืนยันไม่ได้ — ยืนยันแล้ว / ไม่มีผู้รับ / ไม่พบรายการ" };
    return { ok: false, error: "ยืนยันการรับไม่สำเร็จ กรุณาลองใหม่อีกครั้ง" };
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

// Spec 208 U3 — multi-line เบิก. Issues many catalog items from the project store
// to ONE work package in one atomic call via the issue_stock_bulk definer RPC
// (same gate/validation/costing as the single issue_stock; any bad line rolls the
// whole batch back). The WP is at slip level (one slip → one WP — the form lives
// on the WP detail page).
export async function issueStockBulk(input: {
  projectId: string;
  workPackageId: string;
  lines: {
    catalogItemId: string;
    qty: number;
    receiverWorkerId?: string;
    note: string;
  }[];
}): Promise<StockInResult> {
  if (!UUID_REGEX.test(input.projectId) || !UUID_REGEX.test(input.workPackageId)) {
    return { ok: false, error: ISSUE_FAILED };
  }
  if (input.lines.length === 0) return { ok: false, error: ISSUE_FAILED };
  for (const l of input.lines) {
    if (!UUID_REGEX.test(l.catalogItemId)) return { ok: false, error: ISSUE_FAILED };
    const receiver = l.receiverWorkerId && l.receiverWorkerId !== "" ? l.receiverWorkerId : null;
    if (receiver !== null && !UUID_REGEX.test(receiver)) return { ok: false, error: ISSUE_FAILED };
    if (!Number.isFinite(l.qty) || l.qty <= 0) return { ok: false, error: "จำนวนต้องมากกว่า 0" };
  }

  const auth = await getActionUser();
  if (!auth) return { ok: false, error: NOT_SIGNED_IN };

  const { error } = await auth.supabase.rpc("issue_stock_bulk", {
    p_project_id: input.projectId,
    p_work_package_id: input.workPackageId,
    // The RPC reads receiver_worker_id with nullif(…, '') so an empty string → NULL.
    p_lines: input.lines.map((l) => ({
      catalog_item_id: l.catalogItemId,
      qty: l.qty,
      receiver_worker_id: l.receiverWorkerId ?? "",
      note: l.note,
    })),
  });
  if (error) {
    if (error.code === "42501") return { ok: false, error: NO_PERMISSION };
    if (error.code === "22023") return { ok: false, error: "สต๊อกไม่พอ หรือข้อมูลไม่ถูกต้อง" };
    return { ok: false, error: ISSUE_FAILED };
  }

  revalidatePath(`/projects/${input.projectId}/work-packages/${input.workPackageId}`);
  return { ok: true };
}

// Spec 208 U3b — on-site "ใช้ที่งานนี้เลย" (buy & use on this WP now). Receives a
// catalogued item into the project store AND immediately issues it to the WP in
// one atomic call via the site_purchase_use_now definer RPC (net Dr 1400/Cr 2100
// at cost — same as a direct on-site purchase, but routed through the store).
export async function sitePurchaseUseNow(input: {
  projectId: string;
  workPackageId: string;
  catalogItemId: string;
  qty: number;
  unitCost: number;
  note: string;
}): Promise<StockInResult> {
  if (
    !UUID_REGEX.test(input.projectId) ||
    !UUID_REGEX.test(input.workPackageId) ||
    !UUID_REGEX.test(input.catalogItemId)
  ) {
    return { ok: false, error: ISSUE_FAILED };
  }
  if (!Number.isFinite(input.qty) || input.qty <= 0) {
    return { ok: false, error: "จำนวนต้องมากกว่า 0" };
  }
  if (!Number.isFinite(input.unitCost) || input.unitCost < 0) {
    return { ok: false, error: "ราคาต้นทุนต้องไม่ติดลบ" };
  }

  const auth = await getActionUser();
  if (!auth) return { ok: false, error: NOT_SIGNED_IN };

  const { error } = await auth.supabase.rpc("site_purchase_use_now", {
    p_project_id: input.projectId,
    p_work_package_id: input.workPackageId,
    p_catalog_item_id: input.catalogItemId,
    p_qty: input.qty,
    p_unit_cost: input.unitCost,
    p_note: input.note,
  });
  if (error) {
    if (error.code === "42501") return { ok: false, error: NO_PERMISSION };
    if (error.code === "22023")
      return { ok: false, error: "ข้อมูลไม่ถูกต้อง กรุณาตรวจสอบอีกครั้ง" };
    return { ok: false, error: ISSUE_FAILED };
  }

  revalidatePath(`/projects/${input.projectId}/work-packages/${input.workPackageId}`);
  return { ok: true };
}

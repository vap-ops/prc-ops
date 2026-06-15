"use server";

// Purchasing server actions (feature spec 09 / ADR 0022).
//
// createPurchaseRequest: any role that can read work_packages (SA/PM/super)
// requests an item against a WP. The INSERT goes through the session
// (anon-key) client; RLS pins requested_by = auth.uid() and source = 'app'.
//
// decidePurchaseRequest: PM / super approves or rejects. Two-layer
// transition guard mirrors recordDecision (work-package approvals):
//   1. JS predicate validates the decision and the comment-required rule.
//   2. SQL `.eq('id', id).eq('status', 'requested')` clause is the safety
//      net — even if the JS check were broken, the UPDATE only fires
//      against a row that's actually 'requested'.
// 0 rows returned from the UPDATE means the row was already decided (or
// the caller's RLS doesn't see it); both surface as "not in requested state."
//
// Audit logging is NOT done here. The
// `purchase_requests_audit_decision` AFTER UPDATE trigger (migration
// 20260608130100) writes one audit_log row per successful
// requested→approved | rejected transition, atomically inside the same
// transaction as the UPDATE. A decision that fails to audit cannot
// commit — the trigger's exception propagates and rolls back the
// UPDATE. "Exactly one row per decision, never on a non-transition
// update" is therefore a DB invariant, tested in pgTAP 17 section I.

import "server-only";

import { revalidatePath } from "next/cache";
import { getActionUser, NOT_SIGNED_IN, type ActionAuth } from "@/lib/auth/action-gate";
import { isValidPhotoExt, type PhotoExt } from "@/lib/photos/path";
import { buildPrAttachmentStoragePath } from "@/lib/purchasing/attachment-path";
import { validateAttachmentLink } from "@/lib/purchasing/validate-attachment";
import {
  validateCreatePurchaseRequest,
  isDecisionCommentValid,
  isPurchaseDecision,
  type PurchaseDecision,
} from "@/lib/purchasing/validate-purchase-request";
import { validateRecordPurchase } from "@/lib/purchasing/validate-record-purchase";
import { validateCreatePurchaseOrder } from "@/lib/purchasing/validate-create-purchase-order";
import { validateSitePurchase } from "@/lib/purchasing/validate-site-purchase";
import { UUID_REGEX } from "@/lib/validate/uuid";

// Spec 65: file-local consts for the Thai error strings this module
// repeats (the workers/actions.ts pattern). Single-use strings stay
// inline at their call sites.
const ERR_INVALID_REQUEST_ID = "รหัสคำขอไม่ถูกต้อง";
const ERR_SAVE_PHOTO_FAILED = "บันทึกรูปไม่สำเร็จ กรุณาลองใหม่อีกครั้ง";
const ERR_REMOVE_ATTACHMENT_FAILED = "ลบรายการแนบไม่สำเร็จ กรุณาลองใหม่อีกครั้ง";

export interface CreatePurchaseRequestInput {
  workPackageId: string;
  itemDescription: string;
  quantity: number;
  unit: string;
  neededBy?: string | null | undefined;
  priority?: string | null | undefined;
  notes?: string | null | undefined;
}

export type CreatePurchaseRequestResult = { ok: true; id: string } | { ok: false; error: string };

export async function createPurchaseRequest(
  input: CreatePurchaseRequestInput,
): Promise<CreatePurchaseRequestResult> {
  const validated = validateCreatePurchaseRequest(input);
  if (!validated.ok) return validated;

  const auth = await getActionUser();
  if (!auth) return { ok: false, error: NOT_SIGNED_IN };
  const { supabase, user } = auth;

  const { data, error } = await supabase
    .from("purchase_requests")
    .insert({
      work_package_id: validated.value.workPackageId,
      item_description: validated.value.itemDescription,
      quantity: validated.value.quantity,
      unit: validated.value.unit,
      needed_by: validated.value.neededBy,
      priority: validated.value.priority,
      notes: validated.value.notes,
      requested_by: user.id,
      source: "app",
    })
    .select("id")
    .single();

  if (error || !data) {
    return { ok: false, error: "สร้างคำขอซื้อไม่สำเร็จ กรุณาลองใหม่อีกครั้ง" };
  }

  revalidatePath("/requests");
  return { ok: true, id: data.id };
}

export interface DecidePurchaseRequestInput {
  id: string;
  decision: PurchaseDecision;
  comment?: string | null;
}

export type DecidePurchaseRequestResult =
  | { ok: true; status: PurchaseDecision }
  | { ok: false; error: string };

export async function decidePurchaseRequest(
  input: DecidePurchaseRequestInput,
): Promise<DecidePurchaseRequestResult> {
  if (!UUID_REGEX.test(input.id)) return { ok: false, error: ERR_INVALID_REQUEST_ID };
  if (!isPurchaseDecision(input.decision)) return { ok: false, error: "ผลการพิจารณาไม่ถูกต้อง" };

  const comment = input.comment ?? null;
  if (!isDecisionCommentValid(input.decision, comment)) {
    return { ok: false, error: "ต้องใส่ความเห็นเมื่อไม่อนุมัติ" };
  }

  const auth = await getActionUser();
  if (!auth) return { ok: false, error: NOT_SIGNED_IN };
  const { supabase, user } = auth;

  // Whitespace-only / null collapses to null. The predicate above already
  // forbids that case for rejected, so this branch only triggers for approved.
  const normalisedComment = comment && comment.trim().length > 0 ? comment.trim() : null;

  const { data, error } = await supabase
    .from("purchase_requests")
    .update({
      status: input.decision,
      approved_by: user.id,
      decided_at: new Date().toISOString(),
      decision_comment: normalisedComment,
    })
    .eq("id", input.id)
    .eq("status", "requested")
    .select("id");

  if (error) {
    return { ok: false, error: "บันทึกผลการพิจารณาไม่สำเร็จ กรุณาลองใหม่อีกครั้ง" };
  }
  if (!data || data.length === 0) {
    return { ok: false, error: "คำขอนี้ได้รับการพิจารณาไปแล้ว" };
  }

  revalidatePath("/requests");
  return { ok: true, status: input.decision };
}

// cancelPurchaseRequest (spec 27 / ADR 0031): PM/super closes an
// approved request that will never be purchased. Same two-layer guard
// as decidePurchaseRequest — JS shape check + SQL .eq(status,'approved')
// safety net; the audit row is written by the
// purchase_requests_audit_cancellation trigger inside the same txn.
export interface CancelPurchaseRequestInput {
  id: string;
}

export type CancelPurchaseRequestResult = { ok: true } | { ok: false; error: string };

export async function cancelPurchaseRequest(
  input: CancelPurchaseRequestInput,
): Promise<CancelPurchaseRequestResult> {
  if (!UUID_REGEX.test(input.id)) return { ok: false, error: ERR_INVALID_REQUEST_ID };

  const auth = await getActionUser();
  if (!auth) return { ok: false, error: NOT_SIGNED_IN };
  const { supabase, user } = auth;

  const { data, error } = await supabase
    .from("purchase_requests")
    .update({
      status: "cancelled",
      cancelled_at: new Date().toISOString(),
      cancelled_by: user.id,
    })
    .eq("id", input.id)
    .eq("status", "approved")
    .select("id");

  if (error) {
    return { ok: false, error: "ยกเลิกคำขอไม่สำเร็จ กรุณาลองใหม่อีกครั้ง" };
  }
  if (!data || data.length === 0) {
    return { ok: false, error: "คำขอนี้ไม่อยู่ในสถานะที่ยกเลิกได้" };
  }

  revalidatePath("/requests");
  return { ok: true };
}

// --- Delivery-confirmation photos (spec 23 / ADR 0028) -------------------
//
// addDeliveryConfirmationPhoto: metadata-only — the browser has already
// uploaded the bytes to pr-attachments at the canonical path. The server
// REBUILDS that path itself (a client-supplied path is never trusted)
// from the parent row read under caller RLS, then INSERTs the content
// row under the user session — the RLS branch pins role + created_by +
// parent status='delivered'.
//
// removePurchaseRequestAttachment: a tombstone INSERT, never a DELETE
// (ADR 0015). RLS enforces creator-only removal for confirmation photos.

// Read the parent under caller RLS (maybeSingle — no existence leak),
// joined to the WP for project_id, to rebuild the canonical path.
async function readPrParent(supabase: ActionAuth["supabase"], purchaseRequestId: string) {
  return await supabase
    .from("purchase_requests")
    .select("id, status, work_packages ( project_id )")
    .eq("id", purchaseRequestId)
    .maybeSingle();
}

// Spec 37 / ADR 0039: identity-complete replay check (the spec-35
// lesson: an id-only check would let a forged replay claim a foreign
// row). Read-only — nothing is ever UPDATEd; true when a row matching
// every identity column already landed.
async function findLandedAttachment(
  supabase: ActionAuth["supabase"],
  args: {
    attachmentId: string;
    purchaseRequestId: string;
    purpose: "delivery_confirmation" | "reference" | "invoice";
    storagePath: string;
  },
): Promise<boolean> {
  const { data } = await supabase
    .from("purchase_request_attachments")
    .select("id")
    .eq("id", args.attachmentId)
    .eq("purchase_request_id", args.purchaseRequestId)
    .eq("kind", "image")
    .eq("purpose", args.purpose)
    .eq("storage_path", args.storagePath)
    .maybeSingle();
  return data !== null;
}

export interface AddDeliveryConfirmationPhotoInput {
  purchaseRequestId: string;
  attachmentId: string;
  ext: string;
}

export type AttachmentActionResult = { ok: true } | { ok: false; error: string };

export async function addDeliveryConfirmationPhoto(
  input: AddDeliveryConfirmationPhotoInput,
): Promise<AttachmentActionResult> {
  if (!UUID_REGEX.test(input.purchaseRequestId) || !UUID_REGEX.test(input.attachmentId)) {
    return { ok: false, error: ERR_SAVE_PHOTO_FAILED };
  }
  if (!isValidPhotoExt(input.ext)) {
    return { ok: false, error: ERR_SAVE_PHOTO_FAILED };
  }

  const auth = await getActionUser();
  if (!auth) return { ok: false, error: NOT_SIGNED_IN };
  const { supabase, user } = auth;

  const { data: pr } = await readPrParent(supabase, input.purchaseRequestId);
  const projectId = pr?.work_packages?.project_id;
  // on_route joined delivered as a legal photo state in ADR 0030 — the
  // photo on an on_route parent is what COMPLETES the delivery (the
  // delivered-only check here outlived the policy widening; operator-
  // reported bug 2026-06-11).
  if (!pr || (pr.status !== "delivered" && pr.status !== "on_route") || !projectId) {
    return { ok: false, error: ERR_SAVE_PHOTO_FAILED };
  }

  const storagePath = buildPrAttachmentStoragePath(
    projectId,
    input.purchaseRequestId,
    input.attachmentId,
    input.ext as PhotoExt,
  );
  if (!storagePath) {
    return { ok: false, error: ERR_SAVE_PHOTO_FAILED };
  }

  const { error } = await supabase.from("purchase_request_attachments").insert({
    id: input.attachmentId,
    purchase_request_id: input.purchaseRequestId,
    kind: "image",
    purpose: "delivery_confirmation",
    storage_path: storagePath,
    created_by: user.id,
  });
  if (error) {
    // Spec 37 / ADR 0039: idempotent replay (identity-complete).
    if (error.code !== "23505") {
      return { ok: false, error: ERR_SAVE_PHOTO_FAILED };
    }
    const landed = await findLandedAttachment(supabase, {
      attachmentId: input.attachmentId,
      purchaseRequestId: input.purchaseRequestId,
      purpose: "delivery_confirmation",
      storagePath,
    });
    if (!landed) {
      return { ok: false, error: ERR_SAVE_PHOTO_FAILED };
    }
  }

  revalidatePath("/requests");
  return { ok: true };
}

// addInvoiceAttachment (spec 66 / ADR 0043): the invoice/receipt document
// (ใบส่งของ/ใบเสร็จ). Mirrors addDeliveryConfirmationPhoto but purpose
// 'invoice' and a wider parent gate — invoices attach once goods/docs
// exist (purchased | on_route | delivered | site_purchased). The RLS
// invoice arm re-enforces this server-side; the delivery auto-complete
// trigger keys on 'delivery_confirmation' so an invoice never advances
// status.

const INVOICE_PARENT_STATUSES = ["purchased", "on_route", "delivered", "site_purchased"] as const;

export async function addInvoiceAttachment(
  input: AddDeliveryConfirmationPhotoInput,
): Promise<AttachmentActionResult> {
  if (!UUID_REGEX.test(input.purchaseRequestId) || !UUID_REGEX.test(input.attachmentId)) {
    return { ok: false, error: ERR_SAVE_PHOTO_FAILED };
  }
  if (!isValidPhotoExt(input.ext)) {
    return { ok: false, error: ERR_SAVE_PHOTO_FAILED };
  }

  const auth = await getActionUser();
  if (!auth) return { ok: false, error: NOT_SIGNED_IN };
  const { supabase, user } = auth;

  const { data: pr } = await readPrParent(supabase, input.purchaseRequestId);
  const projectId = pr?.work_packages?.project_id;
  if (!pr || !projectId) {
    return { ok: false, error: ERR_SAVE_PHOTO_FAILED };
  }

  const storagePath = buildPrAttachmentStoragePath(
    projectId,
    input.purchaseRequestId,
    input.attachmentId,
    input.ext as PhotoExt,
  );
  if (!storagePath) {
    return { ok: false, error: ERR_SAVE_PHOTO_FAILED };
  }

  if (!(INVOICE_PARENT_STATUSES as readonly string[]).includes(pr.status)) {
    // Replay-confirm BEFORE the gate refuses (spec 37 lesson): a queued
    // insert that LANDED but lost its response can arrive after the
    // status moved on — confirm it as success, identity-complete.
    const landed = await findLandedAttachment(supabase, {
      attachmentId: input.attachmentId,
      purchaseRequestId: input.purchaseRequestId,
      purpose: "invoice",
      storagePath,
    });
    if (landed) {
      revalidatePath("/requests");
      return { ok: true };
    }
    return { ok: false, error: ERR_SAVE_PHOTO_FAILED };
  }

  const { error } = await supabase.from("purchase_request_attachments").insert({
    id: input.attachmentId,
    purchase_request_id: input.purchaseRequestId,
    kind: "image",
    purpose: "invoice",
    storage_path: storagePath,
    created_by: user.id,
  });
  if (error) {
    if (error.code !== "23505") {
      return { ok: false, error: ERR_SAVE_PHOTO_FAILED };
    }
    const landed = await findLandedAttachment(supabase, {
      attachmentId: input.attachmentId,
      purchaseRequestId: input.purchaseRequestId,
      purpose: "invoice",
      storagePath,
    });
    if (!landed) {
      return { ok: false, error: ERR_SAVE_PHOTO_FAILED };
    }
  }

  revalidatePath("/requests");
  return { ok: true };
}

// recordSitePurchase (spec 66 / ADR 0043): an on-site cash purchase that
// never went through request→approve. Relays the SECURITY DEFINER RPC,
// which creates the purchase_request born terminal (status
// 'site_purchased', source 'site_purchase') and returns its id so the
// caller immediately attaches the receipt as an invoice.

export interface RecordSitePurchaseInput {
  workPackageId: string;
  itemDescription: string;
  quantity: number;
  unit: string;
  // Spec 103: optional purchase amount (THB) — feeds dashboard material spend.
  amount: number | null;
}

export type RecordSitePurchaseResult = { ok: true; id: string } | { ok: false; error: string };

export async function recordSitePurchase(
  input: RecordSitePurchaseInput,
): Promise<RecordSitePurchaseResult> {
  const validated = validateSitePurchase(input);
  if (!validated.ok) return validated;

  const auth = await getActionUser();
  if (!auth) return { ok: false, error: NOT_SIGNED_IN };
  const { supabase } = auth;

  const { data, error } = await supabase.rpc("record_site_purchase", {
    p_work_package_id: validated.value.workPackageId,
    p_item_description: validated.value.itemDescription,
    p_quantity: validated.value.quantity,
    p_unit: validated.value.unit,
    // Spec 103: omit when null so the RPC default applies (no amount recorded).
    ...(validated.value.amount !== null ? { p_amount: validated.value.amount } : {}),
  });
  if (error || !data) {
    return { ok: false, error: "บันทึกการซื้อหน้างานไม่สำเร็จ กรุณาลองใหม่อีกครั้ง" };
  }

  revalidatePath("/requests");
  return { ok: true, id: data };
}

// acknowledgeSitePurchase (spec 66 / ADR 0043): PM/super marks an on-site
// purchase as seen. Relays the SECURITY DEFINER RPC (role + scope guard).

export async function acknowledgeSitePurchase(requestId: string): Promise<AttachmentActionResult> {
  if (!UUID_REGEX.test(requestId)) {
    return { ok: false, error: ERR_INVALID_REQUEST_ID };
  }

  const auth = await getActionUser();
  if (!auth) return { ok: false, error: NOT_SIGNED_IN };
  const { supabase } = auth;

  const { error } = await supabase.rpc("acknowledge_site_purchase", { p_id: requestId });
  if (error) {
    return { ok: false, error: "รับทราบไม่สำเร็จ กรุณาลองใหม่อีกครั้ง" };
  }

  revalidatePath("/requests");
  return { ok: true };
}

// addPurchaseRequestAttachment (spec 16 §4 P2): reference attachments
// staged at create time or added via the pending-card expander. Image
// rows: the browser already uploaded the bytes; the server REBUILDS the
// canonical path. Link rows: validated, no storage involved. The RLS
// reference branch pins role + created_by + own parent + status='requested'.

export type AddPurchaseRequestAttachmentInput =
  | { purchaseRequestId: string; kind: "image"; attachmentId: string; ext: string }
  | { purchaseRequestId: string; kind: "link"; url: string };

export async function addPurchaseRequestAttachment(
  input: AddPurchaseRequestAttachmentInput,
): Promise<AttachmentActionResult> {
  if (!UUID_REGEX.test(input.purchaseRequestId)) {
    return { ok: false, error: ERR_SAVE_PHOTO_FAILED };
  }

  const auth = await getActionUser();
  if (!auth) return { ok: false, error: NOT_SIGNED_IN };
  const { supabase, user } = auth;

  if (input.kind === "link") {
    const link = validateAttachmentLink(input.url);
    if (!link.ok) return { ok: false, error: link.error };
    const { error } = await supabase.from("purchase_request_attachments").insert({
      purchase_request_id: input.purchaseRequestId,
      kind: "link",
      purpose: "reference",
      url: link.value,
      created_by: user.id,
    });
    if (error) return { ok: false, error: "บันทึกลิงก์ไม่สำเร็จ กรุณาลองใหม่อีกครั้ง" };
    revalidatePath("/requests");
    return { ok: true };
  }

  if (!UUID_REGEX.test(input.attachmentId) || !isValidPhotoExt(input.ext)) {
    return { ok: false, error: ERR_SAVE_PHOTO_FAILED };
  }

  const { data: pr } = await readPrParent(supabase, input.purchaseRequestId);
  const projectId = pr?.work_packages?.project_id;
  if (!pr || !projectId) {
    return { ok: false, error: ERR_SAVE_PHOTO_FAILED };
  }

  const storagePath = buildPrAttachmentStoragePath(
    projectId,
    input.purchaseRequestId,
    input.attachmentId,
    input.ext as PhotoExt,
  );
  if (!storagePath) {
    return { ok: false, error: ERR_SAVE_PHOTO_FAILED };
  }

  if (pr.status !== "requested") {
    // Spec 37 review fix: a queued replay whose insert LANDED but whose
    // response was lost can arrive after the PM decided — the row exists
    // and must confirm as success (identity-complete, read-only). A
    // never-landed photo on a decided parent stays refusable: the
    // reference window closes at decision time (recorded seam; discard
    // is the designed out).
    const landed = await findLandedAttachment(supabase, {
      attachmentId: input.attachmentId,
      purchaseRequestId: input.purchaseRequestId,
      purpose: "reference",
      storagePath,
    });
    if (landed) {
      revalidatePath("/requests");
      return { ok: true };
    }
    return { ok: false, error: ERR_SAVE_PHOTO_FAILED };
  }

  const { error } = await supabase.from("purchase_request_attachments").insert({
    id: input.attachmentId,
    purchase_request_id: input.purchaseRequestId,
    kind: "image",
    purpose: "reference",
    storage_path: storagePath,
    created_by: user.id,
  });
  if (error) {
    // Spec 37 / ADR 0039: idempotent replay (identity-complete).
    if (error.code !== "23505") {
      return { ok: false, error: ERR_SAVE_PHOTO_FAILED };
    }
    const landed = await findLandedAttachment(supabase, {
      attachmentId: input.attachmentId,
      purchaseRequestId: input.purchaseRequestId,
      purpose: "reference",
      storagePath,
    });
    if (!landed) {
      return { ok: false, error: ERR_SAVE_PHOTO_FAILED };
    }
  }

  revalidatePath("/requests");
  return { ok: true };
}

export interface RemovePurchaseRequestAttachmentInput {
  attachmentId: string;
}

export async function removePurchaseRequestAttachment(
  input: RemovePurchaseRequestAttachmentInput,
): Promise<AttachmentActionResult> {
  if (!UUID_REGEX.test(input.attachmentId)) {
    return { ok: false, error: ERR_REMOVE_ATTACHMENT_FAILED };
  }

  const auth = await getActionUser();
  if (!auth) return { ok: false, error: NOT_SIGNED_IN };
  const { supabase, user } = auth;

  // Read the target under caller RLS to mirror its parent/kind/purpose
  // into the tombstone (the composite FK requires same parent + kind).
  const { data: target } = await supabase
    .from("purchase_request_attachments")
    .select("id, purchase_request_id, kind, purpose")
    .eq("id", input.attachmentId)
    .maybeSingle();
  if (!target) {
    return { ok: false, error: ERR_REMOVE_ATTACHMENT_FAILED };
  }

  const { error } = await supabase.from("purchase_request_attachments").insert({
    purchase_request_id: target.purchase_request_id,
    kind: target.kind,
    purpose: target.purpose,
    superseded_by: target.id,
    created_by: user.id,
  });
  if (error) {
    return { ok: false, error: ERR_REMOVE_ATTACHMENT_FAILED };
  }

  revalidatePath("/requests");
  return { ok: true };
}

// --- In-app purchase/shipment recording (spec 33 / ADR 0038) --------------
//
// createSupplier: RLS-relay INSERT (createContractor pattern) — the
// "suppliers insert by back office" policy pins role + created_by.
//
// recordPurchase / recordShipment: SECURITY DEFINER RPC relays. The RPC
// owns the role gate (PM/procurement/super), the stage guard
// (approved+unpurchased / purchased+unshipped), the supplier-name
// snapshot, and the input re-checks; status flips, audit rows, and
// notification outbox rows come from the existing trigger chain — no
// writes happen here beyond the RPC call. AppSheet's write path is
// untouched (parallel-path posture, ADR 0034 amendment).

export interface CreateSupplierInput {
  name: string;
  phone: string;
}

export type CreateSupplierResult = { ok: true; id: string } | { ok: false; error: string };

export async function createSupplier(input: CreateSupplierInput): Promise<CreateSupplierResult> {
  const name = input.name.trim();
  if (name.length === 0) return { ok: false, error: "ชื่อผู้ขายต้องไม่ว่าง" };
  if (name.length > 200) return { ok: false, error: "ชื่อผู้ขายต้องไม่เกิน 200 ตัวอักษร" };
  const phone = input.phone.trim();
  if (phone.length > 50) return { ok: false, error: "เบอร์โทรต้องไม่เกิน 50 ตัวอักษร" };

  const auth = await getActionUser();
  if (!auth) return { ok: false, error: NOT_SIGNED_IN };
  const { supabase, user } = auth;

  const { data, error } = await supabase
    .from("suppliers")
    .insert({ name, phone: phone.length > 0 ? phone : null, created_by: user.id })
    .select("id")
    .single();
  if (error || !data) {
    return { ok: false, error: "เพิ่มผู้ขายไม่สำเร็จ กรุณาลองใหม่อีกครั้ง" };
  }

  revalidatePath("/requests");
  return { ok: true, id: data.id };
}

export interface RecordPurchaseInput {
  requestId: string;
  supplierId: string;
  orderRef: string;
  amount: number | null;
  eta: string | null;
}

export type RecordActionResult = { ok: true } | { ok: false; error: string };

export async function recordPurchase(input: RecordPurchaseInput): Promise<RecordActionResult> {
  const validated = validateRecordPurchase(input);
  if (!validated.ok) return validated;

  const auth = await getActionUser();
  if (!auth) return { ok: false, error: NOT_SIGNED_IN };
  const { supabase } = auth;

  const { error } = await supabase.rpc("record_purchase", {
    p_purchase_request_id: validated.value.requestId,
    p_supplier_id: validated.value.supplierId,
    ...(validated.value.orderRef !== null ? { p_order_ref: validated.value.orderRef } : {}),
    ...(validated.value.amount !== null ? { p_amount: validated.value.amount } : {}),
    ...(validated.value.eta !== null ? { p_eta: validated.value.eta } : {}),
  });
  if (error) {
    if (error.code === "42501") {
      return { ok: false, error: "ไม่มีสิทธิ์บันทึกการสั่งซื้อ" };
    }
    if (error.code === "P0001") {
      return { ok: false, error: "คำขอนี้ไม่อยู่ในสถานะที่บันทึกการสั่งซื้อได้" };
    }
    return { ok: false, error: "บันทึกการสั่งซื้อไม่สำเร็จ กรุณาลองใหม่อีกครั้ง" };
  }

  revalidatePath("/requests");
  return { ok: true };
}

export interface CreatePurchaseOrderInput {
  supplierId: string;
  eta: string | null;
  lines: Array<{ requestId: string; amount: number | null }>;
}

export type CreatePurchaseOrderResult = { ok: true; poId: string } | { ok: false; error: string };

// Spec 116 / ADR 0044 — bundle approved tickets into one supplier order via the
// create_purchase_order RPC. The RPC is role-gated on current_user_role() (the
// authenticated session), SECURITY DEFINER, and re-checks everything (approved-
// only lines, supplier exists, atomic) — so this runs on the user's session
// client (getActionUser), never the admin client.
export async function createPurchaseOrder(
  input: CreatePurchaseOrderInput,
): Promise<CreatePurchaseOrderResult> {
  const validated = validateCreatePurchaseOrder(input);
  if (!validated.ok) return validated;

  const auth = await getActionUser();
  if (!auth) return { ok: false, error: NOT_SIGNED_IN };
  const { supabase } = auth;

  const { data, error } = await supabase.rpc("create_purchase_order", {
    p_supplier_id: validated.value.supplierId,
    p_eta: validated.value.eta,
    p_lines: validated.value.lines.map((l) => ({
      request_id: l.requestId,
      amount: l.amount,
    })),
  });
  if (error) {
    if (error.code === "42501") {
      return { ok: false, error: "ไม่มีสิทธิ์สร้างใบสั่งซื้อ" };
    }
    if (error.code === "P0001") {
      return {
        ok: false,
        error: "สร้างใบสั่งซื้อไม่สำเร็จ: มีรายการที่ไม่อยู่ในสถานะอนุมัติ หรือข้อมูลไม่ถูกต้อง",
      };
    }
    return { ok: false, error: "สร้างใบสั่งซื้อไม่สำเร็จ กรุณาลองใหม่อีกครั้ง" };
  }
  if (!data) {
    return { ok: false, error: "สร้างใบสั่งซื้อไม่สำเร็จ กรุณาลองใหม่อีกครั้ง" };
  }

  revalidatePath("/requests");
  return { ok: true, poId: data };
}

export interface RecordShipmentInput {
  requestId: string;
}

export async function recordShipment(input: RecordShipmentInput): Promise<RecordActionResult> {
  if (!UUID_REGEX.test(input.requestId)) return { ok: false, error: ERR_INVALID_REQUEST_ID };

  const auth = await getActionUser();
  if (!auth) return { ok: false, error: NOT_SIGNED_IN };
  const { supabase } = auth;

  const { error } = await supabase.rpc("record_shipment", {
    p_purchase_request_id: input.requestId,
  });
  if (error) {
    if (error.code === "42501") {
      return { ok: false, error: "ไม่มีสิทธิ์บันทึกการจัดส่ง" };
    }
    if (error.code === "P0001") {
      return { ok: false, error: "คำขอนี้ไม่อยู่ในสถานะที่บันทึกการจัดส่งได้" };
    }
    return { ok: false, error: "บันทึกการจัดส่งไม่สำเร็จ กรุณาลองใหม่อีกครั้ง" };
  }

  revalidatePath("/requests");
  return { ok: true };
}

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
import { createClient as createServerSupabase } from "@/lib/db/server";
import { isValidPhotoExt, type PhotoExt } from "@/lib/photos/path";
import { buildPrAttachmentStoragePath } from "@/lib/purchasing/attachment-path";
import { validateAttachmentLink } from "@/lib/purchasing/validate-attachment";
import {
  validateCreatePurchaseRequest,
  isDecisionCommentValid,
  isPurchaseDecision,
  type PurchaseDecision,
} from "@/lib/purchasing/validate-purchase-request";

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface CreatePurchaseRequestInput {
  workPackageId: string;
  itemDescription: string;
  quantity: number;
  unit: string;
  neededBy?: string | null | undefined;
  priority?: string | null | undefined;
}

export type CreatePurchaseRequestResult = { ok: true; id: string } | { ok: false; error: string };

export async function createPurchaseRequest(
  input: CreatePurchaseRequestInput,
): Promise<CreatePurchaseRequestResult> {
  const validated = validateCreatePurchaseRequest(input);
  if (!validated.ok) return validated;

  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "ยังไม่ได้เข้าสู่ระบบ" };

  const { data, error } = await supabase
    .from("purchase_requests")
    .insert({
      work_package_id: validated.value.workPackageId,
      item_description: validated.value.itemDescription,
      quantity: validated.value.quantity,
      unit: validated.value.unit,
      needed_by: validated.value.neededBy,
      priority: validated.value.priority,
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
  if (!UUID_REGEX.test(input.id)) return { ok: false, error: "รหัสคำขอไม่ถูกต้อง" };
  if (!isPurchaseDecision(input.decision)) return { ok: false, error: "ผลการพิจารณาไม่ถูกต้อง" };

  const comment = input.comment ?? null;
  if (!isDecisionCommentValid(input.decision, comment)) {
    return { ok: false, error: "ต้องใส่ความเห็นเมื่อไม่อนุมัติ" };
  }

  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "ยังไม่ได้เข้าสู่ระบบ" };

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
  if (!UUID_REGEX.test(input.id)) return { ok: false, error: "รหัสคำขอไม่ถูกต้อง" };

  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "ยังไม่ได้เข้าสู่ระบบ" };

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
    return { ok: false, error: "บันทึกรูปไม่สำเร็จ กรุณาลองใหม่อีกครั้ง" };
  }
  if (!isValidPhotoExt(input.ext)) {
    return { ok: false, error: "บันทึกรูปไม่สำเร็จ กรุณาลองใหม่อีกครั้ง" };
  }

  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "ยังไม่ได้เข้าสู่ระบบ" };

  // Read the parent under caller RLS (maybeSingle — no existence leak),
  // joined to the WP for project_id, to rebuild the canonical path.
  const { data: pr } = await supabase
    .from("purchase_requests")
    .select("id, status, work_packages ( project_id )")
    .eq("id", input.purchaseRequestId)
    .maybeSingle();
  const projectId = pr?.work_packages?.project_id;
  // on_route joined delivered as a legal photo state in ADR 0030 — the
  // photo on an on_route parent is what COMPLETES the delivery (the
  // delivered-only check here outlived the policy widening; operator-
  // reported bug 2026-06-11).
  if (!pr || (pr.status !== "delivered" && pr.status !== "on_route") || !projectId) {
    return { ok: false, error: "บันทึกรูปไม่สำเร็จ กรุณาลองใหม่อีกครั้ง" };
  }

  const storagePath = buildPrAttachmentStoragePath(
    projectId,
    input.purchaseRequestId,
    input.attachmentId,
    input.ext as PhotoExt,
  );
  if (!storagePath) {
    return { ok: false, error: "บันทึกรูปไม่สำเร็จ กรุณาลองใหม่อีกครั้ง" };
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
    return { ok: false, error: "บันทึกรูปไม่สำเร็จ กรุณาลองใหม่อีกครั้ง" };
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
    return { ok: false, error: "บันทึกรูปไม่สำเร็จ กรุณาลองใหม่อีกครั้ง" };
  }

  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "ยังไม่ได้เข้าสู่ระบบ" };

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
    return { ok: false, error: "บันทึกรูปไม่สำเร็จ กรุณาลองใหม่อีกครั้ง" };
  }

  // Parent read under caller RLS (maybeSingle — no existence leak) to
  // rebuild the canonical path from project_id.
  const { data: pr } = await supabase
    .from("purchase_requests")
    .select("id, status, work_packages ( project_id )")
    .eq("id", input.purchaseRequestId)
    .maybeSingle();
  const projectId = pr?.work_packages?.project_id;
  if (!pr || pr.status !== "requested" || !projectId) {
    return { ok: false, error: "บันทึกรูปไม่สำเร็จ กรุณาลองใหม่อีกครั้ง" };
  }

  const storagePath = buildPrAttachmentStoragePath(
    projectId,
    input.purchaseRequestId,
    input.attachmentId,
    input.ext as PhotoExt,
  );
  if (!storagePath) {
    return { ok: false, error: "บันทึกรูปไม่สำเร็จ กรุณาลองใหม่อีกครั้ง" };
  }

  const { error } = await supabase.from("purchase_request_attachments").insert({
    id: input.attachmentId,
    purchase_request_id: input.purchaseRequestId,
    kind: "image",
    purpose: "reference",
    storage_path: storagePath,
    created_by: user.id,
  });
  if (error) return { ok: false, error: "บันทึกรูปไม่สำเร็จ กรุณาลองใหม่อีกครั้ง" };

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
    return { ok: false, error: "ลบรายการแนบไม่สำเร็จ กรุณาลองใหม่อีกครั้ง" };
  }

  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "ยังไม่ได้เข้าสู่ระบบ" };

  // Read the target under caller RLS to mirror its parent/kind/purpose
  // into the tombstone (the composite FK requires same parent + kind).
  const { data: target } = await supabase
    .from("purchase_request_attachments")
    .select("id, purchase_request_id, kind, purpose")
    .eq("id", input.attachmentId)
    .maybeSingle();
  if (!target) {
    return { ok: false, error: "ลบรายการแนบไม่สำเร็จ กรุณาลองใหม่อีกครั้ง" };
  }

  const { error } = await supabase.from("purchase_request_attachments").insert({
    purchase_request_id: target.purchase_request_id,
    kind: target.kind,
    purpose: target.purpose,
    superseded_by: target.id,
    created_by: user.id,
  });
  if (error) {
    return { ok: false, error: "ลบรายการแนบไม่สำเร็จ กรุณาลองใหม่อีกครั้ง" };
  }

  revalidatePath("/requests");
  return { ok: true };
}

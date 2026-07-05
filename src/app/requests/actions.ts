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
import { prProjectId } from "@/lib/purchasing/pr-project-id";
import { buildPoAttachmentStoragePath } from "@/lib/purchasing/po-attachment-path";
import {
  attachmentKindForExt,
  isValidAttachmentExt,
  type AttachmentFileKind,
} from "@/lib/purchasing/attachment-file";
import { validateAttachmentLink } from "@/lib/purchasing/validate-attachment";
import {
  validateCreatePurchaseRequest,
  toStoreBoundPurchase,
  isDecisionCommentValid,
  isPurchaseDecision,
  type PurchaseDecision,
} from "@/lib/purchasing/validate-purchase-request";
import { validateRecordPurchase } from "@/lib/purchasing/validate-record-purchase";
import { validateCreatePurchaseOrder } from "@/lib/purchasing/validate-create-purchase-order";
import { voidPurchaseOrderErrorMessage } from "@/lib/purchasing/purchase-order";
import { validateSitePurchase } from "@/lib/purchasing/validate-site-purchase";
import { UUID_REGEX } from "@/lib/validate/uuid";

// Spec 65: file-local consts for the Thai error strings this module
// repeats (the workers/actions.ts pattern). Single-use strings stay
// inline at their call sites.
const ERR_INVALID_REQUEST_ID = "รหัสคำขอไม่ถูกต้อง";
const ERR_SAVE_PHOTO_FAILED = "บันทึกรูปไม่สำเร็จ กรุณาลองใหม่อีกครั้ง";
const ERR_SAVE_DOC_FAILED = "บันทึกเอกสารไม่สำเร็จ กรุณาลองใหม่อีกครั้ง";
const ERR_REMOVE_ATTACHMENT_FAILED = "ลบรายการแนบไม่สำเร็จ กรุณาลองใหม่อีกครั้ง";

export interface CreatePurchaseRequestInput {
  // Spec 195 P1: scope. project-bound; the work package is OPTIONAL (null = a
  // project-level / store-bound request "ทั้งโครงการ"). At least one is required.
  projectId?: string | null | undefined;
  workPackageId?: string | null | undefined;
  itemDescription: string;
  quantity: number;
  unit: string;
  neededBy?: string | null | undefined;
  priority?: string | null | undefined;
  notes?: string | null | undefined;
  // Spec 176 U4: the reactive-reason tag — required (validated below).
  reasonCode?: string | null | undefined;
  // Spec 179: optional catalog link — the picked catalog_items.id, or null/omitted
  // for an off-catalog free-text request.
  catalogItemId?: string | null | undefined;
}

export type CreatePurchaseRequestResult = { ok: true; id: string } | { ok: false; error: string };

export async function createPurchaseRequest(
  input: CreatePurchaseRequestInput,
): Promise<CreatePurchaseRequestResult> {
  const validated = validateCreatePurchaseRequest(input);
  if (!validated.ok) return validated;

  // Spec 208 U4a / ADR 0065 — store-only: a manual PR is always store-bound
  // (project-scoped, work_package_id NULL) and catalogued. This gate is the
  // server-side guard (the form already enforces both); off-catalog or
  // project-less would book nothing at receipt → cost vanishes.
  const storeBound = toStoreBoundPurchase({
    projectId: validated.value.projectId,
    catalogItemId: validated.value.catalogItemId,
  });
  if (!storeBound.ok) return storeBound;

  const auth = await getActionUser();
  if (!auth) return { ok: false, error: NOT_SIGNED_IN };
  const { supabase, user } = auth;

  const { data, error } = await supabase
    .from("purchase_requests")
    .insert({
      // Spec 208 U4a / ADR 0065: every purchase is store-bound — work_package_id
      // is forced NULL so the material lands in the project store at receipt and
      // is เบิก'd to a WP later (the WP intent, if any, is no longer recorded here).
      work_package_id: null,
      project_id: storeBound.value.projectId,
      item_description: validated.value.itemDescription,
      quantity: validated.value.quantity,
      unit: validated.value.unit,
      needed_by: validated.value.neededBy,
      priority: validated.value.priority,
      notes: validated.value.notes,
      reason_code: validated.value.reasonCode,
      // Spec 179/208 U4a: the catalog master link — required under store-only.
      catalog_item_id: storeBound.value.catalogItemId,
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

// Read the parent under caller RLS (maybeSingle — no existence leak), to rebuild
// the canonical path. The PR's own project_id is the source (NOT NULL since spec
// 195 P1; store-bound PRs have no WP); the WP join stays as a belt-and-braces
// fallback. See prProjectId.
async function readPrParent(supabase: ActionAuth["supabase"], purchaseRequestId: string) {
  return await supabase
    .from("purchase_requests")
    .select("id, status, project_id, work_packages ( project_id )")
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
    // Spec 121: a stored-bytes row is image OR pdf — the replay check must
    // pin the actual kind (an id-only check would let a forged replay claim
    // a foreign row, spec-35 lesson).
    kind: AttachmentFileKind;
    purpose: "delivery_confirmation" | "reference" | "invoice" | "quote" | "payment";
    storagePath: string;
  },
): Promise<boolean> {
  const { data } = await supabase
    .from("purchase_request_attachments")
    .select("id")
    .eq("id", args.attachmentId)
    .eq("purchase_request_id", args.purchaseRequestId)
    .eq("kind", args.kind)
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
  const projectId = prProjectId(pr);
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
      kind: "image",
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
  // Spec 121: an invoice/receipt may be a PDF (kind 'pdf') or a photo
  // (kind 'image'); the kind is derived from the validated ext.
  if (!isValidAttachmentExt(input.ext)) {
    return { ok: false, error: ERR_SAVE_PHOTO_FAILED };
  }
  const fileKind: AttachmentFileKind = attachmentKindForExt(input.ext);

  const auth = await getActionUser();
  if (!auth) return { ok: false, error: NOT_SIGNED_IN };
  const { supabase, user } = auth;

  const { data: pr } = await readPrParent(supabase, input.purchaseRequestId);
  const projectId = prProjectId(pr);
  if (!pr || !projectId) {
    return { ok: false, error: ERR_SAVE_PHOTO_FAILED };
  }

  const storagePath = buildPrAttachmentStoragePath(
    projectId,
    input.purchaseRequestId,
    input.attachmentId,
    input.ext,
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
      kind: fileKind,
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
    kind: fileKind,
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
      kind: fileKind,
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

// addPaymentProofAttachment (procurement bug 2): the buyer's proof of payment
// (สลิปโอน / หลักฐานการชำระเงิน) — distinct from the supplier's invoice/receipt.
// Mirrors addInvoiceAttachment but purpose 'payment'; same parent gate (a payment
// exists once the PR is purchased). RLS re-enforces purpose + status.
export async function addPaymentProofAttachment(
  input: AddDeliveryConfirmationPhotoInput,
): Promise<AttachmentActionResult> {
  if (!UUID_REGEX.test(input.purchaseRequestId) || !UUID_REGEX.test(input.attachmentId)) {
    return { ok: false, error: ERR_SAVE_PHOTO_FAILED };
  }
  if (!isValidAttachmentExt(input.ext)) {
    return { ok: false, error: ERR_SAVE_PHOTO_FAILED };
  }
  const fileKind: AttachmentFileKind = attachmentKindForExt(input.ext);

  const auth = await getActionUser();
  if (!auth) return { ok: false, error: NOT_SIGNED_IN };
  const { supabase, user } = auth;

  const { data: pr } = await readPrParent(supabase, input.purchaseRequestId);
  const projectId = prProjectId(pr);
  if (!pr || !projectId) {
    return { ok: false, error: ERR_SAVE_PHOTO_FAILED };
  }

  const storagePath = buildPrAttachmentStoragePath(
    projectId,
    input.purchaseRequestId,
    input.attachmentId,
    input.ext,
  );
  if (!storagePath) {
    return { ok: false, error: ERR_SAVE_PHOTO_FAILED };
  }

  if (!(INVOICE_PARENT_STATUSES as readonly string[]).includes(pr.status)) {
    const landed = await findLandedAttachment(supabase, {
      attachmentId: input.attachmentId,
      purchaseRequestId: input.purchaseRequestId,
      kind: fileKind,
      purpose: "payment",
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
    kind: fileKind,
    purpose: "payment",
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
      kind: fileKind,
      purpose: "payment",
      storagePath,
    });
    if (!landed) {
      return { ok: false, error: ERR_SAVE_PHOTO_FAILED };
    }
  }

  revalidatePath("/requests");
  return { ok: true };
}

// addReferenceAttachment (spec 211 U11b): a self-purchase's ITEM photo — the
// picture of WHAT was bought, distinct from the receipt/invoice (docs). Mirrors
// addInvoiceAttachment but purpose 'reference', gated to a site_purchased parent
// — where record_site_purchase lands the PR, and where the widened reference RLS
// arm now admits the insert. The creation-time reference (status 'requested')
// keeps its own staging path; this is the post-record item image for an on-site
// cash buy.

const SITE_PURCHASE_REFERENCE_STATUSES = ["site_purchased"] as const;

export async function addReferenceAttachment(
  input: AddDeliveryConfirmationPhotoInput,
): Promise<AttachmentActionResult> {
  if (!UUID_REGEX.test(input.purchaseRequestId) || !UUID_REGEX.test(input.attachmentId)) {
    return { ok: false, error: ERR_SAVE_PHOTO_FAILED };
  }
  if (!isValidAttachmentExt(input.ext)) {
    return { ok: false, error: ERR_SAVE_PHOTO_FAILED };
  }
  const fileKind: AttachmentFileKind = attachmentKindForExt(input.ext);

  const auth = await getActionUser();
  if (!auth) return { ok: false, error: NOT_SIGNED_IN };
  const { supabase, user } = auth;

  const { data: pr } = await readPrParent(supabase, input.purchaseRequestId);
  const projectId = prProjectId(pr);
  if (!pr || !projectId) {
    return { ok: false, error: ERR_SAVE_PHOTO_FAILED };
  }

  const storagePath = buildPrAttachmentStoragePath(
    projectId,
    input.purchaseRequestId,
    input.attachmentId,
    input.ext,
  );
  if (!storagePath) {
    return { ok: false, error: ERR_SAVE_PHOTO_FAILED };
  }

  if (!(SITE_PURCHASE_REFERENCE_STATUSES as readonly string[]).includes(pr.status)) {
    const landed = await findLandedAttachment(supabase, {
      attachmentId: input.attachmentId,
      purchaseRequestId: input.purchaseRequestId,
      kind: fileKind,
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
    kind: fileKind,
    purpose: "reference",
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
      kind: fileKind,
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

// addPurchaseOrderAttachment (spec 125 / ADR 0046 Layer B): the PO source
// document (quotation/invoice). Mirrors addInvoiceAttachment but the parent is
// a purchase_order (no status gate — a PO doc attaches whenever the PO exists)
// and the bytes live in the po-attachments bucket at {po_id}/{att}.{ext}. The
// browser already uploaded the bytes (upload-on-submit, ADR 0046 decision 3);
// this records the metadata row, rebuilding the path server-side (a client path
// is never trusted) and deriving the kind from the validated ext.

export interface AddPurchaseOrderAttachmentInput {
  purchaseOrderId: string;
  attachmentId: string;
  ext: string;
}

export async function addPurchaseOrderAttachment(
  input: AddPurchaseOrderAttachmentInput,
): Promise<AttachmentActionResult> {
  if (!UUID_REGEX.test(input.purchaseOrderId) || !UUID_REGEX.test(input.attachmentId)) {
    return { ok: false, error: ERR_SAVE_DOC_FAILED };
  }
  if (!isValidAttachmentExt(input.ext)) {
    return { ok: false, error: ERR_SAVE_DOC_FAILED };
  }
  const fileKind: AttachmentFileKind = attachmentKindForExt(input.ext);

  const auth = await getActionUser();
  if (!auth) return { ok: false, error: NOT_SIGNED_IN };
  const { supabase, user } = auth;

  // Confirm the PO is visible to the caller under RLS (existence + back-office
  // visibility) before recording — the INSERT policy re-enforces both.
  const { data: po } = await supabase
    .from("purchase_orders")
    .select("id")
    .eq("id", input.purchaseOrderId)
    .maybeSingle();
  if (!po) {
    return { ok: false, error: ERR_SAVE_DOC_FAILED };
  }

  const storagePath = buildPoAttachmentStoragePath(
    input.purchaseOrderId,
    input.attachmentId,
    input.ext,
  );
  if (!storagePath) {
    return { ok: false, error: ERR_SAVE_DOC_FAILED };
  }

  const { error } = await supabase.from("purchase_order_attachments").insert({
    id: input.attachmentId,
    purchase_order_id: input.purchaseOrderId,
    kind: fileKind,
    storage_path: storagePath,
    created_by: user.id,
  });
  if (error) {
    // Idempotent replay (identity-complete, spec 37 lesson): a retried upload
    // whose row already landed but whose response was lost confirms as success.
    if (error.code !== "23505") {
      return { ok: false, error: ERR_SAVE_DOC_FAILED };
    }
    const { data: landed } = await supabase
      .from("purchase_order_attachments")
      .select("id")
      .eq("id", input.attachmentId)
      .eq("purchase_order_id", input.purchaseOrderId)
      .eq("kind", fileKind)
      .eq("storage_path", storagePath)
      .maybeSingle();
    if (!landed) {
      return { ok: false, error: ERR_SAVE_DOC_FAILED };
    }
  }

  revalidatePath("/requests");
  return { ok: true };
}

// addProofOfDeliveryAttachment (spec 134 U4a; spec 135 U4 scopes it to a delivery):
// a MANUAL proof-of-delivery (a signed delivery note / photo of received goods)
// attaches in the SAME po-attachments bucket as the source document but stamped
// purpose 'proof_of_delivery' so it renders in its own section (and the future
// Lalamove auto-POD, U4b, fans into this same purpose). Spec 135 U4: the proof
// belongs to a DELIVERY (งวด) — stamp delivery_id, validated to belong to the PO.
// The INSERT policy (back office / own-author / parent exists) re-enforces the gate.

export interface AddProofOfDeliveryInput extends AddPurchaseOrderAttachmentInput {
  deliveryId: string;
}

export async function addProofOfDeliveryAttachment(
  input: AddProofOfDeliveryInput,
): Promise<AttachmentActionResult> {
  if (!UUID_REGEX.test(input.purchaseOrderId) || !UUID_REGEX.test(input.attachmentId)) {
    return { ok: false, error: ERR_SAVE_DOC_FAILED };
  }
  if (!UUID_REGEX.test(input.deliveryId)) {
    return { ok: false, error: ERR_SAVE_DOC_FAILED };
  }
  if (!isValidAttachmentExt(input.ext)) {
    return { ok: false, error: ERR_SAVE_DOC_FAILED };
  }
  const fileKind: AttachmentFileKind = attachmentKindForExt(input.ext);

  const auth = await getActionUser();
  if (!auth) return { ok: false, error: NOT_SIGNED_IN };
  const { supabase, user } = auth;

  const { data: po } = await supabase
    .from("purchase_orders")
    .select("id")
    .eq("id", input.purchaseOrderId)
    .maybeSingle();
  if (!po) {
    return { ok: false, error: ERR_SAVE_DOC_FAILED };
  }

  // The delivery must belong to this PO (a proof can't be scoped to another order's
  // delivery). RLS already limits readable deliveries to the caller's POs.
  const { data: delivery } = await supabase
    .from("purchase_order_deliveries")
    .select("id")
    .eq("id", input.deliveryId)
    .eq("purchase_order_id", input.purchaseOrderId)
    .maybeSingle();
  if (!delivery) {
    return { ok: false, error: ERR_SAVE_DOC_FAILED };
  }

  const storagePath = buildPoAttachmentStoragePath(
    input.purchaseOrderId,
    input.attachmentId,
    input.ext,
  );
  if (!storagePath) {
    return { ok: false, error: ERR_SAVE_DOC_FAILED };
  }

  const { error } = await supabase.from("purchase_order_attachments").insert({
    id: input.attachmentId,
    purchase_order_id: input.purchaseOrderId,
    delivery_id: input.deliveryId,
    kind: fileKind,
    purpose: "proof_of_delivery",
    storage_path: storagePath,
    created_by: user.id,
  });
  if (error) {
    // Idempotent replay (identity-complete, spec 37): a retried upload whose row
    // already landed but whose response was lost confirms as success.
    if (error.code !== "23505") {
      return { ok: false, error: ERR_SAVE_DOC_FAILED };
    }
    const { data: landed } = await supabase
      .from("purchase_order_attachments")
      .select("id")
      .eq("id", input.attachmentId)
      .eq("purchase_order_id", input.purchaseOrderId)
      .eq("kind", fileKind)
      .eq("storage_path", storagePath)
      .maybeSingle();
    if (!landed) {
      return { ok: false, error: ERR_SAVE_DOC_FAILED };
    }
  }

  revalidatePath("/requests");
  return { ok: true };
}

// splitPurchaseRequestOnReceipt (spec 134 U3 / ADR 0052): a strictly-partial
// receipt against an in-transit PO member — splits it into a delivered portion (the
// original, reduced) + a remaining child (on_route). Relays the guarded SECURITY
// DEFINER RPC, which re-enforces the back-office gate + the qty/amount guards. The
// delivered amount is optional: omitted → proportional by qty; supplied → the
// buyer's value (ADR 0052 §4).
const ERR_SPLIT_FAILED = "บันทึกการรับบางส่วนไม่สำเร็จ กรุณาลองใหม่อีกครั้ง";

export interface SplitPurchaseRequestInput {
  requestId: string;
  receivedQty: number;
  deliveredAmount?: number | null;
  deliveryNote?: string | null;
}

export async function splitPurchaseRequestOnReceipt(
  input: SplitPurchaseRequestInput,
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!UUID_REGEX.test(input.requestId)) {
    return { ok: false, error: ERR_SPLIT_FAILED };
  }
  if (!Number.isFinite(input.receivedQty) || input.receivedQty <= 0) {
    return { ok: false, error: ERR_SPLIT_FAILED };
  }

  const auth = await getActionUser();
  if (!auth) return { ok: false, error: NOT_SIGNED_IN };
  const { supabase } = auth;

  const { error } = await supabase.rpc("split_purchase_request_on_receipt", {
    p_request_id: input.requestId,
    p_received_qty: input.receivedQty,
    ...(input.deliveredAmount != null ? { p_delivered_amount: input.deliveredAmount } : {}),
    ...(input.deliveryNote ? { p_delivery_note: input.deliveryNote } : {}),
  });
  if (error) {
    console.error("[split-on-receipt] rpc failed", error);
    return { ok: false, error: ERR_SPLIT_FAILED };
  }

  revalidatePath("/requests");
  return { ok: true };
}

// receivePoLines (spec 134 U5 / ADR 0053): mark the chosen in-transit PO members
// delivered in one action (the 85% whole-PO / 14% whole-ticket-subset cases).
// Relays the guarded receive_po_lines RPC (back-office gate + in-transit-only +
// all-or-nothing re-enforced server-side).
const ERR_RECEIVE_FAILED = "บันทึกการรับของไม่สำเร็จ กรุณาลองใหม่อีกครั้ง";

export interface ReceivePoLinesInput {
  requestIds: string[];
  receivedBy?: string | null;
  deliveryNote?: string | null;
}

export async function receivePoLines(
  input: ReceivePoLinesInput,
): Promise<{ ok: true; received: number } | { ok: false; error: string }> {
  if (!Array.isArray(input.requestIds) || input.requestIds.length === 0) {
    return { ok: false, error: ERR_RECEIVE_FAILED };
  }
  if (!input.requestIds.every((id) => UUID_REGEX.test(id))) {
    return { ok: false, error: ERR_RECEIVE_FAILED };
  }

  const auth = await getActionUser();
  if (!auth) return { ok: false, error: NOT_SIGNED_IN };
  const { supabase } = auth;

  const { data, error } = await supabase.rpc("receive_po_lines", {
    p_request_ids: input.requestIds,
    ...(input.receivedBy ? { p_received_by: input.receivedBy } : {}),
    ...(input.deliveryNote ? { p_delivery_note: input.deliveryNote } : {}),
  });
  if (error) {
    console.error("[receive-po-lines] rpc failed", error);
    return { ok: false, error: ERR_RECEIVE_FAILED };
  }

  revalidatePath("/requests");
  return { ok: true, received: typeof data === "number" ? data : input.requestIds.length };
}

// splitPurchaseOrderDelivery (spec 135 U3 / ADR 0054): procurement plans a PO's
// deliveries (งวดส่ง) — move selected in-transit lines into a NEW delivery with its
// own eta/note/cost. Relays the guarded SECURITY DEFINER RPC, which re-enforces the
// back-office gate + the membership/in-transit/non-empty guards. Site never creates.
const ERR_SPLIT_DELIVERY_FAILED = "สร้างงวดจัดส่งไม่สำเร็จ กรุณาลองใหม่อีกครั้ง";

export interface SplitPoDeliveryInput {
  purchaseOrderId: string;
  requestIds: string[];
  eta?: string | null;
  note?: string | null;
  cost?: number | null;
}

export async function splitPurchaseOrderDelivery(
  input: SplitPoDeliveryInput,
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!UUID_REGEX.test(input.purchaseOrderId)) {
    return { ok: false, error: ERR_SPLIT_DELIVERY_FAILED };
  }
  if (!Array.isArray(input.requestIds) || input.requestIds.length === 0) {
    return { ok: false, error: ERR_SPLIT_DELIVERY_FAILED };
  }
  if (!input.requestIds.every((id) => UUID_REGEX.test(id))) {
    return { ok: false, error: ERR_SPLIT_DELIVERY_FAILED };
  }
  if (input.cost != null && (!Number.isFinite(input.cost) || input.cost < 0)) {
    return { ok: false, error: ERR_SPLIT_DELIVERY_FAILED };
  }

  const auth = await getActionUser();
  if (!auth) return { ok: false, error: NOT_SIGNED_IN };
  const { supabase } = auth;

  const { error } = await supabase.rpc("split_purchase_order_delivery", {
    p_purchase_order_id: input.purchaseOrderId,
    p_request_ids: input.requestIds,
    ...(input.eta ? { p_eta: input.eta } : {}),
    ...(input.note ? { p_note: input.note } : {}),
    ...(input.cost != null ? { p_cost: input.cost } : {}),
  });
  if (error) {
    console.error("[split-po-delivery] rpc failed", error);
    return { ok: false, error: ERR_SPLIT_DELIVERY_FAILED };
  }

  revalidatePath("/requests");
  return { ok: true };
}

// dispatchPurchaseOrderDelivery (spec 135 U6 / ADR 0054): records that a delivery
// (งวด) is on its way — marks its purchased lines shipped, so the PO advances
// ordered → in_transit (กำลังจัดส่ง). Relays the guarded RPC (back-office gate; the
// trigger chain does the on_route flip + audit). Returns how many lines were marked.
const ERR_DISPATCH_FAILED = "บันทึกการจัดส่งไม่สำเร็จ กรุณาลองใหม่อีกครั้ง";

export async function dispatchPurchaseOrderDelivery(
  deliveryId: string,
): Promise<{ ok: true; dispatched: number } | { ok: false; error: string }> {
  if (!UUID_REGEX.test(deliveryId)) {
    return { ok: false, error: ERR_DISPATCH_FAILED };
  }

  const auth = await getActionUser();
  if (!auth) return { ok: false, error: NOT_SIGNED_IN };
  const { supabase } = auth;

  const { data, error } = await supabase.rpc("dispatch_purchase_order_delivery", {
    p_delivery_id: deliveryId,
  });
  if (error) {
    console.error("[dispatch-delivery] rpc failed", error);
    return { ok: false, error: ERR_DISPATCH_FAILED };
  }

  revalidatePath("/requests");
  return { ok: true, dispatched: typeof data === "number" ? data : 0 };
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
  // Spec 176 U4: required reactive-reason tag (validated below).
  reasonCode?: string | null | undefined;
  // Spec 211 U11c-B: VAT rate (%) of a tax-invoiced buy; 0/absent = cash. > 0
  // makes record_site_purchase split the reclaimable Input VAT (1300).
  vatRate?: number | null | undefined;
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
    // Spec 176 U4: required reactive-reason tag.
    p_reason_code: validated.value.reasonCode,
    // Spec 103: omit when null so the RPC default applies (no amount recorded).
    ...(validated.value.amount !== null ? { p_amount: validated.value.amount } : {}),
    // Spec 211 U11c-B: pass the VAT rate only when set (0 → RPC default, no split).
    ...(validated.value.vatRate > 0 ? { p_vat_rate: validated.value.vatRate } : {}),
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
  // Spec 121: a file reference attachment is an image or a PDF; the server
  // authoritatively derives the stored kind from the validated ext.
  | { purchaseRequestId: string; kind: "image" | "pdf"; attachmentId: string; ext: string }
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

  if (!UUID_REGEX.test(input.attachmentId) || !isValidAttachmentExt(input.ext)) {
    return { ok: false, error: ERR_SAVE_PHOTO_FAILED };
  }
  const fileKind: AttachmentFileKind = attachmentKindForExt(input.ext);

  const { data: pr } = await readPrParent(supabase, input.purchaseRequestId);
  const projectId = prProjectId(pr);
  if (!pr || !projectId) {
    return { ok: false, error: ERR_SAVE_PHOTO_FAILED };
  }

  const storagePath = buildPrAttachmentStoragePath(
    projectId,
    input.purchaseRequestId,
    input.attachmentId,
    input.ext,
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
      kind: fileKind,
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
    kind: fileKind,
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
      kind: fileKind,
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

// --- Price comparison: supplier quotes on an approved PR (spec 182) ----------
//
// addPurchaseQuote / removePurchaseQuote relay the SECURITY DEFINER RPCs, which
// own the back-office gate (PM/procurement/super/director), the approved-PR
// guard, and the one-quote-per-supplier rule. Money (unit_price) never reaches a
// site session — the quotes table is back-office-read only (RLS).

export interface AddPurchaseQuoteInput {
  purchaseRequestId: string;
  supplierId: string;
  unitPrice: number;
  note?: string | null;
}

export async function addPurchaseQuote(
  input: AddPurchaseQuoteInput,
): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  if (!UUID_REGEX.test(input.purchaseRequestId) || !UUID_REGEX.test(input.supplierId)) {
    return { ok: false, error: "ข้อมูลไม่ถูกต้อง" };
  }
  if (!Number.isFinite(input.unitPrice) || input.unitPrice < 0) {
    return { ok: false, error: "ราคาต่อหน่วยต้องไม่ติดลบ" };
  }

  const auth = await getActionUser();
  if (!auth) return { ok: false, error: NOT_SIGNED_IN };

  const { data, error } = await auth.supabase.rpc("add_purchase_quote", {
    p_purchase_request_id: input.purchaseRequestId,
    p_supplier_id: input.supplierId,
    p_unit_price: input.unitPrice,
    p_note: input.note ?? "",
  });
  if (error || !data) {
    if (error?.code === "23505") {
      return { ok: false, error: "มีใบเสนอราคาของผู้ขายรายนี้แล้ว (ลบแล้วเพิ่มใหม่เพื่อแก้ราคา)" };
    }
    if (error?.code === "42501") return { ok: false, error: "ไม่มีสิทธิ์เพิ่มใบเสนอราคา" };
    if (error?.code === "22023") {
      return { ok: false, error: "เพิ่มใบเสนอราคาไม่ได้ (คำขอต้องอนุมัติแล้ว)" };
    }
    return { ok: false, error: "เพิ่มใบเสนอราคาไม่สำเร็จ กรุณาลองใหม่อีกครั้ง" };
  }

  revalidatePath(`/requests/${input.purchaseRequestId}`);
  return { ok: true, id: data };
}

export async function removePurchaseQuote(input: {
  purchaseRequestId: string;
  quoteId: string;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!UUID_REGEX.test(input.purchaseRequestId) || !UUID_REGEX.test(input.quoteId)) {
    return { ok: false, error: "ข้อมูลไม่ถูกต้อง" };
  }

  const auth = await getActionUser();
  if (!auth) return { ok: false, error: NOT_SIGNED_IN };

  const { error } = await auth.supabase.rpc("remove_purchase_quote", { p_quote_id: input.quoteId });
  if (error) {
    if (error.code === "42501") return { ok: false, error: "ไม่มีสิทธิ์ลบใบเสนอราคา" };
    return { ok: false, error: "ลบใบเสนอราคาไม่สำเร็จ กรุณาลองใหม่อีกครั้ง" };
  }

  revalidatePath(`/requests/${input.purchaseRequestId}`);
  return { ok: true };
}

// addQuoteAttachment (spec 182 U4): the supplier's quotation document, attached
// to a purchase_quotes row. Mirrors addInvoiceAttachment — the browser already
// uploaded the bytes; this records the metadata, REBUILDS the canonical path
// server-side (a client path is never trusted) and derives the kind from the
// validated ext. Purpose 'quote' + quote_id; the RLS quote arm re-enforces the
// back-office gate, the approved-parent window, and that the quote is on this PR.
// Money posture: quote rows are back-office-read only (a RESTRICTIVE SELECT).

export interface AddQuoteAttachmentInput {
  purchaseRequestId: string;
  quoteId: string;
  attachmentId: string;
  ext: string;
}

export async function addQuoteAttachment(
  input: AddQuoteAttachmentInput,
): Promise<AttachmentActionResult> {
  if (
    !UUID_REGEX.test(input.purchaseRequestId) ||
    !UUID_REGEX.test(input.quoteId) ||
    !UUID_REGEX.test(input.attachmentId)
  ) {
    return { ok: false, error: ERR_SAVE_DOC_FAILED };
  }
  if (!isValidAttachmentExt(input.ext)) {
    return { ok: false, error: ERR_SAVE_DOC_FAILED };
  }
  const fileKind: AttachmentFileKind = attachmentKindForExt(input.ext);

  const auth = await getActionUser();
  if (!auth) return { ok: false, error: NOT_SIGNED_IN };
  const { supabase, user } = auth;

  const { data: pr } = await readPrParent(supabase, input.purchaseRequestId);
  const projectId = prProjectId(pr);
  if (!pr || !projectId) {
    return { ok: false, error: ERR_SAVE_DOC_FAILED };
  }

  const storagePath = buildPrAttachmentStoragePath(
    projectId,
    input.purchaseRequestId,
    input.attachmentId,
    input.ext,
  );
  if (!storagePath) {
    return { ok: false, error: ERR_SAVE_DOC_FAILED };
  }

  const { error } = await supabase.from("purchase_request_attachments").insert({
    id: input.attachmentId,
    purchase_request_id: input.purchaseRequestId,
    quote_id: input.quoteId,
    kind: fileKind,
    purpose: "quote",
    storage_path: storagePath,
    created_by: user.id,
  });
  if (error) {
    // Idempotent replay (identity-complete, spec 37): a retried upload whose row
    // already landed but whose response was lost confirms as success.
    if (error.code !== "23505") {
      return { ok: false, error: ERR_SAVE_DOC_FAILED };
    }
    const landed = await findLandedAttachment(supabase, {
      attachmentId: input.attachmentId,
      purchaseRequestId: input.purchaseRequestId,
      kind: fileKind,
      purpose: "quote",
      storagePath,
    });
    if (!landed) {
      return { ok: false, error: ERR_SAVE_DOC_FAILED };
    }
  }

  revalidatePath(`/requests/${input.purchaseRequestId}`);
  return { ok: true };
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
  // Spec 119: one VAT rate for the whole PO (0 = no VAT). The form has already
  // resolved each line's amount to the GROSS; this records the rate applied.
  vatRate?: number;
  // Spec 120: the supplier's order/invoice reference (carried from the retired
  // record_purchase form), one per PO.
  orderRef?: string;
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
    ...(input.vatRate != null ? { p_vat_rate: input.vatRate } : {}),
    ...(input.orderRef != null && input.orderRef.trim() !== ""
      ? { p_order_ref: input.orderRef }
      : {}),
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

export interface VoidPurchaseOrderInput {
  poId: string;
}

export type VoidPurchaseOrderResult = { ok: true } | { ok: false; error: string };

// Spec 259 / amends ADR 0038 — undo a mistakenly-created PO via
// void_purchase_order. Same session-client posture as createPurchaseOrder
// (role-gated DEFINER RPC, must run on the user session so auth.uid() is
// non-null). Member tickets return to 'approved' — the RPC handles the
// GL-safety reverse-or-skip per line and the audit row.
export async function voidPurchaseOrder(
  input: VoidPurchaseOrderInput,
): Promise<VoidPurchaseOrderResult> {
  if (!UUID_REGEX.test(input.poId)) return { ok: false, error: "รหัสใบสั่งซื้อไม่ถูกต้อง" };

  const auth = await getActionUser();
  if (!auth) return { ok: false, error: NOT_SIGNED_IN };
  const { supabase } = auth;

  const { error } = await supabase.rpc("void_purchase_order", {
    p_po_id: input.poId,
  });
  if (error) {
    // Spec 269: the RPC raises distinct errcodes per refusal site (PO404
    // not-found, PO409 shipped-line) — map through the pure helper; every
    // unrecognized code (incl. P0001) falls back to the generic message.
    return { ok: false, error: voidPurchaseOrderErrorMessage(error.code) };
  }

  revalidatePath("/requests");
  revalidatePath(`/requests/orders/${input.poId}`);
  return { ok: true };
}

// Spec 260 — PO-level charges (transport / discount / other). add is the same
// back-office gate as create_purchase_order (whoever bundles the PO records its
// charges); void is manager-only (un-booking recorded money). Both run on the
// user session (role-gated DEFINER RPCs). The amount>0 / 'other'-needs-note
// rules are DB CHECKs (surfaced here as a friendly message); the GL entry is
// enqueued by the table's AFTER-INSERT trigger, drained async.
export interface AddPurchaseOrderChargeInput {
  poId: string;
  chargeType: "transport" | "discount" | "other";
  amount: number;
  vatRate: number;
  note?: string | null;
}

export type AddPurchaseOrderChargeResult = { ok: true } | { ok: false; error: string };

export async function addPurchaseOrderCharge(
  input: AddPurchaseOrderChargeInput,
): Promise<AddPurchaseOrderChargeResult> {
  if (!UUID_REGEX.test(input.poId)) return { ok: false, error: "รหัสใบสั่งซื้อไม่ถูกต้อง" };
  if (!["transport", "discount", "other"].includes(input.chargeType)) {
    return { ok: false, error: "ประเภทค่าใช้จ่ายไม่ถูกต้อง" };
  }
  if (!Number.isFinite(input.amount) || input.amount <= 0) {
    return { ok: false, error: "จำนวนเงินต้องมากกว่า 0" };
  }
  if (input.chargeType === "other" && (input.note ?? "").trim() === "") {
    return { ok: false, error: "กรุณาระบุรายละเอียดสำหรับค่าใช้จ่ายอื่น" };
  }

  const auth = await getActionUser();
  if (!auth) return { ok: false, error: NOT_SIGNED_IN };
  const { supabase } = auth;

  const { error } = await supabase.rpc("add_purchase_order_charge", {
    p_po_id: input.poId,
    p_charge_type: input.chargeType,
    p_amount: input.amount,
    p_vat_rate: input.vatRate,
    // The RPC nullifs an empty/whitespace note, so "" is identical to NULL here
    // (the generated type makes the required text param non-nullable).
    p_note: input.note ?? "",
  });
  if (error) {
    if (error.code === "42501") return { ok: false, error: "ไม่มีสิทธิ์เพิ่มค่าใช้จ่าย" };
    if (error.code === "23514") {
      return { ok: false, error: "ข้อมูลค่าใช้จ่ายไม่ถูกต้อง (จำนวนเงิน หรือรายละเอียด)" };
    }
    if (error.code === "P0001") return { ok: false, error: "ไม่พบใบสั่งซื้อนี้" };
    return { ok: false, error: "เพิ่มค่าใช้จ่ายไม่สำเร็จ กรุณาลองใหม่อีกครั้ง" };
  }

  revalidatePath("/requests");
  revalidatePath(`/requests/orders/${input.poId}`);
  return { ok: true };
}

export interface VoidPurchaseOrderChargeInput {
  chargeId: string;
  // Revalidation target only (the RPC keys off chargeId alone).
  poId: string;
}

export type VoidPurchaseOrderChargeResult = { ok: true } | { ok: false; error: string };

export async function voidPurchaseOrderCharge(
  input: VoidPurchaseOrderChargeInput,
): Promise<VoidPurchaseOrderChargeResult> {
  if (!UUID_REGEX.test(input.chargeId)) return { ok: false, error: "รหัสค่าใช้จ่ายไม่ถูกต้อง" };

  const auth = await getActionUser();
  if (!auth) return { ok: false, error: NOT_SIGNED_IN };
  const { supabase } = auth;

  const { error } = await supabase.rpc("void_purchase_order_charge", {
    p_charge_id: input.chargeId,
  });
  if (error) {
    if (error.code === "42501")
      return { ok: false, error: "ไม่มีสิทธิ์ลบค่าใช้จ่าย (เฉพาะผู้จัดการ)" };
    if (error.code === "P0001") return { ok: false, error: "ไม่พบค่าใช้จ่ายนี้" };
    return { ok: false, error: "ลบค่าใช้จ่ายไม่สำเร็จ กรุณาลองใหม่อีกครั้ง" };
  }

  revalidatePath("/requests");
  if (UUID_REGEX.test(input.poId)) revalidatePath(`/requests/orders/${input.poId}`);
  return { ok: true };
}

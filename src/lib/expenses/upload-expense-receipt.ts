// Spec 310 U10 — one client-side helper to attach a receipt file to an already
// recorded office expense: prepare (PDF passthrough / photo downscale) → upload
// the bytes to the expense-attachments bucket at the canonical path →
// addExpenseReceipt (metadata; the server rebuilds the path). Shared by the form
// (hold-then-upload-on-submit, attachments-on-top) and ExpenseReceiptUploader
// (the post-record retry slot). Idempotent on the server (23505 replay).

import { addExpenseReceipt, type ExpenseDocPurpose } from "@/app/expenses/actions";
import { createClient } from "@/lib/db/browser";
import { buildExpenseAttachmentPath } from "@/lib/expenses/attachment-path";
import { preparePhotoForUpload } from "@/lib/photos/downscale";
import { classifyStorageUploadError } from "@/lib/photos/upload-queue";
import {
  attachmentExtToMime,
  isPdfMime,
  type AttachmentExt,
} from "@/lib/purchasing/attachment-file";

export type UploadReceiptResult = { ok: true } | { ok: false; error: string };

export async function uploadExpenseReceiptFile(
  officeExpenseId: string,
  file: File,
  purpose: ExpenseDocPurpose,
): Promise<UploadReceiptResult> {
  let blob: Blob;
  let ext: AttachmentExt;
  if (isPdfMime(file.type)) {
    blob = file;
    ext = "pdf";
  } else {
    const prepared = await preparePhotoForUpload(file);
    if (!prepared) return { ok: false, error: "ไฟล์นี้ไม่รองรับ กรุณาเลือกรูปภาพหรือ PDF" };
    blob = prepared.blob;
    ext = prepared.ext;
  }

  const attachmentId = crypto.randomUUID();
  const path = buildExpenseAttachmentPath(officeExpenseId, attachmentId, ext);
  if (!path) return { ok: false, error: "แนบใบเสร็จไม่สำเร็จ กรุณาลองใหม่อีกครั้ง" };

  const supabase = createClient();
  const { error: uploadError } = await supabase.storage
    .from("expense-attachments")
    .upload(path, blob, { upsert: false, contentType: attachmentExtToMime(ext) });
  if (uploadError && !classifyStorageUploadError(uploadError).alreadyExists) {
    return { ok: false, error: "ส่งใบเสร็จไม่สำเร็จ กรุณาลองใหม่อีกครั้ง" };
  }

  let result: Awaited<ReturnType<typeof addExpenseReceipt>>;
  try {
    result = await addExpenseReceipt({ officeExpenseId, attachmentId, ext, purpose });
  } catch (err) {
    console.error("[upload-expense-receipt] action invocation failed", err);
    return { ok: false, error: "แนบใบเสร็จไม่สำเร็จ กรุณาลองใหม่อีกครั้ง" };
  }
  if (!result.ok) return { ok: false, error: result.error };
  return { ok: true };
}

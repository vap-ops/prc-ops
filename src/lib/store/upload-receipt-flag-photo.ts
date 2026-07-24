// Spec 324 U6 — upload the SA's live-camera evidence photo for a receipt-miscount
// flag. Mirrors the spec-303 goods-photo pipeline (downscale → upload the bytes
// to pr-attachments at the canonical PR-keyed path), but returns the storage PATH
// so the flag RPC (submit_receipt_correction_request) can store it directly. The
// path is keyed on the receipt's purchase_request_id, so the SA flag is offered
// only on PO-delivery receipts (the pr-attachments INSERT policy gates the write
// to a delivered PR the SA can see — fix #456 admits WP-less store deliveries).

import { createClient } from "@/lib/db/browser";
import { preparePhotoForUpload } from "@/lib/photos/downscale";
import { photoExtToMime } from "@/lib/photos/path";
import { classifyStorageUploadError } from "@/lib/photos/upload-queue";
import { buildPrAttachmentStoragePath } from "@/lib/purchasing/attachment-path";
import { PR_ATTACHMENTS_BUCKET } from "@/lib/storage/buckets";
import { captureMethodMetadata } from "@/lib/photos/capture-method";

export type FlagPhotoUploadResult = { ok: true; path: string } | { ok: false; error: string };

export async function uploadReceiptFlagPhoto(
  projectId: string,
  purchaseRequestId: string,
  file: File,
): Promise<FlagPhotoUploadResult> {
  // Spec 34 / ADR 0036: downscale before upload (failure → unsupported file).
  const prepared = await preparePhotoForUpload(file);
  if (!prepared) {
    return { ok: false, error: "ไฟล์นี้ไม่รองรับ กรุณาถ่ายรูปใหม่ (JPEG, PNG, WebP, HEIC)" };
  }
  const attachmentId = crypto.randomUUID();
  const path = buildPrAttachmentStoragePath(
    projectId,
    purchaseRequestId,
    attachmentId,
    prepared.ext,
  );
  if (!path) return { ok: false, error: "อัปโหลดรูปไม่สำเร็จ กรุณาลองใหม่อีกครั้ง" };

  const supabase = createClient();
  const { error } = await supabase.storage.from(PR_ATTACHMENTS_BUCKET).upload(path, prepared.blob, {
    upsert: false,
    contentType: photoExtToMime(prepared.ext),
    // Spec 352 U2: the only caller (receipt-flag-sheet) is camera-forced
    // (capture="environment", spec 324 U6) — fixed "camera", not per-call.
    metadata: captureMethodMetadata("camera"),
  });
  if (error && !classifyStorageUploadError(error).alreadyExists) {
    return { ok: false, error: "ส่งรูปไม่สำเร็จ กรุณาลองใหม่อีกครั้ง" };
  }
  return { ok: true, path };
}

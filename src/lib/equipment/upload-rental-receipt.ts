// Spec 323 U1d — attach a receipt file to a rental settlement: prepare (PDF
// passthrough / photo downscale) → upload the bytes to the private
// rental-settlement-receipts bucket at the canonical path (the client's own session,
// permitted by the BACK_OFFICE-scoped storage INSERT policy) → addRentalSettlementReceipt
// (the metadata row, written admin-side because the table is zero-grant; the server
// REBUILDS the path). Mirrors upload-expense-receipt; idempotent on the server (23505).

import {
  addRentalSettlementReceipt,
  type RentalReceiptPurpose,
} from "@/app/equipment/rentals/receipt-actions";
import { createClient } from "@/lib/db/browser";
import { buildRentalReceiptPath } from "@/lib/equipment/rental-receipt-path";
import { preparePhotoForUpload } from "@/lib/photos/downscale";
import { classifyStorageUploadError } from "@/lib/photos/upload-queue";
import {
  attachmentExtToMime,
  isPdfMime,
  type AttachmentExt,
} from "@/lib/purchasing/attachment-file";

export type UploadRentalReceiptResult = { ok: true } | { ok: false; error: string };

const RECEIPTS_BUCKET = "rental-settlement-receipts";

export async function uploadRentalReceiptFile(
  settlementId: string,
  file: File,
  purpose: RentalReceiptPurpose,
): Promise<UploadRentalReceiptResult> {
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
  const path = buildRentalReceiptPath(settlementId, attachmentId, ext);
  if (!path) return { ok: false, error: "แนบใบเสร็จไม่สำเร็จ กรุณาลองใหม่อีกครั้ง" };

  const supabase = createClient();
  const { error: uploadError } = await supabase.storage
    .from(RECEIPTS_BUCKET)
    .upload(path, blob, { upsert: false, contentType: attachmentExtToMime(ext) });
  if (uploadError && !classifyStorageUploadError(uploadError).alreadyExists) {
    return { ok: false, error: "ส่งใบเสร็จไม่สำเร็จ กรุณาลองใหม่อีกครั้ง" };
  }

  let result: Awaited<ReturnType<typeof addRentalSettlementReceipt>>;
  try {
    result = await addRentalSettlementReceipt({ settlementId, attachmentId, ext, purpose });
  } catch (err) {
    console.error("[upload-rental-receipt] action invocation failed", err);
    return { ok: false, error: "แนบใบเสร็จไม่สำเร็จ กรุณาลองใหม่อีกครั้ง" };
  }
  if (!result.ok) return { ok: false, error: result.error };
  return { ok: true };
}

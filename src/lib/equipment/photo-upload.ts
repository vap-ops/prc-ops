// Spec 370 D4/D7 — client-side condition-photo upload. Photos land in the
// private equipment-images bucket under usage/<batch>/<n>.<ext> BEFORE the RPC
// runs (the failure order: a failed RPC orphans storage objects, which is fine;
// the reverse would put photo rows on a span that never opened). The batch
// segment is a client-minted uuid because at ยืม time the log id does not exist
// yet (fact-check F4) — the TABLE carries the log link, the path only needs the
// policy's usage/<x>/<file> depth-2 shape.

import { createClient } from "@/lib/db/browser";
import { preparePhotoForUpload } from "@/lib/photos/downscale";
import { diagnoseStorageFailure } from "@/lib/photos/upload-queue";
import { trackFriction } from "@/lib/telemetry/friction";

export type UploadConditionPhotosResult =
  | { ok: true; paths: string[] }
  | { ok: false; error: string };

export async function uploadConditionPhotos(
  files: readonly File[],
): Promise<UploadConditionPhotosResult> {
  if (files.length === 0) return { ok: false, error: "ต้องถ่ายรูปอย่างน้อย 1 รูป" };

  const supabase = createClient();
  const batch = crypto.randomUUID();
  const paths: string[] = [];

  for (const [i, file] of files.entries()) {
    const prepared = await preparePhotoForUpload(file);
    if (!prepared) return { ok: false, error: "ไฟล์ไม่ใช่รูปภาพ" };
    const path = `usage/${batch}/${i + 1}.${prepared.ext}`;
    const { error } = await supabase.storage
      .from("equipment-images")
      .upload(path, prepared.blob, { contentType: prepared.blob.type });
    if (error) {
      // The second blind uploader (#823's lesson): a failure here was reported to
      // nobody, so a 403 on the equipment-images policy would hide behind this one
      // generic string exactly the way the catalog bug hid for two weeks. Same
      // PDPA-minimal payload as the photo pipeline — a coarse class plus a numeric
      // HTTP status when there was one, never a file name, path, or raw error.
      const diag = diagnoseStorageFailure(error);
      trackFriction("upload_fail", {
        kind: "equipment_condition_photo",
        stage: "storage",
        reason: diag.reason,
        ...(diag.status !== undefined ? { status: diag.status } : {}),
      });
      return { ok: false, error: "อัปโหลดรูปไม่สำเร็จ กรุณาลองใหม่" };
    }
    paths.push(path);
  }
  return { ok: true, paths };
}

"use client";

// Spec 175 U4 — per-item image control (shown on the edit sheet). Pick a photo →
// client downscale (reuse spec-34 preparePhotoForUpload) → upload to the private
// catalog-images bucket → record the path via setCatalogItemImage → refresh. The
// storage INSERT policy + the RPC carry the back-office gate. Replacing repoints
// the path; the old object is retained in the bucket (keep-originals).

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { ImageIcon } from "lucide-react";
import { createClient as createBrowserSupabase } from "@/lib/db/browser";
import { preparePhotoForUpload } from "@/lib/photos/downscale";
import { photoExtToMime } from "@/lib/photos/path";
import { diagnoseStorageFailure } from "@/lib/photos/upload-queue";
import { CATALOG_IMAGES_BUCKET } from "@/lib/storage/buckets";
import { INLINE_ERROR } from "@/lib/ui/classes";
import { trackFriction } from "@/lib/telemetry/friction";
import { setCatalogItemImage } from "@/app/catalog/actions";

export function CatalogImageControl({
  itemId,
  thumbnailUrl,
}: {
  itemId: string;
  thumbnailUrl?: string | null;
}) {
  const router = useRouter();
  const [busy, startBusy] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ""; // allow re-picking the same file
    if (!file) return;
    setError(null);
    startBusy(async () => {
      const prepared = await preparePhotoForUpload(file);
      if (!prepared) {
        setError("ไฟล์ต้องเป็นรูปภาพ");
        return;
      }
      const path = `${itemId}/${crypto.randomUUID()}.${prepared.ext}`;
      const supabase = createBrowserSupabase();
      const { error: upErr } = await supabase.storage
        .from(CATALOG_IMAGES_BUCKET)
        .upload(path, prepared.blob, {
          contentType: photoExtToMime(prepared.ext),
          upsert: false,
        });
      if (upErr) {
        // #823 was live for ~2 weeks because this control told nobody. Same signal
        // the photo pipeline emits (feedback 10a15ebe) and the same PDPA-minimal
        // payload: a coarse class + a numeric HTTP status when the failure was an
        // HTTP response — never the file name, the storage path, or the raw error.
        //
        // NOT deduped, deliberately, unlike the queue runner's per-item guard: that
        // one exists because its background loop re-reports the SAME stuck item every
        // few seconds. Here one event = one deliberate user attempt, so five retries
        // against a permanent refusal genuinely are five friction events, and the
        // friction map ranking them highly is the correct outcome.
        const diag = diagnoseStorageFailure(upErr);
        trackFriction("upload_fail", {
          kind: "catalog_image",
          stage: "storage",
          reason: diag.reason,
          ...(diag.status !== undefined ? { status: diag.status } : {}),
        });
        // A denial is permanent — "ลองใหม่" sends the user into a loop that cannot
        // succeed (2026-07-28: the catalog-images policy had never been widened to
        // procurement_manager, and this one generic string hid it). Reuse the
        // spec-354 storage diagnosis rather than re-rolling the status mapping.
        // "สิทธิ์ไม่พอ" is the house term for a permanent storage denial
        // (upload-queue-runner.tsx) — same condition, same words.
        setError(
          diag.reason === "authz"
            ? "อัปโหลดรูปไม่ได้ — สิทธิ์ไม่พอ"
            : "อัปโหลดรูปไม่สำเร็จ กรุณาลองใหม่",
        );
        return;
      }
      const result = await setCatalogItemImage({ id: itemId, path });
      if (!result.ok) {
        // The storage policy is only ONE of this control's two gates — the RPC is
        // the other, and a refusal there was equally invisible. #823 happened to be
        // a storage policy; the next one need not be. No `reason`: the action
        // returns a user-facing Thai string, and putting that in telemetry would
        // carry content this signal deliberately never carries.
        trackFriction("upload_fail", { kind: "catalog_image", stage: "insert" });
        setError(result.error);
        return;
      }
      router.refresh();
    });
  }

  function handleRemove() {
    setError(null);
    startBusy(async () => {
      const result = await setCatalogItemImage({ id: itemId, path: null });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      router.refresh();
    });
  }

  return (
    <div className="flex items-center gap-3">
      {thumbnailUrl ? (
        // eslint-disable-next-line @next/next/no-img-element -- signed URL, same as ZoomablePhoto
        <img
          src={thumbnailUrl}
          alt="รูปวัสดุ"
          className="border-edge rounded-control size-16 shrink-0 border object-cover"
        />
      ) : (
        <div className="bg-sunk text-ink-muted border-edge rounded-control flex size-16 shrink-0 items-center justify-center border">
          <ImageIcon aria-hidden className="size-6" />
        </div>
      )}
      <div className="flex flex-col items-start gap-1">
        <label className="border-edge-strong text-ink hover:bg-sunk focus-within:ring-action rounded-control inline-flex cursor-pointer items-center border px-3 py-2 text-sm font-medium focus-within:ring-2">
          {busy ? "กำลังอัปโหลด…" : thumbnailUrl ? "เปลี่ยนรูป" : "เพิ่มรูป"}
          <input
            type="file"
            accept="image/*"
            aria-label="เลือกรูปภาพ"
            onChange={handleFile}
            disabled={busy}
            className="sr-only"
          />
        </label>
        {thumbnailUrl && (
          <button
            type="button"
            onClick={handleRemove}
            disabled={busy}
            className="text-ink-secondary hover:text-ink text-meta font-medium"
          >
            ลบรูป
          </button>
        )}
        {error && (
          <span role="alert" className={INLINE_ERROR}>
            {error}
          </span>
        )}
      </div>
    </div>
  );
}

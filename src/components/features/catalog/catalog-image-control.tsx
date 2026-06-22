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
import { CATALOG_IMAGES_BUCKET } from "@/lib/storage/buckets";
import { INLINE_ERROR } from "@/lib/ui/classes";
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
        setError("อัปโหลดรูปไม่สำเร็จ กรุณาลองใหม่");
        return;
      }
      const result = await setCatalogItemImage({ id: itemId, path });
      if (!result.ok) {
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

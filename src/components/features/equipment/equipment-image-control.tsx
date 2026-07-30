"use client";

// Spec 367 §7 (U5) — per-item image control on the /equipment edit sheet. Pick a
// photo → client downscale (spec 34 preparePhotoForUpload) → upload to the private
// equipment-images bucket → record the path via setEquipmentItemImage → refresh.
// Replacing repoints the path; the old object stays in the bucket (keep-originals,
// ADR 0015's rule applied to curation assets too).
//
// Deliberately a near-twin of CatalogImageControl (spec 175 U4) — the spec names
// it as the thing to reuse, and the two surfaces should fail the same way. NOT
// extracted into a shared component: the storage gate, the bucket, the action and
// the telemetry kind all differ, so the shared part would be the JSX alone, and a
// single control taking four props to describe its own gates is harder to audit
// than two that each state theirs. Recorded so the duplication reads as a choice.
//
// 'use client': file picking, upload progress and the failure string are all
// client state, and the upload itself goes browser → Storage.

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { ImageIcon } from "lucide-react";
import { createClient as createBrowserSupabase } from "@/lib/db/browser";
import { preparePhotoForUpload } from "@/lib/photos/downscale";
import { photoExtToMime } from "@/lib/photos/path";
import { diagnoseStorageFailure } from "@/lib/photos/upload-queue";
import { EQUIPMENT_IMAGES_BUCKET } from "@/lib/storage/buckets";
import { INLINE_ERROR } from "@/lib/ui/classes";
import { trackFriction } from "@/lib/telemetry/friction";
import { setEquipmentItemImage } from "@/app/equipment/actions";

export function EquipmentImageControl({
  itemId,
  thumbnailUrl,
  onPathChange,
}: {
  itemId: string;
  thumbnailUrl?: string | null;
  // Spec 367 U5b — the ADD form has no row to update yet, so it mints the item id
  // client-side, lets the upload happen under it, and collects the path here to
  // pass to createEquipment. When provided, the DB write is the CALLER's job and
  // setEquipmentItemImage is NOT called: there is nothing to update, and calling
  // it would fail against a row that does not exist.
  onPathChange?: (path: string | null) => void;
}) {
  const router = useRouter();
  const [busy, startBusy] = useTransition();
  const [error, setError] = useState<string | null>(null);
  // Draft mode has no signed URL to show — the row does not exist, so the page
  // never minted one. Without a local preview the control would look completely
  // inert after a successful pick (label unchanged, no thumbnail, no ลบรูป), which
  // is the silent-success failure: indistinguishable from nothing happening.
  const [draftPreview, setDraftPreview] = useState<string | null>(null);
  const shownThumbnail = draftPreview ?? thumbnailUrl;

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
      // Folder depth 1 — `<itemId>/<uuid>.<ext>`. The live equipment-images INSERT
      // policy admits the back office ONLY at depth 1; its other arm is
      // `usage/<log>/…` (depth 2) for spec 370's condition photos. Nesting this
      // one level deeper would 403 every upload with no code error.
      const path = `${itemId}/${crypto.randomUUID()}.${prepared.ext}`;
      const supabase = createBrowserSupabase();
      const { error: upErr } = await supabase.storage
        .from(EQUIPMENT_IMAGES_BUCKET)
        .upload(path, prepared.blob, {
          contentType: photoExtToMime(prepared.ext),
          upsert: false,
        });
      if (upErr) {
        // Its own kind: #823 hid for ~2 weeks because a refused upload reported to
        // nobody, and sharing `catalog_image` here would hide WHICH surface is
        // failing. PDPA-minimal as everywhere else — a coarse class and a numeric
        // status, never the file name, the path, or the raw error text.
        const diag = diagnoseStorageFailure(upErr);
        trackFriction("upload_fail", {
          kind: "equipment_item_image",
          stage: "storage",
          reason: diag.reason,
          ...(diag.status !== undefined ? { status: diag.status } : {}),
        });
        // "ลองใหม่" against a denial is a loop that cannot be won. "สิทธิ์ไม่พอ" is
        // the house term for a permanent storage refusal.
        setError(
          diag.reason === "authz"
            ? "อัปโหลดรูปไม่ได้ — สิทธิ์ไม่พอ"
            : "อัปโหลดรูปไม่สำเร็จ กรุณาลองใหม่",
        );
        return;
      }
      // Draft mode (add form): the object is in the bucket, the row is not born
      // yet. Hand the path up and stop — the row is created WITH it.
      if (onPathChange) {
        setDraftPreview((prev) => {
          if (prev) URL.revokeObjectURL(prev);
          return URL.createObjectURL(prepared.blob);
        });
        onPathChange(path);
        return;
      }
      const result = await setEquipmentItemImage({ id: itemId, path });
      if (!result.ok) {
        // The storage policy is one gate; the action's role check + the column
        // grant are the other. No `reason` — the action returns a user-facing Thai
        // string and telemetry does not carry content.
        trackFriction("upload_fail", { kind: "equipment_item_image", stage: "insert" });
        setError(result.error);
        return;
      }
      router.refresh();
    });
  }

  function handleRemove() {
    setError(null);
    if (onPathChange) {
      setDraftPreview((prev) => {
        if (prev) URL.revokeObjectURL(prev);
        return null;
      });
      // Draft mode: nothing to un-write. The uploaded object is left behind, the
      // same trade the edit path makes when replacing an image (keep-originals);
      // nothing reads an object no row points at.
      onPathChange(null);
      return;
    }
    startBusy(async () => {
      const result = await setEquipmentItemImage({ id: itemId, path: null });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      router.refresh();
    });
  }

  return (
    <div className="mt-2 flex items-center gap-3">
      {shownThumbnail ? (
        // eslint-disable-next-line @next/next/no-img-element -- signed URL, same as ZoomablePhoto
        <img
          src={shownThumbnail}
          alt="รูปอุปกรณ์"
          className="border-edge rounded-control size-16 shrink-0 border object-cover"
        />
      ) : (
        <div className="bg-sunk text-ink-muted border-edge rounded-control flex size-16 shrink-0 items-center justify-center border">
          <ImageIcon aria-hidden className="size-6" />
        </div>
      )}
      <div className="flex flex-col items-start gap-1">
        <label className="border-edge-strong text-ink hover:bg-sunk focus-within:ring-action rounded-control inline-flex min-h-11 cursor-pointer items-center border px-3 py-2 text-sm font-medium focus-within:ring-2">
          {busy ? "กำลังอัปโหลด…" : shownThumbnail ? "เปลี่ยนรูป" : "เพิ่มรูป"}
          <input
            type="file"
            accept="image/*"
            aria-label="เลือกรูปภาพ"
            onChange={handleFile}
            disabled={busy}
            className="sr-only"
          />
        </label>
        {shownThumbnail && (
          <button
            type="button"
            onClick={handleRemove}
            disabled={busy}
            className="text-ink-secondary hover:text-ink text-meta min-h-11 font-medium"
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

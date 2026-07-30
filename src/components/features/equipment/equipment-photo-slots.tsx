"use client";

// Spec 382 U2 — the four slots, with their drawn guides, on the add and edit
// sheets. Replaces the single control from spec 367 U5/U5b.
//
// One component serves both sheets because the difference is only WHO writes the
// row, and that difference is one prop:
//   - edit sheet (row exists)  → each slot calls setEquipmentItemPhoto on change.
//   - add sheet (no row yet)   → `onDraftChange` collects kind→path and the row is
//     created WITH the photos, exactly as spec 367 U5b does for the single image.
// Everything else — the upload, the path shape, the guides, the failure copy — is
// identical, which is the point: the two sheets must not fail differently.
//
// A slot is never required. The operator ruled photos optional so a dead camera
// cannot stall the refill; completeness is reported by the row's `รูป n/4` chip,
// not enforced here.

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createClient as createBrowserSupabase } from "@/lib/db/browser";
import { preparePhotoForUpload } from "@/lib/photos/downscale";
import { photoExtToMime } from "@/lib/photos/path";
import { diagnoseStorageFailure } from "@/lib/photos/upload-queue";
import { EQUIPMENT_IMAGES_BUCKET } from "@/lib/storage/buckets";
import { INLINE_ERROR } from "@/lib/ui/classes";
import { trackFriction } from "@/lib/telemetry/friction";
import {
  EQUIPMENT_PHOTO_KINDS,
  EQUIPMENT_PHOTO_LABEL,
  EQUIPMENT_PHOTO_HINT,
  type EquipmentPhotoKind,
} from "@/lib/equipment/photo-kinds";
import { EquipmentPhotoGuide } from "@/components/features/equipment/equipment-photo-guide";
import { setEquipmentItemPhoto } from "@/app/equipment/photo-actions";

export function EquipmentPhotoSlots({
  itemId,
  thumbnails,
  onDraftChange,
}: {
  itemId: string;
  /** kind → signed URL, for slots already filled (edit sheet). */
  thumbnails?: Partial<Record<EquipmentPhotoKind, string>>;
  /** Present on the ADD sheet: collect paths instead of writing rows. */
  onDraftChange?: (kind: EquipmentPhotoKind, path: string | null) => void;
}) {
  return (
    <div className="mt-2 flex flex-col gap-3">
      {EQUIPMENT_PHOTO_KINDS.map((kind) => (
        <PhotoSlot
          key={kind}
          kind={kind}
          itemId={itemId}
          {...(thumbnails?.[kind] ? { thumbnailUrl: thumbnails[kind]! } : {})}
          {...(onDraftChange ? { onDraftChange } : {})}
        />
      ))}
    </div>
  );
}

function PhotoSlot({
  kind,
  itemId,
  thumbnailUrl,
  onDraftChange,
}: {
  kind: EquipmentPhotoKind;
  itemId: string;
  thumbnailUrl?: string;
  onDraftChange?: (kind: EquipmentPhotoKind, path: string | null) => void;
}) {
  const router = useRouter();
  const [busy, startBusy] = useTransition();
  const [error, setError] = useState<string | null>(null);
  // Draft mode has no signed URL — the row does not exist, so nothing minted one.
  // Without a local preview a successful pick looks identical to nothing
  // happening, which is the silent-success failure this app keeps re-learning.
  const [draftPreview, setDraftPreview] = useState<string | null>(null);
  const shown = draftPreview ?? thumbnailUrl ?? null;

  function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setError(null);
    startBusy(async () => {
      const prepared = await preparePhotoForUpload(file);
      if (!prepared) {
        setError("ไฟล์ต้องเป็นรูปภาพ");
        return;
      }
      // Depth 1 under the item's own id — the only arm of the equipment-images
      // policy that admits the back office (its other arm is spec 370's usage/).
      const path = `${itemId}/${crypto.randomUUID()}.${prepared.ext}`;
      const supabase = createBrowserSupabase();
      const { error: upErr } = await supabase.storage
        .from(EQUIPMENT_IMAGES_BUCKET)
        .upload(path, prepared.blob, {
          contentType: photoExtToMime(prepared.ext),
          upsert: false,
        });
      if (upErr) {
        const diag = diagnoseStorageFailure(upErr);
        // `kind` in the payload so a failing SLOT is identifiable — #823 hid for
        // two weeks because a refused upload reported to nobody at all.
        trackFriction("upload_fail", {
          kind: "equipment_item_image",
          slot: kind,
          stage: "storage",
          reason: diag.reason,
          ...(diag.status !== undefined ? { status: diag.status } : {}),
        });
        setError(
          diag.reason === "authz"
            ? "อัปโหลดรูปไม่ได้ — สิทธิ์ไม่พอ"
            : "อัปโหลดรูปไม่สำเร็จ กรุณาลองใหม่",
        );
        return;
      }

      if (onDraftChange) {
        setDraftPreview((prev) => {
          if (prev) URL.revokeObjectURL(prev);
          return URL.createObjectURL(prepared.blob);
        });
        onDraftChange(kind, path);
        return;
      }

      const result = await setEquipmentItemPhoto({ itemId, kind, path });
      if (!result.ok) {
        trackFriction("upload_fail", { kind: "equipment_item_image", slot: kind, stage: "insert" });
        setError(result.error);
        return;
      }
      router.refresh();
    });
  }

  function handleRemove() {
    setError(null);
    if (onDraftChange) {
      setDraftPreview((prev) => {
        if (prev) URL.revokeObjectURL(prev);
        return null;
      });
      onDraftChange(kind, null);
      return;
    }
    startBusy(async () => {
      const result = await setEquipmentItemPhoto({ itemId, kind, path: null });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      router.refresh();
    });
  }

  return (
    <div className="border-edge rounded-control flex items-start gap-3 border p-2">
      <div className="size-16 shrink-0">
        {shown ? (
          // eslint-disable-next-line @next/next/no-img-element -- signed URL / object URL
          <img
            src={shown}
            alt={EQUIPMENT_PHOTO_LABEL[kind]}
            className="border-edge rounded-control size-16 object-cover"
          />
        ) : (
          // The guide stands where the photo will go, so the example is exactly
          // where the eye already is.
          <div className="bg-sunk border-edge rounded-control size-16 border p-1">
            <EquipmentPhotoGuide kind={kind} />
          </div>
        )}
      </div>

      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <span className="text-ink text-body font-medium">{EQUIPMENT_PHOTO_LABEL[kind]}</span>
        <span className="text-ink-secondary text-meta">{EQUIPMENT_PHOTO_HINT[kind]}</span>
        <div className="flex flex-wrap items-center gap-3">
          <label className="border-edge-strong text-ink hover:bg-sunk focus-within:ring-action rounded-control inline-flex min-h-11 cursor-pointer items-center border px-3 py-2 text-sm font-medium focus-within:ring-2">
            {busy ? "กำลังอัปโหลด…" : shown ? "เปลี่ยนรูป" : "ถ่าย/เลือกรูป"}
            <input
              type="file"
              accept="image/*"
              aria-label={`เลือกรูป ${EQUIPMENT_PHOTO_LABEL[kind]}`}
              onChange={handleFile}
              disabled={busy}
              className="sr-only"
            />
          </label>
          {shown && (
            <button
              type="button"
              onClick={handleRemove}
              disabled={busy}
              className="text-ink-secondary hover:text-ink text-meta min-h-11 font-medium"
            >
              ลบรูป
            </button>
          )}
        </div>
        {error && (
          <span role="alert" className={INLINE_ERROR}>
            {error}
          </span>
        )}
      </div>
    </div>
  );
}

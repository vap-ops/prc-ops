"use client";

// Client-side per-phase upload + remove UI for the photo screen.
//
// File bytes go DIRECT from the browser to Supabase Storage under
// the user's session (the bucket INSERT policy admits sa/pm/super).
// Only metadata then flows to the addPhoto server action, which
// records the row + runs the conditional pending_approval transition.
//
// Per-photo lifecycle visible to the user:
//   uploading → inserting → done (refresh)
//   uploading → upload-error (retry re-uploads with the same uuid)
//   inserting → insert-error (retry calls addPhoto only; object is
//   already in Storage so no re-upload is needed)

import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";
import { createClient as createBrowserSupabase } from "@/lib/db/browser";
import { ConfirmDialog } from "@/components/features/confirm-dialog";
import { EmptyNotice } from "@/components/features/notices";
import { ZoomablePhoto } from "@/components/features/photo-lightbox";
import { mimeToPhotoExt, type PhotoExt, buildPhotoStoragePath } from "@/lib/photos/path";
import type { PhotoPhase } from "@/lib/photos/transitions";
import { addPhoto, removePhoto } from "./actions";

const PHOTOS_BUCKET = "photos";

interface ThumbnailPhoto {
  id: string;
  url: string | null;
}

type UploadStatus = "uploading" | "uploaded" | "inserting" | "upload-error" | "insert-error";

interface PendingUpload {
  id: string;
  fileName: string;
  previewUrl: string;
  status: UploadStatus;
  errorMessage: string | null;
  // Stored so retry can rebuild the upload OR replay just the insert.
  file: File;
  ext: PhotoExt;
  storagePath: string;
}

interface PhaseUploaderProps {
  projectId: string;
  workPackageId: string;
  phase: PhotoPhase;
  label: string;
  photos: ReadonlyArray<ThumbnailPhoto>;
}

export function PhaseUploader({
  projectId,
  workPackageId,
  phase,
  label,
  photos,
}: PhaseUploaderProps) {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [pending, setPending] = useState<ReadonlyArray<PendingUpload>>([]);
  const [topLevelError, setTopLevelError] = useState<string | null>(null);
  const [removingId, setRemovingId] = useState<string | null>(null);
  // Photo id awaiting removal confirmation in the themed dialog
  // (replaces window.confirm — spec 18).
  const [confirmRemoveId, setConfirmRemoveId] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  function updatePending(id: string, patch: Partial<PendingUpload>) {
    setPending((prev) => prev.map((p) => (p.id === id ? { ...p, ...patch } : p)));
  }

  function removePending(id: string) {
    setPending((prev) => {
      const target = prev.find((p) => p.id === id);
      if (target) URL.revokeObjectURL(target.previewUrl);
      return prev.filter((p) => p.id !== id);
    });
  }

  async function uploadOne(upload: PendingUpload) {
    const supabase = createBrowserSupabase();
    const { error: uploadError } = await supabase.storage
      .from(PHOTOS_BUCKET)
      .upload(upload.storagePath, upload.file, {
        contentType: upload.file.type,
        upsert: false,
      });
    if (uploadError) {
      // Fixed Thai on the tile; the raw SDK message (English) goes to
      // the console only (spec 15 item F).
      console.error("[phase-uploader] storage upload failed", uploadError.message);
      updatePending(upload.id, {
        status: "upload-error",
        errorMessage: "อัปโหลดไม่สำเร็จ กรุณาลองใหม่อีกครั้ง",
      });
      return;
    }
    updatePending(upload.id, { status: "uploaded" });
    await insertOne({ ...upload, status: "uploaded" });
  }

  async function insertOne(upload: PendingUpload) {
    updatePending(upload.id, { status: "inserting" });
    const result = await addPhoto({
      workPackageId,
      phase,
      photoId: upload.id,
      ext: upload.ext,
      capturedAtClient: new Date(upload.file.lastModified).toISOString(),
    });
    if (!result.ok) {
      updatePending(upload.id, {
        status: "insert-error",
        errorMessage: `อัปโหลดสำเร็จแต่บันทึกข้อมูลไม่สำเร็จ — ${result.error}`,
      });
      return;
    }
    // Drop the pending tile; the refreshed server data will surface
    // the real thumbnail.
    removePending(upload.id);
    startTransition(() => router.refresh());
  }

  async function handleFiles(files: FileList | null) {
    if (!files || files.length === 0) return;
    setTopLevelError(null);

    // Sequential uploads — easier to reason about per-photo status
    // than parallel; spec accepts either.
    for (const file of Array.from(files)) {
      const ext = mimeToPhotoExt(file.type);
      if (!ext) {
        setTopLevelError(
          `ไฟล์ "${file.name}" ไม่ใช่รูปภาพที่รองรับ — ใช้ JPEG, PNG, WebP หรือ HEIC`,
        );
        continue;
      }
      const id = crypto.randomUUID();
      const upload: PendingUpload = {
        id,
        fileName: file.name,
        previewUrl: URL.createObjectURL(file),
        status: "uploading",
        errorMessage: null,
        file,
        ext,
        storagePath: buildPhotoStoragePath(projectId, workPackageId, id, ext),
      };
      setPending((prev) => [...prev, upload]);
      await uploadOne(upload);
    }

    // Allow re-selecting the same file (e.g. after a Retry that fully
    // resolved, then the user wants to add it again).
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  async function retry(uploadId: string) {
    const upload = pending.find((p) => p.id === uploadId);
    if (!upload) return;
    if (upload.status === "upload-error") {
      updatePending(uploadId, { status: "uploading", errorMessage: null });
      await uploadOne(upload);
    } else if (upload.status === "insert-error") {
      // Object is already in Storage; just replay the insert.
      updatePending(uploadId, { status: "inserting", errorMessage: null });
      await insertOne(upload);
    }
  }

  async function handleRemoveConfirmed(photoId: string) {
    // Always close the dialog; then serialize removals — while one
    // removal's server action is in flight, confirming another is a
    // no-op (deliberate: one tombstone round-trip at a time).
    setConfirmRemoveId(null);
    if (removingId !== null) return;
    setRemovingId(photoId);
    const result = await removePhoto({ photoLogId: photoId });
    setRemovingId(null);
    if (!result.ok) {
      setTopLevelError(result.error);
      return;
    }
    startTransition(() => router.refresh());
  }

  const hasContent = photos.length > 0 || pending.length > 0;

  return (
    <section>
      <div className="mb-3 flex items-center justify-between gap-3">
        <h2 className="text-base font-semibold text-zinc-900">{label}</h2>
        <label className="inline-flex h-11 cursor-pointer items-center justify-center rounded-md border border-zinc-400 bg-white px-3 text-sm font-medium text-zinc-900 transition-colors focus-within:ring-2 focus-within:ring-blue-700 hover:bg-zinc-50">
          <span aria-hidden="true" className="mr-1.5">
            +
          </span>
          เพิ่มรูป
          <input
            ref={fileInputRef}
            type="file"
            accept="image/jpeg,image/png,image/webp,image/heic"
            multiple
            className="sr-only"
            onChange={(e) => void handleFiles(e.target.files)}
          />
        </label>
      </div>

      {topLevelError && (
        <div
          role="alert"
          className="mb-3 rounded-md border border-red-300 bg-red-50 px-3 py-2 text-xs text-red-900"
        >
          {topLevelError}
        </div>
      )}

      {!hasContent ? (
        <EmptyNotice className="text-zinc-600">ยังไม่มีรูปช่วง{label}</EmptyNotice>
      ) : (
        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {photos.map((p) => (
            <Thumbnail
              key={p.id}
              photo={p}
              isRemoving={removingId === p.id}
              onRemove={() => setConfirmRemoveId(p.id)}
            />
          ))}
          {pending.map((up) => (
            <PendingTile key={up.id} upload={up} onRetry={() => void retry(up.id)} />
          ))}
        </ul>
      )}

      <ConfirmDialog
        open={confirmRemoveId !== null}
        message={"ลบรูปนี้หรือไม่? การลบไม่สามารถย้อนกลับได้"}
        confirmLabel="ลบรูป"
        onConfirm={() => {
          if (confirmRemoveId) void handleRemoveConfirmed(confirmRemoveId);
        }}
        onCancel={() => setConfirmRemoveId(null)}
      />
    </section>
  );
}

interface ThumbnailProps {
  photo: ThumbnailPhoto;
  isRemoving: boolean;
  onRemove: () => void;
}

function Thumbnail({ photo, isRemoving, onRemove }: ThumbnailProps) {
  return (
    <li className="relative aspect-square overflow-hidden rounded-md border border-zinc-300 bg-zinc-100">
      {photo.url ? (
        <ZoomablePhoto src={photo.url} />
      ) : (
        <div className="flex h-full w-full items-center justify-center text-xs text-zinc-600">
          ไม่พร้อมแสดง
        </div>
      )}
      <button
        type="button"
        onClick={onRemove}
        disabled={isRemoving}
        aria-label="ลบรูป"
        className="absolute top-1.5 right-1.5 inline-flex h-7 w-7 items-center justify-center rounded-full border border-red-700 bg-red-600 font-semibold text-white transition-colors hover:bg-red-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-700 focus-visible:ring-offset-2 disabled:opacity-50"
      >
        {isRemoving ? (
          <Spinner />
        ) : (
          <span aria-hidden="true" className="text-base leading-none">
            ×
          </span>
        )}
      </button>
    </li>
  );
}

interface PendingTileProps {
  upload: PendingUpload;
  onRetry: () => void;
}

function PendingTile({ upload, onRetry }: PendingTileProps) {
  const isError = upload.status === "upload-error" || upload.status === "insert-error";
  const inProgress = upload.status === "uploading" || upload.status === "inserting";
  return (
    <li className="relative aspect-square overflow-hidden rounded-md border border-zinc-300 bg-zinc-100">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={upload.previewUrl} alt="" className="h-full w-full object-cover opacity-50" />
      <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 px-2 text-center">
        {inProgress && (
          <>
            <Spinner />
            {/* White plate keeps the label readable over DARK photos —
                the ink sits on the plate, not the dimmed image. */}
            <span className="rounded bg-white/85 px-1.5 py-0.5 text-[11px] font-medium text-zinc-900">
              {upload.status === "uploading" ? "กำลังอัปโหลด…" : "กำลังบันทึก…"}
            </span>
          </>
        )}
        {isError && (
          <>
            <span className="rounded bg-white/85 px-1.5 py-0.5 text-[11px] font-medium text-red-900">
              {upload.errorMessage ?? "ล้มเหลว"}
            </span>
            <button
              type="button"
              onClick={onRetry}
              className="rounded border border-zinc-400 bg-white px-2 py-0.5 text-[11px] font-medium text-zinc-900 hover:bg-zinc-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-700"
            >
              ลองใหม่
            </button>
          </>
        )}
      </div>
    </li>
  );
}

function Spinner() {
  return (
    <span
      aria-hidden="true"
      className="inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-zinc-400 border-t-zinc-900"
    />
  );
}

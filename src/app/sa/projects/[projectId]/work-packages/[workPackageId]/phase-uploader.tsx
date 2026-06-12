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
//
// Spec 35: every selected photo ALSO persists to the offline queue at
// selection — error states are no longer terminal; the global
// UploadQueueRunner retries leftovers (idempotently) independent of
// this UI, including after a crash, offline failure, or navigation.

import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";
import { Camera, Check } from "lucide-react";
import { createClient as createBrowserSupabase } from "@/lib/db/browser";
import { ConfirmDialog } from "@/components/features/confirm-dialog";
import { ZoomablePhoto } from "@/components/features/photo-lightbox";
import { PhotoStrip, PHOTO_STRIP_TILE } from "@/components/features/photo-strip";
import { photoExtToMime, type PhotoExt, buildPhotoStoragePath } from "@/lib/photos/path";
import { preparePhotoForUpload } from "@/lib/photos/downscale";
import {
  classifyStorageUploadError,
  queueNowMs,
  type QueuedUpload,
} from "@/lib/photos/upload-queue";
import { notifyQueueChanged, safeQueuePut, safeQueueRemove } from "@/lib/photos/upload-queue-idb";
import type { PhotoPhase } from "@/lib/photos/transitions";
import { addPhoto, removePhoto } from "./actions";

const PHOTOS_BUCKET = "photos";

interface ThumbnailPhoto {
  id: string;
  url: string | null;
  /** HH:MM capture-time overlay (spec 54) — null hides the overlay. */
  timeLabel: string | null;
}

type UploadStatus = "uploading" | "uploaded" | "inserting" | "upload-error" | "insert-error";

interface PendingUpload {
  id: string;
  fileName: string;
  previewUrl: string;
  status: UploadStatus;
  errorMessage: string | null;
  // Stored so retry can rebuild the upload OR replay just the insert.
  // `blob` is the PREPARED bytes (spec 34 downscale) — retries must not
  // re-decode; no raw File survives in state (spec 34 checklist), only
  // the lastModified scalar for capturedAtClient.
  blob: Blob;
  lastModifiedMs: number;
  /** Queue ordering timestamp, captured once at selection (spec 35). */
  enqueuedAtMs: number;
  ext: PhotoExt;
  storagePath: string;
}

interface PhaseUploaderProps {
  projectId: string;
  workPackageId: string;
  /** Session user — stamped on queue items (ADR 0039 attribution guard). */
  userId: string;
  phase: PhotoPhase;
  label: string;
  photos: ReadonlyArray<ThumbnailPhoto>;
  /** Latest upload time, HH:MM (spec 54 timeline sub-line); null = none. */
  lastUpdatedLabel: string | null;
}

export function PhaseUploader({
  projectId,
  workPackageId,
  userId,
  phase,
  label,
  photos,
  lastUpdatedLabel,
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

  // Spec 35 / ADR 0039: the live pipeline is bracketed by the offline
  // queue — put at selection, step-advance after bytes land, remove
  // after the metadata row lands. A crash/offline/navigation at any
  // point leaves a queue item the global runner resumes (idempotently).
  function toQueueItem(upload: PendingUpload): QueuedUpload {
    return {
      kind: "phase_photo",
      id: upload.id,
      userId,
      workPackageId,
      phase,
      ext: upload.ext,
      blob: upload.blob,
      lastModifiedMs: upload.lastModifiedMs,
      fileName: upload.fileName,
      storagePath: upload.storagePath,
      step: "upload",
      attempts: 0,
      lastError: null,
      enqueuedAtMs: upload.enqueuedAtMs,
    };
  }

  async function uploadOne(upload: PendingUpload) {
    const supabase = createBrowserSupabase();
    const { error: uploadError } = await supabase.storage
      .from(PHOTOS_BUCKET)
      .upload(upload.storagePath, upload.blob, {
        contentType: photoExtToMime(upload.ext),
        upsert: false,
      });
    if (uploadError && !classifyStorageUploadError(uploadError).alreadyExists) {
      // Fixed Thai on the tile; the raw SDK message (English) goes to
      // the console only (spec 15 item F). The queue item stays —
      // the runner will retry it even if the user leaves this page.
      console.error("[phase-uploader] storage upload failed", uploadError.message);
      notifyQueueChanged();
      updatePending(upload.id, {
        status: "upload-error",
        errorMessage: "อัปโหลดไม่สำเร็จ กรุณาลองใหม่อีกครั้ง",
      });
      return;
    }
    // Bytes landed (now, or earlier by the runner — a 409 duplicate is
    // OUR object under this uuid path, ADR 0039 idempotency). Persist
    // the step advance so a recovery pass never re-uploads.
    await safeQueuePut({ ...toQueueItem(upload), step: "insert" });
    updatePending(upload.id, { status: "uploaded" });
    await insertOne({ ...upload, status: "uploaded" });
  }

  async function insertOne(upload: PendingUpload) {
    updatePending(upload.id, { status: "inserting" });
    let result: Awaited<ReturnType<typeof addPhoto>>;
    try {
      result = await addPhoto({
        workPackageId,
        phase,
        photoId: upload.id,
        ext: upload.ext,
        capturedAtClient: new Date(upload.lastModifiedMs).toISOString(),
      });
    } catch (err) {
      // The action INVOCATION failed (connectivity dropped between the
      // bytes landing and this POST — the flaky-signal target case).
      // The queue item (step=insert) survives for the runner.
      console.error("[phase-uploader] addPhoto invocation failed", err);
      result = { ok: false, error: "บันทึกข้อมูลไม่สำเร็จ กรุณาลองใหม่อีกครั้ง" };
    }
    if (!result.ok) {
      // Queue item stays (step=insert) — the runner replays the action.
      notifyQueueChanged();
      updatePending(upload.id, {
        status: "insert-error",
        errorMessage: `อัปโหลดสำเร็จแต่บันทึกข้อมูลไม่สำเร็จ — ${result.error}`,
      });
      return;
    }
    // Fully landed — release the queue item (and let the runner's
    // banner refresh), drop the pending tile; the refreshed server
    // data will surface the real thumbnail.
    await safeQueueRemove(upload.id);
    notifyQueueChanged();
    removePending(upload.id);
    startTransition(() => router.refresh());
  }

  async function handleFiles(files: FileList | null) {
    if (!files || files.length === 0) return;
    setTopLevelError(null);

    // Sequential uploads — easier to reason about per-photo status
    // than parallel; spec accepts either.
    for (const file of Array.from(files)) {
      // Spec 34 / ADR 0036: downscale before upload — the prepared blob
      // IS the original we store. Failure paths inside return the file
      // unchanged; null = non-photo MIME (the existing rejection).
      const prepared = await preparePhotoForUpload(file);
      if (!prepared) {
        setTopLevelError(
          `ไฟล์ "${file.name}" ไม่ใช่รูปภาพที่รองรับ — ใช้ JPEG, PNG, WebP หรือ HEIC`,
        );
        continue;
      }
      const id = crypto.randomUUID();
      const upload: PendingUpload = {
        id,
        fileName: file.name,
        previewUrl: URL.createObjectURL(prepared.blob),
        status: "uploading",
        errorMessage: null,
        blob: prepared.blob,
        lastModifiedMs: file.lastModified,
        enqueuedAtMs: queueNowMs(),
        ext: prepared.ext,
        storagePath: buildPhotoStoragePath(projectId, workPackageId, id, prepared.ext),
      };
      setPending((prev) => [...prev, upload]);
      try {
        // Persist BEFORE attempting — from here the photo survives a
        // crash, an offline failure, or leaving the page (spec 35).
        await safeQueuePut(toQueueItem(upload));
        await uploadOne(upload);
      } catch (err) {
        // One photo's unexpected failure must never abort the loop —
        // the remaining selected files still get queued and uploaded.
        console.error("[phase-uploader] unexpected per-file failure", err);
        updatePending(upload.id, {
          status: "upload-error",
          errorMessage: "อัปโหลดไม่สำเร็จ กรุณาลองใหม่อีกครั้ง",
        });
        notifyQueueChanged();
      }
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

  const hasPhotos = photos.length > 0;

  // Spec 50: the loaded photos of THIS phase form one lightbox group —
  // swipe stays inside the strip the user tapped. Missing-URL and
  // pending tiles are not members. Spec 51: ids ride along, aligned
  // with the urls, so the lightbox can attach markup to the photo
  // actually shown after navigation.
  const loadedUrls = photos.flatMap((p) => (p.url !== null ? [p.url] : []));
  const loadedPhotoIds = photos.flatMap((p) => (p.url !== null ? [p.id] : []));
  const loadedIndexById = new Map<string, number>();
  {
    let i = 0;
    for (const p of photos) if (p.url !== null) loadedIndexById.set(p.id, i++);
  }

  return (
    /* Spec 54 timeline row: status disc + label/count header, then the
       rail-indented body (sub-line + strip). The upload machinery below
       is byte-equivalent to the pre-54 version — only the trigger moved
       into the strip's first tile. */
    <section>
      <div className="mb-1.5 flex items-center gap-3">
        {hasPhotos ? (
          <span className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-green-600 text-white">
            <Check aria-hidden className="h-4 w-4" strokeWidth={3} />
          </span>
        ) : (
          <span
            aria-hidden
            className="h-7 w-7 shrink-0 rounded-full border-2 border-zinc-300 bg-white"
          />
        )}
        <h2 className="text-base font-bold text-zinc-900">
          {label}
          {hasPhotos ? (
            /* Spec 49: the strip hides its tail — announce the total. */
            <span className="ml-1.5 text-sm font-normal text-zinc-600">{photos.length} รูป</span>
          ) : null}
        </h2>
      </div>

      <div
        className={`ml-[13px] flex flex-col gap-2 border-l-2 pb-1 pl-5 ${
          hasPhotos ? "border-green-600" : "border-zinc-200"
        }`}
      >
        <p className="text-sm text-zinc-600">
          {lastUpdatedLabel ? `อัปเดตล่าสุด ${lastUpdatedLabel}` : "ยังไม่มีรูป"}
        </p>

        {topLevelError && (
          <div
            role="alert"
            className="rounded-md border border-red-300 bg-red-50 px-3 py-2 text-xs text-red-900"
          >
            {topLevelError}
          </div>
        )}

        {/* Spec 49 filmstrip; spec 54 puts the add-photo tile FIRST so
            the strip is never empty and the affordance reads as "next
            photo goes here" (mockup ถ่ายเพิ่ม tile). */}
        <PhotoStrip>
          <li className="relative h-28 w-28 shrink-0 snap-start rounded-lg border-2 border-dashed border-zinc-300 bg-white">
            <label className="flex h-full w-full cursor-pointer flex-col items-center justify-center gap-1.5 rounded-lg transition-colors focus-within:ring-2 focus-within:ring-blue-700 hover:bg-zinc-50">
              <Camera aria-hidden className="h-6 w-6 text-zinc-500" />
              <span className="text-sm font-medium text-blue-700">ถ่ายเพิ่ม</span>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/jpeg,image/png,image/webp,image/heic"
                multiple
                className="sr-only"
                onChange={(e) => void handleFiles(e.target.files)}
              />
            </label>
          </li>
          {photos.map((p) => (
            <Thumbnail
              key={p.id}
              photo={p}
              group={loadedUrls}
              groupPhotoIds={loadedPhotoIds}
              groupIndex={loadedIndexById.get(p.id) ?? 0}
              isRemoving={removingId === p.id}
              onRemove={() => setConfirmRemoveId(p.id)}
            />
          ))}
          {pending.map((up) => (
            <PendingTile key={up.id} upload={up} onRetry={() => void retry(up.id)} />
          ))}
        </PhotoStrip>
      </div>

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
  group: ReadonlyArray<string>;
  groupPhotoIds: ReadonlyArray<string>;
  groupIndex: number;
  isRemoving: boolean;
  onRemove: () => void;
}

function Thumbnail({
  photo,
  group,
  groupPhotoIds,
  groupIndex,
  isRemoving,
  onRemove,
}: ThumbnailProps) {
  return (
    <li className={PHOTO_STRIP_TILE}>
      {photo.url ? (
        <ZoomablePhoto
          src={photo.url}
          group={group}
          groupPhotoIds={groupPhotoIds}
          groupIndex={groupIndex}
          photoId={photo.id}
        />
      ) : (
        <div className="flex h-full w-full items-center justify-center text-xs text-zinc-600">
          ไม่พร้อมแสดง
        </div>
      )}
      {/* Spec 54: capture-time overlay (mockup 09:12 tiles).
          pointer-events-none — taps fall through to the lightbox. */}
      {photo.timeLabel ? (
        <span className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/60 to-transparent px-1.5 pt-4 pb-1 text-[11px] font-medium text-white">
          {photo.timeLabel}
        </span>
      ) : null}
      {/* Spec 36 tap-target pass: the BUTTON is a 44px transparent
          square (real hit area, inside the tile so the li's
          overflow-hidden cannot clip it); the red disc stays 28px
          visually. Spinner gets the white variant — the default dark
          track was ~1.8:1 on this red fill. */}
      <button
        type="button"
        onClick={onRemove}
        disabled={isRemoving}
        aria-label="ลบรูป"
        className="group absolute top-0 right-0 inline-flex h-11 w-11 items-center justify-center rounded-full focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-700 disabled:opacity-50"
      >
        <span className="inline-flex h-7 w-7 items-center justify-center rounded-full border border-red-700 bg-red-600 font-semibold text-white transition-colors group-hover:bg-red-700">
          {isRemoving ? (
            <Spinner className="border-white/40 border-t-white" />
          ) : (
            <span aria-hidden="true" className="text-base leading-none">
              ×
            </span>
          )}
        </span>
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
    <li className={PHOTO_STRIP_TILE}>
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
            {/* Spec 36 tap-target pass: 44px min height for gloved hands. */}
            <button
              type="button"
              onClick={onRetry}
              className="inline-flex min-h-11 items-center rounded border border-zinc-400 bg-white px-3 text-xs font-medium text-zinc-900 hover:bg-zinc-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-700"
            >
              ลองใหม่
            </button>
          </>
        )}
      </div>
    </li>
  );
}

// Spec 36: track colors are overridable — the default dark track was
// ~1.8:1 against the red remove button; that call site passes a white
// variant.
function Spinner({ className }: { className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={`inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 ${
        className ?? "border-zinc-400 border-t-zinc-900"
      }`}
    />
  );
}

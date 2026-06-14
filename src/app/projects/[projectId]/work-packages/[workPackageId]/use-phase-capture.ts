"use client";

// usePhaseCapture — the photo-capture ENGINE, extracted verbatim from the
// pre-redesign PhaseUploader so the Field-First shutter UI can reuse it
// without touching the load-bearing pipeline. BEHAVIOR IS UNCHANGED:
//
//   • Spec 34 / ADR 0036 downscale before upload (the prepared blob IS
//     the stored original).
//   • Spec 35 / ADR 0039 offline queue brackets the live pipeline — put
//     at selection, step-advance after bytes land, remove after the
//     metadata row lands; a crash/offline/navigation leaves a queue item
//     the global UploadQueueRunner resumes idempotently.
//   • Per-photo lifecycle: uploading → inserting → done (refresh);
//     upload-error retry re-uploads (same uuid); insert-error retry
//     replays only the insert (object already in Storage).
//   • Shared-device guard: queue items carry userId.
//   • Removal: themed ConfirmDialog (no window.confirm), serialized
//     (one tombstone round-trip at a time).
//
// The only change is packaging: state + handlers come back from a hook
// instead of living in one component, so both the detail-page strip and
// the shutter sheet drive the same engine.

import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";
import { createClient as createBrowserSupabase } from "@/lib/db/browser";
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

export type UploadStatus = "uploading" | "uploaded" | "inserting" | "upload-error" | "insert-error";

export interface PendingUpload {
  id: string;
  fileName: string;
  previewUrl: string;
  status: UploadStatus;
  errorMessage: string | null;
  blob: Blob;
  lastModifiedMs: number;
  enqueuedAtMs: number;
  ext: PhotoExt;
  storagePath: string;
}

interface UsePhaseCaptureArgs {
  projectId: string;
  workPackageId: string;
  userId: string;
  phase: PhotoPhase;
}

export function usePhaseCapture({ projectId, workPackageId, userId, phase }: UsePhaseCaptureArgs) {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [pending, setPending] = useState<ReadonlyArray<PendingUpload>>([]);
  const [topLevelError, setTopLevelError] = useState<string | null>(null);
  const [removingId, setRemovingId] = useState<string | null>(null);
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
      console.error("[phase-capture] storage upload failed", uploadError.message);
      notifyQueueChanged();
      updatePending(upload.id, {
        status: "upload-error",
        errorMessage: "อัปโหลดไม่สำเร็จ กรุณาลองใหม่อีกครั้ง",
      });
      return;
    }
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
      console.error("[phase-capture] addPhoto invocation failed", err);
      result = { ok: false, error: "บันทึกข้อมูลไม่สำเร็จ กรุณาลองใหม่อีกครั้ง" };
    }
    if (!result.ok) {
      notifyQueueChanged();
      updatePending(upload.id, {
        status: "insert-error",
        errorMessage: `อัปโหลดสำเร็จแต่บันทึกข้อมูลไม่สำเร็จ — ${result.error}`,
      });
      return;
    }
    await safeQueueRemove(upload.id);
    notifyQueueChanged();
    removePending(upload.id);
    startTransition(() => router.refresh());
  }

  async function handleFiles(files: FileList | null) {
    if (!files || files.length === 0) return;
    setTopLevelError(null);
    for (const file of Array.from(files)) {
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
        await safeQueuePut(toQueueItem(upload));
        await uploadOne(upload);
      } catch (err) {
        console.error("[phase-capture] unexpected per-file failure", err);
        updatePending(upload.id, {
          status: "upload-error",
          errorMessage: "อัปโหลดไม่สำเร็จ กรุณาลองใหม่อีกครั้ง",
        });
        notifyQueueChanged();
      }
    }
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  async function retry(uploadId: string) {
    const upload = pending.find((p) => p.id === uploadId);
    if (!upload) return;
    if (upload.status === "upload-error") {
      updatePending(uploadId, { status: "uploading", errorMessage: null });
      await uploadOne(upload);
    } else if (upload.status === "insert-error") {
      updatePending(uploadId, { status: "inserting", errorMessage: null });
      await insertOne(upload);
    }
  }

  async function handleRemoveConfirmed(photoId: string) {
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

  return {
    pending,
    topLevelError,
    removingId,
    confirmRemoveId,
    fileInputRef,
    handleFiles,
    retry,
    requestRemove: (id: string) => setConfirmRemoveId(id),
    cancelRemove: () => setConfirmRemoveId(null),
    handleRemoveConfirmed,
  };
}

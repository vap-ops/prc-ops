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
import { captureMethodMetadata, type CaptureMethod } from "@/lib/photos/capture-method";
import { photoExtToMime, type PhotoExt, buildPhotoStoragePath } from "@/lib/photos/path";
import { preparePhotoForUpload } from "@/lib/photos/downscale";
import {
  classifyStorageUploadError,
  diagnoseStorageFailure,
  isPairingRejected,
  queueNowMs,
  type QueuedUpload,
} from "@/lib/photos/upload-queue";
import { notifyQueueChanged, safeQueuePut, safeQueueRemove } from "@/lib/photos/upload-queue-idb";
import { trackFriction } from "@/lib/telemetry/friction";
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
  /** Spec 354 — which input affordance produced this shot (camera shutter vs
   *  the spec-96 library button). Rides the queue item and is stamped into
   *  storage.objects.user_metadata on upload. */
  captureMethod: CaptureMethod;
  /** Feedback 10a15ebe: true when the failure will NOT succeed on plain retry
   *  (authz/size/pairing) — so the sheet does not falsely promise "will auto-send"
   *  for a terminal failure, mirroring the queue runner's honest-copy split. */
  terminal?: boolean;
}

interface UsePhaseCaptureArgs {
  projectId: string;
  workPackageId: string;
  userId: string;
  phase: PhotoPhase;
  /** Spec 248 U3 — when capturing a paired after_fix answer, the defect photo
   *  it answers. Rides the queue item + the addPhoto call. */
  answersPhotoId?: string | null;
}

export function usePhaseCapture({
  projectId,
  workPackageId,
  userId,
  phase,
  answersPhotoId = null,
}: UsePhaseCaptureArgs) {
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
      answersPhotoId,
      ext: upload.ext,
      blob: upload.blob,
      lastModifiedMs: upload.lastModifiedMs,
      fileName: upload.fileName,
      storagePath: upload.storagePath,
      step: "upload",
      attempts: 0,
      lastError: null,
      enqueuedAtMs: upload.enqueuedAtMs,
      captureMethod: upload.captureMethod,
    };
  }

  async function uploadOne(upload: PendingUpload) {
    const supabase = createBrowserSupabase();
    const { error: uploadError } = await supabase.storage
      .from(PHOTOS_BUCKET)
      .upload(upload.storagePath, upload.blob, {
        contentType: photoExtToMime(upload.ext),
        upsert: false,
        // Spec 354 — stamp the capture affordance into
        // storage.objects.user_metadata on the live (page-open) upload.
        metadata: captureMethodMetadata(upload.captureMethod),
      });
    if (uploadError && !classifyStorageUploadError(uploadError).alreadyExists) {
      console.error("[phase-capture] storage upload failed", uploadError.message);
      // Feedback 10a15ebe: a real field failure recorded only {kind, stage}, so a
      // TRANSIENT storage blip (which the offline queue recovered from ~19 min later)
      // could not be told apart from a 403 or a 413. Emit the coarse, PDPA-safe
      // diagnosis — reason class + numeric HTTP status when present — never the file
      // name/path/raw error text.
      const diag = diagnoseStorageFailure(uploadError);
      trackFriction("upload_fail", {
        kind: "phase_photo",
        stage: "storage",
        reason: diag.reason,
        ...(diag.status !== undefined ? { status: diag.status } : {}),
      });
      notifyQueueChanged();
      updatePending(upload.id, {
        status: "upload-error",
        errorMessage: "อัปโหลดไม่สำเร็จ กรุณาลองใหม่อีกครั้ง",
        // authz (403) and size (413) will fail identically on retry — do not let
        // the sheet promise "will auto-send" for them (feedback 10a15ebe).
        terminal: diag.reason === "authz" || diag.reason === "size",
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
    let invocationThrew = false;
    try {
      result = await addPhoto({
        workPackageId,
        phase,
        photoId: upload.id,
        ext: upload.ext,
        capturedAtClient: new Date(upload.lastModifiedMs).toISOString(),
        answersPhotoId,
      });
    } catch (err) {
      console.error("[phase-capture] addPhoto invocation failed", err);
      invocationThrew = true;
      result = { ok: false, error: "บันทึกข้อมูลไม่สำเร็จ กรุณาลองใหม่อีกครั้ง" };
    }
    if (!result.ok) {
      // Feedback 10a15ebe: carry a coarse reason — a thrown invocation is a network
      // failure to the server action, a pairing rejection is terminal, anything else
      // is a server-side rejection. PDPA-min: reason class only, never the message.
      const reason = invocationThrew
        ? "network"
        : isPairingRejected(result.error)
          ? "pairing"
          : "insert_rejected";
      trackFriction("upload_fail", { kind: "phase_photo", stage: "insert", reason });
      notifyQueueChanged();
      updatePending(upload.id, {
        status: "insert-error",
        errorMessage: `อัปโหลดสำเร็จแต่บันทึกข้อมูลไม่สำเร็จ — ${result.error}`,
        // A pairing rejection is terminal (the U1 guard blocks every replay); a
        // network/server rejection can still land on retry (feedback 10a15ebe).
        terminal: reason === "pairing",
      });
      return;
    }
    await safeQueueRemove(upload.id);
    notifyQueueChanged();
    removePending(upload.id);
    startTransition(() => router.refresh());
  }

  async function handleFiles(files: FileList | null, captureMethod: CaptureMethod) {
    if (!files || files.length === 0) return;
    setTopLevelError(null);
    for (const file of Array.from(files)) {
      const prepared = await preparePhotoForUpload(file);
      if (!prepared) {
        setTopLevelError(
          `ไฟล์ "${file.name}" ไม่ใช่รูปภาพที่รองรับ — ใช้ JPEG, PNG, WebP หรือ HEIC`,
        );
        // Spec 244 U2b-2: an unsupported-file rejection is a validation_error the
        // user hits on this screen — a friction signal. PDPA-min: a stable reason
        // code only, NEVER the file name/content. Best-effort (no-ops if capture is
        // inactive); the tracker stamps the route.
        trackFriction("validation_error", { reason: "unsupported_file_type" });
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
        captureMethod,
      };
      setPending((prev) => [...prev, upload]);
      try {
        await safeQueuePut(toQueueItem(upload));
        await uploadOne(upload);
      } catch (err) {
        console.error("[phase-capture] unexpected per-file failure", err);
        // Feedback 10a15ebe: an unexpected throw (e.g. IDB put) also stranded the
        // user on "ลองใหม่" with no signal — track it too, with a coarse reason.
        trackFriction("upload_fail", {
          kind: "phase_photo",
          stage: "unexpected",
          reason: "exception",
        });
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

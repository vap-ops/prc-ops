"use client";

// Spec 248 U2 — the defect-photo engine for the รายงานข้อบกพร่อง form.
//
// Deliberately NOT usePhaseCapture: defect filing is ONLINE-ONLY (design
// review blocker — the offline queue's replay races the reopen RPC's round
// bump and could stamp a CLOSED round's evidence), so there is no IDB queue
// here. The flow brackets the RPC instead:
//
//   select   → downscale → browser-direct Storage upload → hold as "ready"
//   (submit) → reopen_work_package_for_defect bumps the round
//   attachAll → addPhoto(phase 'defect') per ready photo — the row lands on
//               the freshly-bumped round (photoReworkRoundFor stamps it)
//
// A failed byte upload retries in place; a failed metadata insert (defect
// already filed!) becomes "insert-error" — the form keeps the sheet open and
// the retry replays ONLY the insert. Pre-submit removal just drops the local
// entry; the uploaded Storage object is orphan-accepted (ADR 0015 stance).

import { useEffect, useRef, useState } from "react";
import { createClient as createBrowserSupabase } from "@/lib/db/browser";
import { photoExtToMime, type PhotoExt, buildPhotoStoragePath } from "@/lib/photos/path";
import { preparePhotoForUpload } from "@/lib/photos/downscale";
import { classifyStorageUploadError } from "@/lib/photos/upload-queue";
import { addPhoto } from "./actions";

const PHOTOS_BUCKET = "photos";

export type DefectPhotoStatus = "uploading" | "ready" | "upload-error" | "insert-error" | "saved";

export interface DefectPendingPhoto {
  id: string;
  fileName: string;
  previewUrl: string;
  status: DefectPhotoStatus;
  errorMessage: string | null;
  blob: Blob;
  lastModifiedMs: number;
  ext: PhotoExt;
  storagePath: string;
}

export function useDefectPhotos({
  projectId,
  workPackageId,
}: {
  projectId: string;
  workPackageId: string;
}) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [photos, setPhotos] = useState<ReadonlyArray<DefectPendingPhoto>>([]);
  // Files being downscaled are not yet in `photos` — this counter keeps
  // anyInFlight true across that window so a submit can't slip through
  // before the photo materializes (review finding).
  const [processingCount, setProcessingCount] = useState(0);

  // Blob preview URLs live until the sheet unmounts.
  const photosRef = useRef<ReadonlyArray<DefectPendingPhoto>>([]);
  useEffect(() => {
    photosRef.current = photos;
  }, [photos]);
  useEffect(
    () => () => {
      for (const p of photosRef.current) URL.revokeObjectURL(p.previewUrl);
    },
    [],
  );

  function patch(id: string, p: Partial<DefectPendingPhoto>) {
    setPhotos((prev) => prev.map((x) => (x.id === id ? { ...x, ...p } : x)));
  }

  async function uploadOne(photo: DefectPendingPhoto) {
    const supabase = createBrowserSupabase();
    const { error } = await supabase.storage
      .from(PHOTOS_BUCKET)
      .upload(photo.storagePath, photo.blob, {
        contentType: photoExtToMime(photo.ext),
        upsert: false,
      });
    // already-exists = the bytes landed on a lost-response attempt; the path
    // is uuid-keyed so the object is provably ours (same rule as every other
    // uploader — classifyStorageUploadError).
    if (error && !classifyStorageUploadError(error).alreadyExists) {
      patch(photo.id, {
        status: "upload-error",
        errorMessage: "อัปโหลดไม่สำเร็จ กรุณาลองใหม่อีกครั้ง",
      });
      return;
    }
    patch(photo.id, { status: "ready", errorMessage: null });
  }

  async function insertOne(photo: DefectPendingPhoto): Promise<boolean> {
    const result = await addPhoto({
      workPackageId,
      phase: "defect",
      photoId: photo.id,
      ext: photo.ext,
      capturedAtClient: new Date(photo.lastModifiedMs).toISOString(),
    }).catch(() => ({ ok: false as const, error: "บันทึกข้อมูลไม่สำเร็จ" }));
    if (!result.ok) {
      patch(photo.id, {
        status: "insert-error",
        errorMessage: "แนบรูปไม่สำเร็จ — แตะเพื่อลองใหม่",
      });
      return false;
    }
    patch(photo.id, { status: "saved", errorMessage: null });
    return true;
  }

  async function handleFiles(files: FileList | null) {
    if (!files || files.length === 0) return;
    // Synchronous, before the first await — the submit gate sees the work.
    setProcessingCount((c) => c + 1);
    try {
      for (const file of Array.from(files)) {
        const prepared = await preparePhotoForUpload(file);
        if (!prepared) continue;
        const id = crypto.randomUUID();
        const photo: DefectPendingPhoto = {
          id,
          fileName: file.name,
          previewUrl: URL.createObjectURL(prepared.blob),
          status: "uploading",
          errorMessage: null,
          blob: prepared.blob,
          lastModifiedMs: file.lastModified,
          ext: prepared.ext,
          storagePath: buildPhotoStoragePath(projectId, workPackageId, id, prepared.ext),
        };
        setPhotos((prev) => [...prev, photo]);
        await uploadOne(photo);
      }
    } finally {
      setProcessingCount((c) => c - 1);
    }
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  /** Insert metadata for every ready photo (call ONLY after the reopen RPC
   *  succeeded). Returns the number of photos that failed to attach. */
  async function attachAll(): Promise<number> {
    const targets = photos.filter((p) => p.status === "ready" || p.status === "insert-error");
    let failed = 0;
    for (const p of targets) {
      const ok = await insertOne(p);
      if (!ok) failed += 1;
    }
    return failed;
  }

  async function retry(id: string) {
    const photo = photos.find((p) => p.id === id);
    if (!photo) return;
    if (photo.status === "upload-error") {
      patch(id, { status: "uploading", errorMessage: null });
      await uploadOne(photo);
    } else if (photo.status === "insert-error") {
      await insertOne(photo);
    }
  }

  function remove(id: string) {
    setPhotos((prev) => {
      const target = prev.find((p) => p.id === id);
      if (target) URL.revokeObjectURL(target.previewUrl);
      return prev.filter((p) => p.id !== id);
    });
  }

  // Blocks the form's submit: bytes uploading, files still downscaling, OR a
  // photo stuck in upload-error — attachAll skips upload-error photos, so
  // letting a submit through would silently drop evidence (review finding).
  // The SA resolves it by retrying or removing the photo.
  const anyInFlight =
    processingCount > 0 ||
    photos.some((p) => p.status === "uploading" || p.status === "upload-error");

  return { photos, anyInFlight, fileInputRef, handleFiles, attachAll, retry, remove };
}

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
      updatePending(upload.id, {
        status: "upload-error",
        errorMessage: uploadError.message || "Upload failed.",
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
        errorMessage: `Upload saved but failed to record — ${result.error}`,
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
          `"${file.name}" is not a supported image type. Use JPEG, PNG, WebP, or HEIC.`,
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

  async function handleRemove(photoId: string) {
    if (!window.confirm("Remove this photo? This can't be undone.")) return;
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
        <h2 className="text-sm font-medium text-zinc-400">{label}</h2>
        <label className="inline-flex h-9 cursor-pointer items-center justify-center rounded-md border border-zinc-700 bg-zinc-900 px-3 text-sm font-medium text-zinc-100 transition-colors focus-within:ring-2 focus-within:ring-zinc-500 hover:bg-zinc-800">
          <span aria-hidden="true" className="mr-1.5">
            +
          </span>
          Add photo
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
          className="mb-3 rounded-md border border-red-900/60 bg-red-950/40 px-3 py-2 text-xs text-red-200"
        >
          {topLevelError}
        </div>
      )}

      {!hasContent ? (
        <p className="rounded-md border border-zinc-800 bg-zinc-900/50 px-4 py-6 text-center text-sm text-zinc-500">
          No {label.toLowerCase()} photos yet.
        </p>
      ) : (
        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {photos.map((p) => (
            <Thumbnail
              key={p.id}
              photo={p}
              isRemoving={removingId === p.id}
              onRemove={() => void handleRemove(p.id)}
            />
          ))}
          {pending.map((up) => (
            <PendingTile key={up.id} upload={up} onRetry={() => void retry(up.id)} />
          ))}
        </ul>
      )}
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
    <li className="relative aspect-square overflow-hidden rounded-md border border-zinc-800 bg-zinc-900">
      {photo.url ? (
        // Plain <img> — using next/image with signed Supabase URLs
        // would require a remotePatterns entry in next.config.* for
        // the Storage host. PR 1 made the same call; carried forward.
        // eslint-disable-next-line @next/next/no-img-element
        <img src={photo.url} alt="" className="h-full w-full object-cover" loading="lazy" />
      ) : (
        <div className="flex h-full w-full items-center justify-center text-xs text-zinc-600">
          unavailable
        </div>
      )}
      <button
        type="button"
        onClick={onRemove}
        disabled={isRemoving}
        aria-label="Remove photo"
        className="absolute top-1.5 right-1.5 inline-flex h-7 w-7 items-center justify-center rounded-full border border-zinc-700 bg-zinc-950/80 text-zinc-100 backdrop-blur-sm transition-colors hover:bg-red-950/80 hover:text-red-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-zinc-300 disabled:opacity-50"
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
    <li className="relative aspect-square overflow-hidden rounded-md border border-zinc-800 bg-zinc-900">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={upload.previewUrl} alt="" className="h-full w-full object-cover opacity-50" />
      <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 px-2 text-center">
        {inProgress && (
          <>
            <Spinner />
            <span className="text-[11px] font-medium text-zinc-200">
              {upload.status === "uploading" ? "Uploading…" : "Saving…"}
            </span>
          </>
        )}
        {isError && (
          <>
            <span className="text-[11px] font-medium text-red-200">
              {upload.errorMessage ?? "Failed."}
            </span>
            <button
              type="button"
              onClick={onRetry}
              className="rounded border border-zinc-600 bg-zinc-900/90 px-2 py-0.5 text-[11px] font-medium text-zinc-100 hover:bg-zinc-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-zinc-300"
            >
              Retry
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
      className="inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-zinc-500 border-t-zinc-100"
    />
  );
}

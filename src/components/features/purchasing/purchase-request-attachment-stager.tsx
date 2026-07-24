"use client";

// 'use client' justification (spec 16 §4 P2): file input, staged-chip
// list, per-item upload state machine — pure client interaction state.
//
// Two modes:
//   • DEFERRED (create form, no purchaseRequestId): images/links are
//     staged as chips; the form calls flush(prId) via ref AFTER
//     createPurchaseRequest succeeds. Attachment failures never roll
//     back the request — failed items stay listed with ลองใหม่.
//   • IMMEDIATE (pending-card expander, purchaseRequestId set): each
//     added item uploads/saves right away against the known parent.
//
// Pipeline per image (spec 16 §4, amended by spec 34): the photo is
// PREPARED first (downscale via preparePhotoForUpload — ext comes from
// the prepared result, filename casing never decides), pre-assigned
// crypto.randomUUID(), browser uploads the prepared bytes direct to
// pr-attachments (upsert:false) at the canonical path, then the
// metadata-only server action — never a client-supplied path.
// Chips stage SYNCHRONOUSLY (status "preparing") before the async
// prepare so a deferred flush() can never miss an in-flight photo;
// flush awaits all outstanding prepares first.

import { forwardRef, useImperativeHandle, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { addPurchaseRequestAttachment } from "@/app/requests/actions";
import { createClient } from "@/lib/db/browser";
import { preparePhotoForUpload } from "@/lib/photos/downscale";
import {
  classifyStorageUploadError,
  queueNowMs,
  type QueuedUpload,
} from "@/lib/photos/upload-queue";
import { notifyQueueChanged, safeQueuePut, safeQueueRemove } from "@/lib/photos/upload-queue-idb";
import { buildPrAttachmentStoragePath } from "@/lib/purchasing/attachment-path";
import {
  ATTACHMENT_ACCEPT_MIME,
  attachmentExtToMime,
  isPdfMime,
  type AttachmentExt,
} from "@/lib/purchasing/attachment-file";
import { validateAttachmentLink } from "@/lib/purchasing/validate-attachment";
import { BUTTON_SECONDARY_MUTED, FIELD_INPUT, INLINE_ALERT_TEXT } from "@/lib/ui/classes";

type ItemStatus =
  | "preparing"
  | "staged"
  | "uploading"
  | "saving"
  | "upload-error"
  | "insert-error"
  | "done";

interface StagedItem {
  // Spec 121: 'pdf' joins 'image' as a stored-bytes file kind (links carry a url).
  id: string;
  kind: "image" | "pdf" | "link";
  // Prepared bytes (image: spec-34 downscale; pdf: raw) — retries reuse them.
  blob?: Blob;
  ext?: AttachmentExt;
  url?: string;
  label: string;
  status: ItemStatus;
}

export interface AttachmentStagerHandle {
  // Uploads/saves every staged item against the given request id.
  // Resolves with the number of items that FAILED (0 = all landed).
  flush(purchaseRequestId: string): Promise<number>;
}

interface PurchaseRequestAttachmentStagerProps {
  projectId: string;
  purchaseRequestId?: string;
  /** Session user — enables the offline-queue bracket (spec 37). When
   *  absent, items stay in-memory only (today's pre-spec-37 behavior). */
  userId?: string;
  disabled?: boolean;
}

export const PurchaseRequestAttachmentStager = forwardRef<
  AttachmentStagerHandle,
  PurchaseRequestAttachmentStagerProps
>(function PurchaseRequestAttachmentStager(
  { projectId, purchaseRequestId, userId, disabled },
  ref,
) {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [items, setItems] = useState<StagedItem[]>([]);
  const [linkDraft, setLinkDraft] = useState<string>("");
  const [linkError, setLinkError] = useState<string | null>(null);
  // After a deferred flush the parent id is known — failed items retry
  // against it even though the component stays in deferred mode.
  const flushedIdRef = useRef<string | null>(null);
  const immediate = typeof purchaseRequestId === "string";
  const retryTarget = purchaseRequestId ?? flushedIdRef.current;
  // In-flight prepare jobs (spec 34): flush() awaits these so a submit
  // during a slow phone-photo decode cannot orphan the chip or attach
  // it to a LATER request.
  const preparesRef = useRef<Set<Promise<void>>>(new Set());
  // Fresh items snapshot for flush(): after awaiting prepares, the
  // closure's `items` is stale — the ref always holds the last render's.
  const itemsRef = useRef<StagedItem[]>(items);
  itemsRef.current = items;

  function patchItem(id: string, patch: Partial<StagedItem>) {
    setItems((prev) => prev.map((it) => (it.id === id ? { ...it, ...patch } : it)));
  }

  // Runs ONE item to completion against a known parent id. Returns true
  // on success. upload-error retries re-upload the same uuid;
  // insert-error retries replay only the action (spec 16 §4 state machine).
  async function runItem(item: StagedItem, prId: string): Promise<boolean> {
    if (item.kind === "link") {
      patchItem(item.id, { status: "saving" });
      const result = await addPurchaseRequestAttachment({
        purchaseRequestId: prId,
        kind: "link",
        url: item.url ?? "",
      });
      patchItem(item.id, { status: result.ok ? "done" : "insert-error" });
      return result.ok;
    }

    const { blob, ext } = item;
    if (!blob || !ext) {
      patchItem(item.id, { status: "upload-error" });
      return false;
    }

    const path = buildPrAttachmentStoragePath(projectId, prId, item.id, ext);
    if (!path) {
      patchItem(item.id, { status: "upload-error" });
      return false;
    }

    // Spec 37: queue bracket — only possible once the parent id exists
    // (deferred chips queue at flush time, immediate ones right away).
    // Rebuilt per call ON PURPOSE: a manual ลองใหม่ resets the persisted
    // attempts/backoff (user-initiated = fresh start). lastModifiedMs is
    // synthetic (enqueue time) — no reference-attachment consumer reads
    // it as capture time.
    // Spec 121: the offline upload queue stays image-only (QueuedUpload.ext is
    // PhotoExt). A PDF reference is manual-retry (mirrors the invoice uploader's
    // no-queue posture) — recorded seam. ext !== "pdf" narrows ext to PhotoExt.
    const queueItem: QueuedUpload | null =
      userId && ext !== "pdf"
        ? {
            kind: "reference_attachment",
            id: item.id,
            userId,
            purchaseRequestId: prId,
            ext,
            blob,
            lastModifiedMs: queueNowMs(),
            fileName: item.label,
            storagePath: path,
            step: "upload",
            attempts: 0,
            lastError: null,
            enqueuedAtMs: queueNowMs(),
            // Spec 352 U1 stamps the WP `photos` bucket only; the pr-attachments
            // affordance is a later PR, so ride the neutral "picker" for now.
            captureMethod: "picker",
          }
        : null;

    if (item.status !== "insert-error") {
      patchItem(item.id, { status: "uploading" });
      if (queueItem) await safeQueuePut(queueItem);
      const supabase = createClient();
      const { error } = await supabase.storage
        .from("pr-attachments")
        .upload(path, blob, { upsert: false, contentType: attachmentExtToMime(ext) });
      if (error && !classifyStorageUploadError(error).alreadyExists) {
        if (queueItem) notifyQueueChanged();
        patchItem(item.id, { status: "upload-error" });
        return false;
      }
      if (queueItem) await safeQueuePut({ ...queueItem, step: "insert" });
    }

    patchItem(item.id, { status: "saving" });
    let result: Awaited<ReturnType<typeof addPurchaseRequestAttachment>>;
    try {
      result = await addPurchaseRequestAttachment({
        purchaseRequestId: prId,
        // Spec 121: 'image' or 'pdf' (link handled above); server re-derives.
        kind: item.kind,
        attachmentId: item.id,
        ext,
      });
    } catch (err) {
      console.error("[attachment-stager] action invocation failed", err);
      result = { ok: false, error: "บันทึกรูปไม่สำเร็จ กรุณาลองใหม่อีกครั้ง" };
    }
    if (result.ok && queueItem) {
      await safeQueueRemove(item.id);
      notifyQueueChanged();
    } else if (!result.ok && queueItem) {
      notifyQueueChanged();
    }
    patchItem(item.id, { status: result.ok ? "done" : "insert-error" });
    return result.ok;
  }

  async function flush(prId: string): Promise<number> {
    flushedIdRef.current = prId;
    // Wait for in-flight prepares so every selected photo is staged with
    // its bytes before the snapshot below (spec 34 race fix).
    await Promise.all([...preparesRef.current]);
    let failed = 0;
    for (const item of itemsRef.current.filter((it) => it.status !== "done")) {
      const ok = await runItem(item, prId);
      if (!ok) failed += 1;
    }
    setItems((prev) => prev.filter((it) => it.status !== "done"));
    return failed;
  }

  useImperativeHandle(ref, () => ({ flush }));

  async function handleFiles(files: FileList | null) {
    if (!files) return;
    // Stage EVERY chip synchronously (status "preparing") before any
    // async work — a deferred flush during a slow decode must see them.
    const fileArr = Array.from(files);
    // Spec 121: the kind is knowable synchronously from the MIME — a PDF stages
    // as kind 'pdf', a photo as 'image' (so a deferred flush sees the right kind).
    const stagedChips: StagedItem[] = fileArr.map((file) => ({
      id: crypto.randomUUID(),
      kind: isPdfMime(file.type) ? "pdf" : "image",
      label: file.name,
      status: "preparing",
    }));
    setItems((prev) => [...prev, ...stagedChips]);
    if (fileInputRef.current) fileInputRef.current.value = "";

    const job = (async () => {
      for (let i = 0; i < fileArr.length; i += 1) {
        const file = fileArr[i];
        const chip = stagedChips[i];
        if (!file || !chip) continue;
        if (isPdfMime(file.type)) {
          // Spec 121 / ADR 0046 Layer A: PDFs upload RAW (the spec-34 pipeline
          // is photo-only). No prepare; bytes pass through unchanged.
          patchItem(chip.id, { blob: file, ext: "pdf", status: "staged" });
          if (immediate) {
            await runItem(
              { ...chip, blob: file, ext: "pdf", status: "staged" },
              purchaseRequestId!,
            );
            router.refresh();
          }
          continue;
        }
        // Spec 34 / ADR 0036: downscale before upload (failure → original).
        const prepared = await preparePhotoForUpload(file);
        if (!prepared) {
          setItems((prev) => prev.filter((it) => it.id !== chip.id));
          setLinkError("ไฟล์นี้ไม่รองรับ กรุณาเลือกรูปภาพหรือ PDF");
          continue;
        }
        patchItem(chip.id, { blob: prepared.blob, ext: prepared.ext, status: "staged" });
        if (immediate) {
          await runItem(
            { ...chip, blob: prepared.blob, ext: prepared.ext, status: "staged" },
            purchaseRequestId!,
          );
          router.refresh();
        }
      }
    })();
    preparesRef.current.add(job);
    try {
      await job;
    } finally {
      preparesRef.current.delete(job);
    }
  }

  async function handleAddLink() {
    const link = validateAttachmentLink(linkDraft);
    if (!link.ok) {
      setLinkError(link.error);
      return;
    }
    setLinkError(null);
    setLinkDraft("");
    const item: StagedItem = {
      id: crypto.randomUUID(),
      kind: "link",
      url: link.value,
      label: link.value,
      status: "staged",
    };
    setItems((prev) => [...prev, item]);
    if (immediate) {
      await runItem(item, purchaseRequestId!);
      router.refresh();
    }
  }

  const visibleItems = items.filter((it) => it.status !== "done");

  return (
    <div className="flex flex-col gap-2">
      <div className="flex gap-2">
        <input
          ref={fileInputRef}
          type="file"
          accept={ATTACHMENT_ACCEPT_MIME}
          multiple
          className="sr-only"
          onChange={(e) => void handleFiles(e.target.files)}
          disabled={disabled}
        />
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          disabled={disabled}
          className={BUTTON_SECONDARY_MUTED}
        >
          แนบรูป/PDF
        </button>
      </div>
      <div className="flex gap-2">
        <input
          type="url"
          value={linkDraft}
          onChange={(e) => {
            setLinkDraft(e.target.value);
            setLinkError(null);
          }}
          disabled={disabled}
          placeholder="https://…"
          className={FIELD_INPUT}
        />
        <button
          type="button"
          onClick={() => void handleAddLink()}
          disabled={disabled || linkDraft.trim().length === 0}
          className="rounded-control border-edge-strong bg-card text-ink shadow-input hover:bg-sunk focus-visible:ring-action inline-flex h-11 shrink-0 items-center justify-center border px-3 text-sm font-medium transition-colors focus:outline-none focus-visible:ring-2 disabled:cursor-not-allowed disabled:opacity-60"
        >
          เพิ่มลิงก์
        </button>
      </div>
      {linkError ? (
        <p role="alert" className={INLINE_ALERT_TEXT}>
          {linkError}
        </p>
      ) : null}
      {visibleItems.length > 0 ? (
        <ul className="flex flex-col gap-1">
          {visibleItems.map((item) => (
            <li
              key={item.id}
              className="border-edge-strong bg-card flex items-center gap-2 rounded-md border px-2 py-1.5 text-xs"
            >
              <span className="text-ink min-w-0 flex-1 truncate">{item.label}</span>
              {item.status === "preparing" ? (
                <span className="text-ink-secondary shrink-0">กำลังเตรียมรูป…</span>
              ) : item.status === "uploading" ? (
                <span className="text-ink-secondary shrink-0">กำลังอัปโหลด…</span>
              ) : item.status === "saving" ? (
                <span className="text-ink-secondary shrink-0">กำลังบันทึก…</span>
              ) : item.status === "upload-error" || item.status === "insert-error" ? (
                <>
                  <span className="text-danger shrink-0 font-medium">
                    {item.kind === "link"
                      ? "บันทึกลิงก์ไม่สำเร็จ กรุณาลองใหม่อีกครั้ง"
                      : "บันทึกไฟล์ไม่สำเร็จ กรุณาลองใหม่อีกครั้ง"}
                  </span>
                  {retryTarget ? (
                    <button
                      type="button"
                      onClick={() => void runItem(item, retryTarget)}
                      className="text-action shrink-0 font-medium hover:underline"
                    >
                      ลองใหม่
                    </button>
                  ) : null}
                </>
              ) : (
                <button
                  type="button"
                  onClick={() => setItems((prev) => prev.filter((it) => it.id !== item.id))}
                  disabled={disabled}
                  className="text-danger shrink-0 font-medium hover:underline disabled:opacity-60"
                >
                  ลบ
                </button>
              )}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
});

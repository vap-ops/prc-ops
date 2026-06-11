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
// Pipeline per image (spec 16 §4): ext from MIME (mimeToPhotoExt),
// pre-assigned crypto.randomUUID(), browser uploads bytes direct to
// pr-attachments (upsert:false) at the canonical path, then the
// metadata-only server action — never a client-supplied path.

import { forwardRef, useImperativeHandle, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { addPurchaseRequestAttachment } from "@/app/requests/actions";
import { createClient } from "@/lib/db/browser";
import { mimeToPhotoExt, type PhotoExt } from "@/lib/photos/path";
import { buildPrAttachmentStoragePath } from "@/lib/purchasing/attachment-path";
import { validateAttachmentLink } from "@/lib/purchasing/validate-attachment";

type ItemStatus = "staged" | "uploading" | "saving" | "upload-error" | "insert-error" | "done";

interface StagedItem {
  id: string;
  kind: "image" | "link";
  file?: File;
  ext?: PhotoExt;
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
  disabled?: boolean;
}

export const PurchaseRequestAttachmentStager = forwardRef<
  AttachmentStagerHandle,
  PurchaseRequestAttachmentStagerProps
>(function PurchaseRequestAttachmentStager({ projectId, purchaseRequestId, disabled }, ref) {
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

    if (item.status !== "insert-error") {
      patchItem(item.id, { status: "uploading" });
      const path = buildPrAttachmentStoragePath(projectId, prId, item.id, item.ext!);
      if (!path || !item.file) {
        patchItem(item.id, { status: "upload-error" });
        return false;
      }
      const supabase = createClient();
      const { error } = await supabase.storage
        .from("pr-attachments")
        .upload(path, item.file, { upsert: false, contentType: item.file.type });
      if (error) {
        patchItem(item.id, { status: "upload-error" });
        return false;
      }
    }

    patchItem(item.id, { status: "saving" });
    const result = await addPurchaseRequestAttachment({
      purchaseRequestId: prId,
      kind: "image",
      attachmentId: item.id,
      ext: item.ext!,
    });
    patchItem(item.id, { status: result.ok ? "done" : "insert-error" });
    return result.ok;
  }

  async function flush(prId: string): Promise<number> {
    flushedIdRef.current = prId;
    let failed = 0;
    for (const item of items.filter((it) => it.status !== "done")) {
      const ok = await runItem(item, prId);
      if (!ok) failed += 1;
    }
    setItems((prev) => prev.filter((it) => it.status !== "done"));
    return failed;
  }

  useImperativeHandle(ref, () => ({ flush }));

  async function handleFiles(files: FileList | null) {
    if (!files) return;
    for (const file of Array.from(files)) {
      const ext = mimeToPhotoExt(file.type);
      if (!ext) {
        setLinkError("ไฟล์นี้ไม่รองรับ กรุณาเลือกรูปภาพ (JPEG, PNG, WebP, HEIC)");
        continue;
      }
      const item: StagedItem = {
        id: crypto.randomUUID(),
        kind: "image",
        file,
        ext,
        label: file.name,
        status: "staged",
      };
      setItems((prev) => [...prev, item]);
      if (immediate) {
        await runItem(item, purchaseRequestId!);
        router.refresh();
      }
    }
    if (fileInputRef.current) fileInputRef.current.value = "";
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
          accept="image/jpeg,image/png,image/webp,image/heic"
          multiple
          className="sr-only"
          onChange={(e) => void handleFiles(e.target.files)}
          disabled={disabled}
        />
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          disabled={disabled}
          className="inline-flex h-11 items-center justify-center rounded-md border border-zinc-400 bg-white px-3 text-sm font-medium text-zinc-900 transition-colors hover:bg-zinc-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
        >
          แนบรูป
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
          className="h-11 w-full min-w-0 rounded-md border border-zinc-400 bg-white px-3 text-sm text-zinc-900 placeholder:text-zinc-400 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-700"
        />
        <button
          type="button"
          onClick={() => void handleAddLink()}
          disabled={disabled || linkDraft.trim().length === 0}
          className="inline-flex h-11 shrink-0 items-center justify-center rounded-md border border-zinc-400 bg-white px-3 text-sm font-medium text-zinc-900 transition-colors hover:bg-zinc-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
        >
          เพิ่มลิงก์
        </button>
      </div>
      {linkError ? (
        <p role="alert" className="text-xs font-medium text-red-700">
          {linkError}
        </p>
      ) : null}
      {visibleItems.length > 0 ? (
        <ul className="flex flex-col gap-1">
          {visibleItems.map((item) => (
            <li
              key={item.id}
              className="flex items-center gap-2 rounded-md border border-zinc-300 bg-white px-2 py-1.5 text-xs"
            >
              <span className="min-w-0 flex-1 truncate text-zinc-900">{item.label}</span>
              {item.status === "uploading" ? (
                <span className="shrink-0 text-zinc-600">กำลังอัปโหลด…</span>
              ) : item.status === "saving" ? (
                <span className="shrink-0 text-zinc-600">กำลังบันทึก…</span>
              ) : item.status === "upload-error" || item.status === "insert-error" ? (
                <>
                  <span className="shrink-0 font-medium text-red-700">
                    {item.kind === "link"
                      ? "บันทึกลิงก์ไม่สำเร็จ กรุณาลองใหม่อีกครั้ง"
                      : "บันทึกรูปไม่สำเร็จ กรุณาลองใหม่อีกครั้ง"}
                  </span>
                  {retryTarget ? (
                    <button
                      type="button"
                      onClick={() => void runItem(item, retryTarget)}
                      className="shrink-0 font-medium text-blue-700 hover:underline"
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
                  className="shrink-0 font-medium text-red-700 hover:underline disabled:opacity-60"
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

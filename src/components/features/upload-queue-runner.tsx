"use client";

// Spec 35 / ADR 0039 — global drain loop for the offline photo queue.
// 'use client' justification: IndexedDB + window events + timers.
// Mounted once in the root layout; renders nothing unless the queue
// has items (then: a small fixed banner above the tab bar).
//
// The live phase-uploader handles photos while its page is open; this
// runner exists for LEFTOVERS — crash, navigation, offline, next app
// open. Overlap with the live path is harmless (replay is idempotent
// end-to-end, ADR 0039); navigator.locks is an optimization that stops
// concurrent runner passes across tabs, not a correctness requirement.

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient as createBrowserSupabase } from "@/lib/db/browser";
import { photoExtToMime } from "@/lib/photos/path";
import {
  bucketForKind,
  classifyStorageUploadError,
  nextPassDelayMs,
  processQueue,
  type ProcessDeps,
  type QueuedUpload,
} from "@/lib/photos/upload-queue";
import {
  createIdbQueueStore,
  QUEUE_CHANGED_EVENT,
  safeQueueRemove,
} from "@/lib/photos/upload-queue-idb";
import { addPhoto } from "@/app/projects/[projectId]/work-packages/[workPackageId]/actions";
import { addDeliveryConfirmationPhoto, addPurchaseRequestAttachment } from "@/app/requests/actions";
import { ConfirmDialog } from "@/components/features/confirm-dialog";

const LOCK_NAME = "prc-photo-upload-queue";

async function buildDeps(): Promise<{ deps: ProcessDeps; sessionUserId: string | null }> {
  const supabase = createBrowserSupabase();
  // Shared-device guard (ADR 0039): resolve the session user once per
  // pass; foreign/ownerless items are skipped inside processQueue.
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const sessionUserId = user?.id ?? null;
  const deps: ProcessDeps = {
    async uploadBytes(item) {
      const { error } = await supabase.storage
        .from(bucketForKind(item.kind))
        .upload(item.storagePath, item.blob, {
          contentType: photoExtToMime(item.ext),
          upsert: false,
        });
      if (!error) return { ok: true };
      const { alreadyExists } = classifyStorageUploadError(error);
      return { ok: false, alreadyExists, message: error.message };
    },
    async insertMeta(item) {
      try {
        // Spec 37: the metadata action follows the kind; every action
        // has the identity-complete 23505 replay path, so re-running a
        // landed insert returns ok.
        let result: { ok: true } | { ok: false; error: string };
        if (item.kind === "phase_photo") {
          result = await addPhoto({
            workPackageId: item.workPackageId,
            phase: item.phase,
            photoId: item.id,
            ext: item.ext,
            capturedAtClient: new Date(item.lastModifiedMs).toISOString(),
          });
        } else if (item.kind === "delivery_photo") {
          result = await addDeliveryConfirmationPhoto({
            purchaseRequestId: item.purchaseRequestId,
            attachmentId: item.id,
            ext: item.ext,
          });
        } else {
          result = await addPurchaseRequestAttachment({
            purchaseRequestId: item.purchaseRequestId,
            kind: "image",
            attachmentId: item.id,
            ext: item.ext,
          });
        }
        return result.ok ? { ok: true } : { ok: false, message: result.error };
      } catch (err) {
        // Server action invocation itself failed (offline, dead session
        // mid-redirect) — keep the item, retry later.
        return { ok: false, message: err instanceof Error ? err.message : String(err) };
      }
    },
    currentUserId: sessionUserId,
  };
  return { deps, sessionUserId };
}

export function UploadQueueRunner() {
  const router = useRouter();
  const [items, setItems] = useState<ReadonlyArray<QueuedUpload>>([]);
  // For the discard list: foreign items render read-only (ADR 0039 —
  // another user's un-sent evidence must not be discardable here).
  const [sessionUserId, setSessionUserId] = useState<string | null>(null);
  // Spec 67: which queued item is awaiting a themed-dialog discard confirm.
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const runningRef = useRef(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const runPass = useCallback(async () => {
    const store = createIdbQueueStore();
    if (!store) return;

    const refreshCount = async () => setItems(await store.all());

    if ((await store.count()) === 0) {
      setItems([]);
      return;
    }
    if (runningRef.current) return;
    runningRef.current = true;

    const work = async () => {
      const { deps, sessionUserId: uid } = await buildDeps();
      setSessionUserId(uid);
      const result = await processQueue(store, deps);
      await refreshCount();
      if (result.sent > 0) router.refresh();
      const remaining = await store.all();
      const delay = nextPassDelayMs(remaining);
      if (delay !== null) {
        if (timerRef.current) clearTimeout(timerRef.current);
        // Re-trigger via the queue-changed event (the effect below
        // listens for it) — avoids a self-referencing callback.
        timerRef.current = setTimeout(
          () => window.dispatchEvent(new Event(QUEUE_CHANGED_EVENT)),
          delay,
        );
      }
    };

    const scheduleRetry = (delayMs: number) => {
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(
        () => window.dispatchEvent(new Event(QUEUE_CHANGED_EVENT)),
        delayMs,
      );
    };

    try {
      const locks = typeof navigator !== "undefined" ? navigator.locks : undefined;
      if (locks) {
        await locks.request(LOCK_NAME, { ifAvailable: true }, async (lock) => {
          if (lock) {
            await work();
          } else {
            // Another tab is draining — keep our banner honest and
            // check back soon.
            await refreshCount();
            scheduleRetry(10_000);
          }
        });
      } else {
        await work();
      }
    } catch (err) {
      // A pass that died mid-loop (e.g. transient IDB error) must not
      // freeze the drain — items are still queued; try again later.
      console.error("[upload-queue-runner] pass failed", err);
      scheduleRetry(30_000);
    } finally {
      runningRef.current = false;
    }
  }, [router]);

  useEffect(() => {
    const onTrigger = () => void runPass();
    // Initial pass deferred a tick — the effect only wires triggers;
    // state updates happen in the async callback, not synchronously.
    const initial = setTimeout(onTrigger, 0);
    const onVisible = () => {
      if (document.visibilityState === "visible") void runPass();
    };
    window.addEventListener("online", onTrigger);
    window.addEventListener(QUEUE_CHANGED_EVENT, onTrigger);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearTimeout(initial);
      window.removeEventListener("online", onTrigger);
      window.removeEventListener(QUEUE_CHANGED_EVENT, onTrigger);
      document.removeEventListener("visibilitychange", onVisible);
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [runPass]);

  async function discard(id: string) {
    // Honest copy: a send that is ALREADY mid-flight may still complete
    // (the core skips put-backs after a discard, but cannot recall a
    // request already on the wire). Spec 67: confirmed via the themed
    // ConfirmDialog (confirmId state), not window.confirm.
    await safeQueueRemove(id);
    // Recount via the runner's own trigger path (also re-checks the
    // whole queue) instead of a second hand-rolled IDB read here.
    window.dispatchEvent(new Event(QUEUE_CHANGED_EVENT));
  }

  if (items.length === 0) return null;

  return (
    <details className="border-attn-edge bg-attn-soft text-attn-ink fixed inset-x-0 bottom-16 z-30 mx-auto w-fit max-w-[90vw] rounded-2xl border px-4 py-1.5 text-xs font-medium shadow sm:bottom-4">
      <summary className="cursor-pointer">
        {/* role=status on the count text only — a live region must not
            swallow the disclosure semantics or the buttons below. */}
        <span role="status">รอส่งรูป {items.length} รูป — จะส่งอัตโนมัติเมื่อมีสัญญาณ</span>
      </summary>
      {/* Spec 37: the manual-discard seam — the ONLY way an item ever
          leaves the queue without landing; confirm-guarded. Foreign
          items (other users' evidence, ADR 0039) are read-only. */}
      <ul className="border-attn-edge mt-2 flex max-h-40 flex-col gap-1 overflow-y-auto border-t pt-2">
        {items.map((item) => (
          <li key={item.id} className="flex min-h-11 items-center gap-2">
            {item.userId === sessionUserId ? (
              <>
                <span className="min-w-0 flex-1 truncate">{item.fileName}</span>
                {item.lastError ? (
                  <span className="text-attn-press shrink-0 text-[10px]">รอส่งใหม่</span>
                ) : null}
                <button
                  type="button"
                  onClick={() => setConfirmId(item.id)}
                  className="text-danger inline-flex min-h-11 shrink-0 items-center font-semibold hover:underline focus:outline-none focus-visible:underline"
                >
                  ลบ
                </button>
              </>
            ) : (
              <span className="text-attn-press min-w-0 flex-1 truncate">
                รูปของผู้ใช้อื่น — รอเจ้าของเข้าสู่ระบบ
              </span>
            )}
          </li>
        ))}
      </ul>
      <ConfirmDialog
        open={confirmId !== null}
        message="ลบรูปที่ยังไม่ได้ส่งนี้หรือไม่?"
        confirmLabel="ลบ"
        onConfirm={() => {
          const id = confirmId;
          setConfirmId(null);
          if (id) void discard(id);
        }}
        onCancel={() => setConfirmId(null)}
      />
    </details>
  );
}

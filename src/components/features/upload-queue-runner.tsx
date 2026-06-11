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
  classifyStorageUploadError,
  nextPassDelayMs,
  processQueue,
  type ProcessDeps,
} from "@/lib/photos/upload-queue";
import { createIdbQueueStore, QUEUE_CHANGED_EVENT } from "@/lib/photos/upload-queue-idb";
import { addPhoto } from "@/app/sa/projects/[projectId]/work-packages/[workPackageId]/actions";

const LOCK_NAME = "prc-photo-upload-queue";
const PHOTOS_BUCKET = "photos";

async function buildDeps(): Promise<ProcessDeps> {
  const supabase = createBrowserSupabase();
  // Shared-device guard (ADR 0039): resolve the session user once per
  // pass; foreign/ownerless items are skipped inside processQueue.
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return {
    async uploadBytes(item) {
      const { error } = await supabase.storage
        .from(PHOTOS_BUCKET)
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
        const result = await addPhoto({
          workPackageId: item.workPackageId,
          phase: item.phase,
          photoId: item.id,
          ext: item.ext,
          capturedAtClient: new Date(item.lastModifiedMs).toISOString(),
        });
        return result.ok ? { ok: true } : { ok: false, message: result.error };
      } catch (err) {
        // Server action invocation itself failed (offline, dead session
        // mid-redirect) — keep the item, retry later.
        return { ok: false, message: err instanceof Error ? err.message : String(err) };
      }
    },
    currentUserId: user?.id ?? null,
  };
}

export function UploadQueueRunner() {
  const router = useRouter();
  const [count, setCount] = useState(0);
  const runningRef = useRef(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const runPass = useCallback(async () => {
    const store = createIdbQueueStore();
    if (!store) return;

    const refreshCount = async () => setCount(await store.count());

    if ((await store.count()) === 0) {
      setCount(0);
      return;
    }
    if (runningRef.current) return;
    runningRef.current = true;

    const work = async () => {
      const result = await processQueue(store, await buildDeps());
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

  if (count === 0) return null;

  return (
    <div
      role="status"
      className="fixed inset-x-0 bottom-16 z-30 mx-auto w-fit rounded-full border border-amber-400 bg-amber-50 px-4 py-1.5 text-xs font-medium text-amber-900 shadow sm:bottom-4"
    >
      รอส่งรูป {count} รูป — จะส่งอัตโนมัติเมื่อมีสัญญาณ
    </div>
  );
}

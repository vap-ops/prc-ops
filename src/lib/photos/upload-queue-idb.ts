// Spec 35 / ADR 0039 — IndexedDB QueueStore (browser seam; the pure
// core lives in upload-queue.ts). Raw IDB, no dependencies. Import
// only from client components — there is no IDB on the server.

import {
  normalizeQueuedUpload,
  type QueueStore,
  type QueuedUpload,
} from "@/lib/photos/upload-queue";

const DB_NAME = "prc-ops";
const STORE_NAME = "photo-upload-queue";
const DB_VERSION = 1;

export const QUEUE_CHANGED_EVENT = "prc:upload-queue-changed";

export function notifyQueueChanged(): void {
  window.dispatchEvent(new Event(QUEUE_CHANGED_EVENT));
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: "id" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("indexedDB open failed"));
  });
}

function requestToPromise<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("indexedDB request failed"));
  });
}

class IdbQueueStore implements QueueStore {
  private async store(mode: IDBTransactionMode): Promise<IDBObjectStore> {
    const db = await openDb();
    return db.transaction(STORE_NAME, mode).objectStore(STORE_NAME);
  }

  async all(): Promise<QueuedUpload[]> {
    const store = await this.store("readonly");
    const rows = await requestToPromise(store.getAll() as IDBRequest<QueuedUpload[]>);
    // Spec 37: items persisted by spec 35 carry no `kind` — normalize.
    return rows.map(normalizeQueuedUpload).sort((a, b) => a.enqueuedAtMs - b.enqueuedAtMs);
  }

  async put(item: QueuedUpload): Promise<void> {
    const store = await this.store("readwrite");
    await requestToPromise(store.put(item));
  }

  async remove(id: string): Promise<void> {
    const store = await this.store("readwrite");
    await requestToPromise(store.delete(id));
  }

  async has(id: string): Promise<boolean> {
    const store = await this.store("readonly");
    return (await requestToPromise(store.count(id))) > 0;
  }

  async count(): Promise<number> {
    const store = await this.store("readonly");
    return requestToPromise(store.count());
  }
}

// null when IndexedDB is unavailable (private-mode edge cases) — the
// queue is a safety net; callers fall back to today's in-memory flow.
export function createIdbQueueStore(): QueueStore | null {
  if (typeof indexedDB === "undefined") return null;
  return new IdbQueueStore();
}

// Queue I/O is a SAFETY NET — a broken IndexedDB (quota, private mode)
// must never break the live upload pipelines it protects (spec 35
// review lesson). Shared by every uploader.
export async function safeQueuePut(item: QueuedUpload): Promise<void> {
  try {
    await createIdbQueueStore()?.put(item);
  } catch (err) {
    console.error("[upload-queue] put failed (live flow continues)", err);
  }
}

export async function safeQueueRemove(id: string): Promise<void> {
  try {
    await createIdbQueueStore()?.remove(id);
  } catch (err) {
    console.error("[upload-queue] remove failed", err);
  }
}

// Spec 35 / ADR 0039 — IndexedDB QueueStore (browser seam; the pure
// core lives in upload-queue.ts). Raw IDB, no dependencies. Import
// only from client components — there is no IDB on the server.

import type { QueueStore, QueuedPhoto } from "@/lib/photos/upload-queue";

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

  async all(): Promise<QueuedPhoto[]> {
    const store = await this.store("readonly");
    const rows = await requestToPromise(store.getAll() as IDBRequest<QueuedPhoto[]>);
    return rows.sort((a, b) => a.enqueuedAtMs - b.enqueuedAtMs);
  }

  async put(item: QueuedPhoto): Promise<void> {
    const store = await this.store("readwrite");
    await requestToPromise(store.put(item));
  }

  async remove(id: string): Promise<void> {
    const store = await this.store("readwrite");
    await requestToPromise(store.delete(id));
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

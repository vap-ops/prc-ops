import { describe, expect, it } from "vitest";
import {
  backoffMs,
  classifyStorageUploadError,
  nextPassDelayMs,
  processQueue,
  type ProcessDeps,
  type QueueStore,
  type QueuedPhoto,
} from "@/lib/photos/upload-queue";

function makeItem(overrides: Partial<QueuedPhoto> = {}): QueuedPhoto {
  return {
    id: "11111111-0000-4000-8000-000000000001",
    userId: "user-a",
    workPackageId: "wp",
    phase: "after",
    ext: "jpeg",
    blob: new Blob(["x"]),
    lastModifiedMs: 1_000,
    fileName: "a.jpg",
    storagePath: "p/wp/x.jpeg",
    step: "upload",
    attempts: 0,
    lastError: null,
    enqueuedAtMs: 0,
    ...overrides,
  };
}

class MemoryStore implements QueueStore {
  items = new Map<string, QueuedPhoto>();
  async all(): Promise<QueuedPhoto[]> {
    return [...this.items.values()].sort((a, b) => a.enqueuedAtMs - b.enqueuedAtMs);
  }
  async put(item: QueuedPhoto): Promise<void> {
    this.items.set(item.id, item);
  }
  async remove(id: string): Promise<void> {
    this.items.delete(id);
  }
  async count(): Promise<number> {
    return this.items.size;
  }
}

function deps(overrides: Partial<ProcessDeps> = {}): ProcessDeps {
  return {
    uploadBytes: async () => ({ ok: true }),
    insertMeta: async () => ({ ok: true }),
    currentUserId: "user-a",
    ...overrides,
  };
}

describe("processQueue", () => {
  it("runs both steps and removes the item on full success", async () => {
    const store = new MemoryStore();
    await store.put(makeItem());

    const result = await processQueue(store, deps());

    expect(result).toEqual({ sent: 1, remaining: 0 });
    expect(store.items.size).toBe(0);
  });

  it("keeps a failed upload at step upload with attempts and the error persisted", async () => {
    const store = new MemoryStore();
    await store.put(makeItem());

    const result = await processQueue(
      store,
      deps({
        uploadBytes: async () => ({ ok: false, alreadyExists: false, message: "network down" }),
      }),
    );

    expect(result).toEqual({ sent: 0, remaining: 1 });
    const kept = store.items.get("11111111-0000-4000-8000-000000000001");
    expect(kept?.step).toBe("upload");
    expect(kept?.attempts).toBe(1);
    expect(kept?.lastError).toBe("network down");
  });

  it("treats an already-uploaded object as success and advances to insert", async () => {
    const store = new MemoryStore();
    await store.put(makeItem());

    const result = await processQueue(
      store,
      deps({
        uploadBytes: async () => ({ ok: false, alreadyExists: true, message: "Duplicate" }),
      }),
    );

    expect(result).toEqual({ sent: 1, remaining: 0 });
    expect(store.items.size).toBe(0);
  });

  it("persists step insert when bytes landed but metadata failed, and resumes there", async () => {
    const store = new MemoryStore();
    await store.put(makeItem());
    let uploads = 0;

    await processQueue(
      store,
      deps({
        uploadBytes: async () => {
          uploads += 1;
          return { ok: true };
        },
        insertMeta: async () => ({ ok: false, message: "session expired" }),
      }),
    );
    const kept = store.items.get("11111111-0000-4000-8000-000000000001");
    expect(kept?.step).toBe("insert");
    expect(kept?.attempts).toBe(1);

    // Second pass: must NOT re-upload bytes; insert now succeeds.
    const second = await processQueue(
      store,
      deps({
        uploadBytes: async () => {
          uploads += 1;
          return { ok: true };
        },
      }),
    );
    expect(uploads).toBe(1);
    expect(second).toEqual({ sent: 1, remaining: 0 });
  });

  it("skips (never processes, never drops) items enqueued by a different user", async () => {
    const store = new MemoryStore();
    await store.put(makeItem({ userId: "user-b" }));
    let touched = 0;

    const result = await processQueue(
      store,
      deps({
        uploadBytes: async () => {
          touched += 1;
          return { ok: true };
        },
      }),
    );

    expect(touched).toBe(0);
    expect(result).toEqual({ sent: 0, remaining: 1 });
    expect(store.items.size).toBe(1);
  });

  it("skips everything when there is no session user", async () => {
    const store = new MemoryStore();
    await store.put(makeItem());

    const result = await processQueue(store, deps({ currentUserId: null }));

    expect(result).toEqual({ sent: 0, remaining: 1 });
    expect(store.items.size).toBe(1);
  });

  it("never drops an item regardless of attempt count", async () => {
    const store = new MemoryStore();
    await store.put(makeItem({ attempts: 99 }));

    const result = await processQueue(
      store,
      deps({
        uploadBytes: async () => ({ ok: false, alreadyExists: false, message: "still down" }),
      }),
    );

    expect(result.remaining).toBe(1);
    expect(store.items.get("11111111-0000-4000-8000-000000000001")?.attempts).toBe(100);
  });

  it("processes multiple items oldest-first and isolates failures", async () => {
    const store = new MemoryStore();
    await store.put(
      makeItem({ id: "11111111-0000-4000-8000-00000000000b", enqueuedAtMs: 2, fileName: "b" }),
    );
    await store.put(
      makeItem({ id: "11111111-0000-4000-8000-00000000000a", enqueuedAtMs: 1, fileName: "a" }),
    );

    const seen: string[] = [];
    const result = await processQueue(
      store,
      deps({
        uploadBytes: async (item) => {
          seen.push(item.fileName);
          return item.fileName === "a"
            ? { ok: false, alreadyExists: false, message: "x" }
            : { ok: true };
        },
      }),
    );

    expect(seen).toEqual(["a", "b"]);
    expect(result).toEqual({ sent: 1, remaining: 1 });
  });
});

describe("classifyStorageUploadError", () => {
  it("classifies duplicate-object responses as alreadyExists", () => {
    expect(classifyStorageUploadError({ statusCode: "409", message: "Duplicate" })).toEqual({
      alreadyExists: true,
    });
    expect(classifyStorageUploadError({ message: "The resource already exists" })).toEqual({
      alreadyExists: true,
    });
  });

  it("classifies anything else as a plain failure", () => {
    expect(classifyStorageUploadError({ statusCode: "503", message: "upstream" })).toEqual({
      alreadyExists: false,
    });
    expect(classifyStorageUploadError({ message: "Failed to fetch" })).toEqual({
      alreadyExists: false,
    });
  });
});

describe("backoff", () => {
  it("doubles from 5s and caps at 5 minutes", () => {
    expect(backoffMs(0)).toBe(5_000);
    expect(backoffMs(1)).toBe(10_000);
    expect(backoffMs(4)).toBe(80_000);
    expect(backoffMs(10)).toBe(300_000);
  });

  it("nextPassDelayMs takes the smallest backoff over the remaining items", () => {
    const items = [makeItem({ attempts: 4 }), makeItem({ attempts: 1 })];
    expect(nextPassDelayMs(items)).toBe(10_000);
  });

  it("nextPassDelayMs is null for an empty queue", () => {
    expect(nextPassDelayMs([])).toBeNull();
  });
});

import { describe, expect, it } from "vitest";
import {
  backoffMs,
  bucketForKind,
  classifyStorageUploadError,
  diagnoseStorageFailure,
  isAuthzDenied,
  nextPassDelayMs,
  normalizeQueuedUpload,
  pickUploadFailures,
  processQueue,
  type ProcessDeps,
  type QueueStore,
  type QueuedUpload,
} from "@/lib/photos/upload-queue";

function makeItem(overrides: Partial<QueuedUpload> = {}): QueuedUpload {
  return {
    kind: "phase_photo",
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
    captureMethod: "picker",
    ...overrides,
  } as QueuedUpload;
}

class MemoryStore implements QueueStore {
  items = new Map<string, QueuedUpload>();
  async all(): Promise<QueuedUpload[]> {
    return [...this.items.values()].sort((a, b) => a.enqueuedAtMs - b.enqueuedAtMs);
  }
  async put(item: QueuedUpload): Promise<void> {
    this.items.set(item.id, item);
  }
  async remove(id: string): Promise<void> {
    this.items.delete(id);
  }
  async has(id: string): Promise<boolean> {
    return this.items.has(id);
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

  it("never resurrects an item discarded mid-pass (spec 37 discard race)", async () => {
    const store = new MemoryStore();
    await store.put(makeItem());

    const result = await processQueue(
      store,
      deps({
        insertMeta: async (item) => {
          // Simulates the user discarding from the banner while the
          // pass is mid-flight: the put-back must be skipped.
          await store.remove(item.id);
          return { ok: false, message: "network down" };
        },
      }),
    );

    expect(store.items.size).toBe(0);
    expect(result).toEqual({ sent: 0, remaining: 0 });
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

describe("kinds (spec 37)", () => {
  it("maps kinds to their buckets", () => {
    expect(bucketForKind("phase_photo")).toBe("photos");
    expect(bucketForKind("reference_attachment")).toBe("pr-attachments");
    expect(bucketForKind("delivery_photo")).toBe("pr-attachments");
  });

  it("normalizes legacy spec-35 items (no kind) to phase_photo", () => {
    const item = makeItem() as Extract<QueuedUpload, { kind: "phase_photo" }>;
    const legacy = { ...item, kind: undefined };
    expect(normalizeQueuedUpload(legacy).kind).toBe("phase_photo");
  });

  it("passes modern items through normalization unchanged", () => {
    const item = makeItem({
      kind: "delivery_photo",
      purchaseRequestId: "pr-1",
    } as Partial<QueuedUpload>);
    expect(normalizeQueuedUpload(item)).toEqual(item);
  });

  // Spec 352 — capture affordance rides the queue item. Items persisted before
  // spec 352 carry no captureMethod; IDB is schemaless, so normalize on read.
  // An unknown affordance is "picker".
  it("normalizes a legacy item with no captureMethod to picker (spec 352)", () => {
    const item = makeItem();
    const legacy = { ...item, captureMethod: undefined };
    expect(normalizeQueuedUpload(legacy).captureMethod).toBe("picker");
  });

  it("preserves an item's explicit captureMethod through normalization (spec 352)", () => {
    const item = makeItem({ captureMethod: "library" } as Partial<QueuedUpload>);
    expect(normalizeQueuedUpload(item).captureMethod).toBe("library");
  });

  it("processes a mixed-kind queue, dispatching each item to insertMeta with its kind", async () => {
    const store = new MemoryStore();
    await store.put(makeItem({ enqueuedAtMs: 1 }));
    await store.put(
      makeItem({
        id: "11111111-0000-4000-8000-000000000002",
        kind: "delivery_photo",
        purchaseRequestId: "pr-1",
        enqueuedAtMs: 2,
      } as Partial<QueuedUpload>),
    );

    const kinds: string[] = [];
    const result = await processQueue(
      store,
      deps({
        insertMeta: async (item) => {
          kinds.push(item.kind);
          return { ok: true };
        },
      }),
    );

    expect(kinds).toEqual(["phase_photo", "delivery_photo"]);
    expect(result).toEqual({ sent: 2, remaining: 0 });
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

// Feedback 10a15ebe — a real field upload failure (a project_manager's WP photo)
// recorded only {kind, stage} in telemetry, so a TRANSIENT storage blip (which
// self-healed ~19 min later) was indistinguishable from a 403 or a 413. This maps
// a supabase-js storage error to a COARSE, PDPA-safe diagnosis: a numeric HTTP
// status when present (a status code carries no user data) plus a class. It NEVER
// reads the file name/path; the message is used only to bucket network-vs-authz,
// never stored.
describe("diagnoseStorageFailure (feedback 10a15ebe)", () => {
  it("classifies a transient server error as http_5xx with its status", () => {
    expect(diagnoseStorageFailure({ statusCode: "500", message: "Internal Error" })).toEqual({
      reason: "http_5xx",
      status: 500,
    });
    expect(diagnoseStorageFailure({ statusCode: 503, message: "unavailable" })).toEqual({
      reason: "http_5xx",
      status: 503,
    });
  });

  it("classifies an oversize (413) rejection as size", () => {
    expect(
      diagnoseStorageFailure({
        statusCode: "413",
        message: "The object exceeded the maximum allowed size",
      }),
    ).toEqual({ reason: "size", status: 413 });
  });

  it("classifies a permission failure (401/403) as authz", () => {
    expect(diagnoseStorageFailure({ statusCode: "403", message: "Forbidden" })).toEqual({
      reason: "authz",
      status: 403,
    });
    expect(diagnoseStorageFailure({ statusCode: 401, message: "Unauthorized" })).toEqual({
      reason: "authz",
      status: 401,
    });
  });

  it("classifies a throttle (429) as rate_limited", () => {
    expect(diagnoseStorageFailure({ statusCode: "429", message: "Too Many Requests" })).toEqual({
      reason: "rate_limited",
      status: 429,
    });
  });

  it("classifies other 4xx as http_4xx with its status", () => {
    expect(diagnoseStorageFailure({ statusCode: "400", message: "Bad Request" })).toEqual({
      reason: "http_4xx",
      status: 400,
    });
  });

  it("classifies a fetch/network failure (no status) as network — no status field", () => {
    expect(diagnoseStorageFailure({ message: "Failed to fetch" })).toEqual({ reason: "network" });
    expect(diagnoseStorageFailure({ message: "Load failed" })).toEqual({ reason: "network" });
    expect(diagnoseStorageFailure({ message: "NetworkError when attempting to fetch" })).toEqual({
      reason: "network",
    });
  });

  it("falls back to authz for a statusless message that still reads as a denial", () => {
    // The offline-queue path only keeps error.message (no statusCode) as lastError.
    expect(diagnoseStorageFailure({ message: "403: Forbidden" })).toEqual({ reason: "authz" });
  });

  it("classifies anything else as unknown", () => {
    expect(diagnoseStorageFailure({ message: "weird thing happened" })).toEqual({
      reason: "unknown",
    });
    expect(diagnoseStorageFailure({})).toEqual({ reason: "unknown" });
  });

  it("drops a bogus/out-of-range numeric status and classifies off the message", () => {
    // 0 / out-of-range must not leak a status field nor be treated as an HTTP class.
    expect(diagnoseStorageFailure({ statusCode: 0, message: "Failed to fetch" })).toEqual({
      reason: "network",
    });
    expect(diagnoseStorageFailure({ statusCode: 700, message: "weird" })).toEqual({
      reason: "unknown",
    });
  });
});

describe("isAuthzDenied", () => {
  it("flags a permanent permission failure (RLS / 403 / unauthorized)", () => {
    expect(isAuthzDenied("new row violates row-level security policy for table objects")).toBe(
      true,
    );
    expect(isAuthzDenied("Unauthorized")).toBe(true);
    expect(isAuthzDenied("permission denied for bucket photos")).toBe(true);
    expect(isAuthzDenied("403: Forbidden")).toBe(true);
  });

  it("does not flag transient / offline failures (those really do wait for signal)", () => {
    expect(isAuthzDenied("network down")).toBe(false);
    expect(isAuthzDenied("Failed to fetch")).toBe(false);
    expect(isAuthzDenied("upstream")).toBe(false);
    expect(isAuthzDenied(null)).toBe(false);
    expect(isAuthzDenied(undefined)).toBe(false);
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

// Spec 244 U2b-1 — which queued uploads have PERMANENTLY failed (RLS/403 denial —
// they will never send, unlike a transient offline wait) and warrant one upload_fail
// friction event this session. Pure: the session's already-reported Set is the
// caller's; this only decides. Own-user only (ADR 0039 attribution guard).
describe("pickUploadFailures (spec 244 U2b-1)", () => {
  const none = new Set<string>();

  it("picks own permanently-denied items not yet reported, with their kind and coarse reason", () => {
    const items = [
      makeItem({ id: "d1", lastError: "new row violates row-level security policy" }),
      makeItem({
        id: "d2",
        kind: "delivery_photo",
        purchaseRequestId: "pr-1",
        lastError: "403: Forbidden",
      } as Partial<QueuedUpload>),
    ];
    expect(pickUploadFailures(items, "user-a", none)).toEqual([
      { id: "d1", kind: "phase_photo", reason: "authz", stage: "storage" },
      { id: "d2", kind: "delivery_photo", reason: "authz", stage: "storage" },
    ]);
  });

  it("labels a pairing rejection as the insert stage (bytes landed, metadata blocked)", () => {
    const items = [
      makeItem({
        id: "p1",
        step: "insert",
        lastError: "จับคู่รูปไม่ได้แล้ว — จุดบกพร่องถูกลบหรือรอบงานเปลี่ยน",
      }),
    ];
    expect(pickUploadFailures(items, "user-a", none)).toEqual([
      { id: "p1", kind: "phase_photo", reason: "pairing", stage: "insert" },
    ]);
  });

  it("skips transient / offline failures (those wait for signal, not a give-up)", () => {
    const items = [
      makeItem({ id: "t1", lastError: "network down" }),
      makeItem({ id: "t2", lastError: "Failed to fetch" }),
      makeItem({ id: "t3", lastError: null }),
    ];
    expect(pickUploadFailures(items, "user-a", none)).toEqual([]);
  });

  it("skips ids already reported this session (one event per stuck upload)", () => {
    const items = [makeItem({ id: "d1", lastError: "Unauthorized" })];
    expect(pickUploadFailures(items, "user-a", new Set(["d1"]))).toEqual([]);
  });

  it("skips another user's items (attribution guard, ADR 0039)", () => {
    const items = [makeItem({ id: "d1", userId: "user-b", lastError: "permission denied" })];
    expect(pickUploadFailures(items, "user-a", none)).toEqual([]);
  });

  it("returns nothing when there is no session user", () => {
    const items = [makeItem({ id: "d1", lastError: "Unauthorized" })];
    expect(pickUploadFailures(items, null, none)).toEqual([]);
  });
});

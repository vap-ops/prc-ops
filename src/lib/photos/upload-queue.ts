// Spec 35 / ADR 0039 — offline-tolerant upload queue: the PURE core.
// No IndexedDB, no globals — the store and both pipeline steps are
// injected, so this whole module is unit-testable. The IDB store and
// the runner component are thin browser seams.
//
// Invariants:
//   • An item is removed ONLY after both steps succeed. Items are
//     NEVER auto-dropped — they are evidence; attempts only widen the
//     runner's backoff.
//   • Replay is idempotent end-to-end (bytes 409 ⇒ alreadyExists ⇒
//     advance; metadata 23505 handled inside addPhoto), so overlapping
//     processors are harmless by design.

import type { PhotoExt } from "@/lib/photos/path";
import type { PhotoPhase } from "@/lib/photos/transitions";

export interface QueuedPhoto {
  /** Pre-assigned photo uuid — photo_logs id AND the storage object key. */
  id: string;
  /** Enqueuing user — the runner SKIPS items whose owner is not the
   *  current session (shared-device attribution guard, ADR 0039). */
  userId: string;
  workPackageId: string;
  phase: PhotoPhase;
  ext: PhotoExt;
  /** Prepared bytes (spec 34) — what gets stored, forever. */
  blob: Blob;
  lastModifiedMs: number;
  /** Display label, persisted ahead of need for the manual-discard seam. */
  fileName: string;
  storagePath: string;
  /** Next pipeline step: bytes first, then the addPhoto metadata row. */
  step: "upload" | "insert";
  attempts: number;
  lastError: string | null;
  enqueuedAtMs: number;
}

export interface QueueStore {
  all(): Promise<QueuedPhoto[]>;
  put(item: QueuedPhoto): Promise<void>;
  remove(id: string): Promise<void>;
  count(): Promise<number>;
}

export type UploadBytesResult =
  | { ok: true }
  | { ok: false; alreadyExists: boolean; message: string };

export interface ProcessDeps {
  uploadBytes(item: QueuedPhoto): Promise<UploadBytesResult>;
  insertMeta(item: QueuedPhoto): Promise<{ ok: true } | { ok: false; message: string }>;
  /** The session user, or null when logged out — foreign/ownerless
   *  items are skipped untouched, never processed or dropped. */
  currentUserId: string | null;
}

export interface ProcessResult {
  sent: number;
  remaining: number;
}

export async function processQueue(store: QueueStore, deps: ProcessDeps): Promise<ProcessResult> {
  const items = await store.all();
  let sent = 0;
  let remaining = 0;

  for (const item of items) {
    // Shared-device guard (ADR 0039): only the enqueuing user's session
    // may send their photos — evidence attribution is append-only and
    // can never be corrected after the fact.
    if (deps.currentUserId === null || item.userId !== deps.currentUserId) {
      remaining += 1;
      continue;
    }

    let current = item;

    if (current.step === "upload") {
      const uploaded = await deps.uploadBytes(current);
      if (!uploaded.ok && !uploaded.alreadyExists) {
        await store.put({
          ...current,
          attempts: current.attempts + 1,
          lastError: uploaded.message,
        });
        remaining += 1;
        continue;
      }
      // Bytes are in Storage (fresh upload or an earlier pass's) —
      // persist the step advance so a crash here never re-uploads.
      current = { ...current, step: "insert" };
      await store.put(current);
    }

    const inserted = await deps.insertMeta(current);
    if (!inserted.ok) {
      await store.put({
        ...current,
        attempts: current.attempts + 1,
        lastError: inserted.message,
      });
      remaining += 1;
      continue;
    }

    await store.remove(current.id);
    sent += 1;
  }

  return { sent, remaining };
}

// Supabase Storage upsert:false replay shape: 409 / "already exists" /
// "Duplicate" means the object IS there under our uuid-keyed path — by
// construction it is our bytes, so the step is done.
export function classifyStorageUploadError(error: {
  statusCode?: string | number | undefined;
  message?: string | undefined;
}): { alreadyExists: boolean } {
  const status = String(error.statusCode ?? "");
  const message = (error.message ?? "").toLowerCase();
  return {
    alreadyExists:
      status === "409" || message.includes("already exists") || message.includes("duplicate"),
  };
}

// Timestamp source for queue ordering — lives here (not in component
// scope) so the React Compiler's purity lint sees a plain lib call.
export function queueNowMs(): number {
  return Date.now();
}

const BACKOFF_BASE_MS = 5_000;
const BACKOFF_CAP_MS = 300_000;

export function backoffMs(attempts: number): number {
  return Math.min(BACKOFF_BASE_MS * 2 ** attempts, BACKOFF_CAP_MS);
}

// The runner sleeps until the most-ready item's backoff elapses.
// null = queue empty, nothing to schedule.
export function nextPassDelayMs(items: ReadonlyArray<QueuedPhoto>): number | null {
  if (items.length === 0) return null;
  return Math.min(...items.map((item) => backoffMs(item.attempts)));
}

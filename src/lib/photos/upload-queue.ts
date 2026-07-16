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
import { PHOTOS_BUCKET, PR_ATTACHMENTS_BUCKET } from "@/lib/storage/buckets";

export type QueuedUploadKind = "phase_photo" | "reference_attachment" | "delivery_photo";

interface QueuedUploadBase {
  /** Pre-assigned uuid — the metadata row id AND the storage object key. */
  id: string;
  /** Enqueuing user — the runner SKIPS items whose owner is not the
   *  current session (shared-device attribution guard, ADR 0039). */
  userId: string;
  ext: PhotoExt;
  /** Prepared bytes (spec 34) — what gets stored, forever. */
  blob: Blob;
  lastModifiedMs: number;
  /** Display label for the discard list. */
  fileName: string;
  storagePath: string;
  /** Next pipeline step: bytes first, then the metadata action. */
  step: "upload" | "insert";
  attempts: number;
  lastError: string | null;
  enqueuedAtMs: number;
}

// Spec 37: one queue, three photo kinds — the metadata action and the
// bucket follow the kind; everything else (steps, attempts, idempotent
// replay) is shared.
export type QueuedUpload =
  | (QueuedUploadBase & {
      kind: "phase_photo";
      workPackageId: string;
      phase: PhotoPhase;
      // Spec 248 U3 — a paired after_fix answer carries its defect-photo target
      // through the offline queue, or replay would silently drop the pairing.
      answersPhotoId?: string | null;
    })
  | (QueuedUploadBase & { kind: "reference_attachment"; purchaseRequestId: string })
  | (QueuedUploadBase & { kind: "delivery_photo"; purchaseRequestId: string });

export function bucketForKind(kind: QueuedUploadKind): "photos" | "pr-attachments" {
  return kind === "phase_photo" ? PHOTOS_BUCKET : PR_ATTACHMENTS_BUCKET;
}

// Items persisted by spec 35 predate `kind` — IDB is schemaless, so no
// version bump: normalize on read. A kind-less item can only be a
// phase photo (the only kind that existed).
export function normalizeQueuedUpload(
  raw:
    | QueuedUpload
    | (Omit<Extract<QueuedUpload, { kind: "phase_photo" }>, "kind"> & { kind?: undefined }),
): QueuedUpload {
  if (raw.kind === undefined) {
    return { ...raw, kind: "phase_photo" };
  }
  return raw;
}

export interface QueueStore {
  all(): Promise<QueuedUpload[]>;
  put(item: QueuedUpload): Promise<void>;
  remove(id: string): Promise<void>;
  /** Existence check — processQueue consults it before every put-back
   *  so a discard during an in-flight pass can never resurrect the
   *  item (spec 37 discard race). */
  has(id: string): Promise<boolean>;
  count(): Promise<number>;
}

export type UploadBytesResult =
  | { ok: true }
  | { ok: false; alreadyExists: boolean; message: string };

export interface ProcessDeps {
  uploadBytes(item: QueuedUpload): Promise<UploadBytesResult>;
  insertMeta(item: QueuedUpload): Promise<{ ok: true } | { ok: false; message: string }>;
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

    // Discard race (spec 37): the snapshot above may be stale — an item
    // the user discarded must never be processed or put back.
    if (!(await store.has(item.id))) continue;

    let current = item;

    if (current.step === "upload") {
      const uploaded = await deps.uploadBytes(current);
      if (!uploaded.ok && !uploaded.alreadyExists) {
        if (await store.has(current.id)) {
          await store.put({
            ...current,
            attempts: current.attempts + 1,
            lastError: uploaded.message,
          });
          remaining += 1;
        }
        continue;
      }
      // Bytes are in Storage (fresh upload or an earlier pass's) —
      // persist the step advance so a crash here never re-uploads.
      // A discard during the upload stops here (bucket orphan accepted,
      // photos precedent).
      if (!(await store.has(current.id))) continue;
      current = { ...current, step: "insert" };
      await store.put(current);
    }

    const inserted = await deps.insertMeta(current);
    if (!inserted.ok) {
      if (await store.has(current.id)) {
        await store.put({
          ...current,
          attempts: current.attempts + 1,
          lastError: inserted.message,
        });
        remaining += 1;
      }
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

// Feedback 10a15ebe — a project_manager's WP photo upload failed with a "ลองใหม่"
// loop; investigation found the failure was a TRANSIENT storage blip that the
// offline queue recovered from ~19 min later, but the friction signal recorded only
// {kind, stage}, so a transient could not be told apart from a 403 or a 413. This
// classifies a storage error into a COARSE, PDPA-safe diagnosis: a numeric HTTP
// status when the failure was an HTTP response (a status code is not user data)
// plus a class. It NEVER reads the file name/path/content; error.message is used
// only to bucket network-vs-authz and is never returned or stored.
// The coarse classes diagnoseStorageFailure produces from a storage error.
export type StorageFailureReason =
  | "http_5xx"
  | "http_4xx"
  | "authz"
  | "size"
  | "rate_limited"
  | "network"
  | "unknown";

// The full upload_fail reason vocabulary across every pipeline stage: the storage
// classes above, plus the insert/queue-stage classes emitted by the capture engine.
// (trackFriction context is untyped, so this documents the vocabulary for a future
// typed consumer rather than enforcing it.)
export type UploadFailureReason =
  | StorageFailureReason
  | "pairing"
  | "insert_rejected"
  | "exception";

export interface UploadFailureDiagnosis {
  reason: StorageFailureReason;
  /** Numeric HTTP status, present only for an HTTP-response failure. Absent for a
   *  fetch/network failure or an unknown shape. PDPA-safe (carries no user data). */
  status?: number;
}

function normalizeHttpStatus(statusCode: string | number | undefined): number | undefined {
  const n =
    typeof statusCode === "number"
      ? statusCode
      : typeof statusCode === "string"
        ? Number.parseInt(statusCode, 10)
        : Number.NaN;
  // A real HTTP status only — drops 0/NaN/out-of-range (e.g. a bogus 700), which
  // then fall through to the message-based classification.
  return Number.isFinite(n) && n >= 100 && n < 600 ? n : undefined;
}

// The common cross-browser "the fetch itself failed" messages (Chrome: "Failed to
// fetch"; Safari: "Load failed"; Firefox: "NetworkError when attempting to fetch").
// supabase-js wraps a network failure of the direct-to-Storage upload as a
// StorageUnknownError with one of these messages and no statusCode.
function isNetworkFailureMessage(message: string | null | undefined): boolean {
  if (!message) return false;
  return /failed to fetch|load failed|networkerror|network request failed|network error/i.test(
    message,
  );
}

export function diagnoseStorageFailure(error: {
  statusCode?: string | number | undefined;
  message?: string | undefined;
}): UploadFailureDiagnosis {
  const status = normalizeHttpStatus(error.statusCode);
  if (status !== undefined) {
    if (status === 413) return { reason: "size", status };
    if (status === 429) return { reason: "rate_limited", status };
    if (status === 401 || status === 403) return { reason: "authz", status };
    if (status >= 500) return { reason: "http_5xx", status };
    if (status >= 400) return { reason: "http_4xx", status };
  }
  // No HTTP status → a statusless denial, a fetch/network failure, or unknown.
  // Check authz first so this stays consistent with isPermanentUploadFailure (a
  // message carrying both a denial phrase and a network phrase reads as authz).
  if (isAuthzDenied(error.message)) return { reason: "authz" };
  if (isNetworkFailureMessage(error.message)) return { reason: "network" };
  return { reason: "unknown" };
}

// A PERMANENT permission failure (RLS denial / 403), as opposed to a transient or
// offline one. The queue keeps the item either way (evidence is never auto-dropped),
// but the banner must tell the truth: a denied upload is NOT "waiting for signal" —
// it will never send until the permission changes, so the UI says "สิทธิ์ไม่พอ"
// instead. Works off the stored error message (the only failure signal the queue
// keeps); a Supabase storage RLS denial reads "new row violates row-level security
// policy", a 403 reads "Unauthorized" / "Forbidden".
export function isAuthzDenied(message: string | null | undefined): boolean {
  if (!message) return false;
  return /row-level security|unauthorized|not authorized|permission denied|forbidden|\b403\b/i.test(
    message,
  );
}

// Spec 248 U3 — the pairing-rejection terminal error. A queued paired answer
// whose defect target was removed (or whose round closed before replay) is
// PERMANENTLY uninsertable: the U1 guard trigger raises 23514 on every
// attempt. addPhoto returns this exact message so the queue can classify the
// item honestly instead of hot-retrying a dead insert forever.
export const PAIRING_REJECTED_MESSAGE =
  "จับคู่รูปไม่ได้แล้ว — จุดบกพร่องถูกลบหรือรอบงานเปลี่ยน ลบรูปนี้แล้วถ่ายรูปใหม่จากช่องจับคู่";

export function isPairingRejected(message: string | null | undefined): boolean {
  return !!message && message.includes("จับคู่รูปไม่ได้แล้ว");
}

/** A failure retrying can never fix — authz denial or pairing rejection. The
 *  queue keeps the item either way (evidence is never auto-dropped); this
 *  only drives honest banner copy + one-shot friction reporting. */
export function isPermanentUploadFailure(message: string | null | undefined): boolean {
  return isAuthzDenied(message) || isPairingRejected(message);
}

// Spec 244 U2b-1 — which queued uploads have PERMANENTLY failed (an RLS/403 denial:
// they will never send, unlike a transient offline wait that the queue legitimately
// retries) and have not yet been reported this session. The runner emits ONE
// `upload_fail` friction event per id so a stuck upload surfaces once — not on every
// retry pass — feeding the who-needs-help + UX-friction reads (U3/U4). Own-user only
// (ADR 0039 attribution guard: never attribute another user's stuck upload to this
// session). Pure — the caller owns the already-reported Set; this only decides.
export function pickUploadFailures(
  items: ReadonlyArray<Pick<QueuedUpload, "id" | "kind" | "lastError" | "userId" | "step">>,
  currentUserId: string | null,
  reported: ReadonlySet<string>,
): {
  id: string;
  kind: QueuedUploadKind;
  reason: UploadFailureReason;
  stage: "storage" | "insert";
}[] {
  if (!currentUserId) return [];
  return items
    .filter(
      (item) =>
        item.userId === currentUserId &&
        isPermanentUploadFailure(item.lastError) &&
        !reported.has(item.id),
    )
    .map((item) => ({
      id: item.id,
      kind: item.kind,
      reason: queuedFailureReason(item.lastError),
      // The stage is exactly the pipeline step the item is stuck on (a pairing
      // rejection fails at the metadata insert, an RLS denial at the byte upload).
      stage: item.step === "insert" ? "insert" : "storage",
    }));
}

// The coarse reason for a queued item that has PERMANENTLY failed — feedback
// 10a15ebe. The queue keeps only error.message as lastError (no statusCode), so
// derive off the message. Pairing rejection is its own terminal class; otherwise
// fall through to the storage-error diagnosis (which reads authz off the message).
export function queuedFailureReason(message: string | null | undefined): UploadFailureReason {
  if (isPairingRejected(message)) return "pairing";
  return diagnoseStorageFailure({ message: message ?? undefined }).reason;
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
export function nextPassDelayMs(items: ReadonlyArray<QueuedUpload>): number | null {
  if (items.length === 0) return null;
  return Math.min(...items.map((item) => backoffMs(item.attempts)));
}

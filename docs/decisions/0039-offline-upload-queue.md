# ADR 0039 — Offline-tolerant photo upload queue (phase photos)

**Status:** Accepted — 2026-06-12. Spec 35. Architecture-revision §3.6
Phase 2; the spec-34 downscale sequel. Scope: WP phase photos (the
evidence-critical path); reference/delivery photos are a recorded seam.

## Context

Site signal is unreliable. Today a phase photo lives only in React
state while uploading — a failed upload plus a navigation, tab close,
or crash loses it (retake or lost evidence). The PWA's service worker
is deliberately network-only (spec 18) and iOS has no Background Sync,
so a SW-based queue would exclude iPhone users entirely.

## Decision

### Persistence — IndexedDB, app-level (no service-worker dependency)

Every selected phase photo is written to an IndexedDB queue
(`prc-ops` / `photo-upload-queue`, keyPath `id` = the pre-assigned
photo uuid) at selection time — prepared blob (spec 34), storage path,
phase, `lastModifiedMs`, step, attempts — and removed only when both
pipeline steps (bytes upload + `addPhoto` metadata insert) have
succeeded. The queue survives tab close, crash, and navigation on both
Android and iOS. No new dependencies (raw IDB, thin promisified
wrapper).

### Replay is IDEMPOTENT — double-processing is harmless by design

The same item may be processed twice (the live uploader and the
background runner, or two tabs). Instead of distributed locking,
every step tolerates "already done":

- **Bytes:** Storage `upsert:false` returns 409/"already exists" on
  replay → classified as success (the object IS there; paths are
  uuid-keyed so a duplicate is always OUR bytes).
- **Metadata:** `addPhoto` gains idempotent replay — on insert error
  `23505` it verifies a `photo_logs` row with that id exists (caller
  RLS) and proceeds as success, including the (already-guarded)
  pending_approval transition check. This amends the action, not the
  append-only posture: replaying never UPDATEs anything.

`navigator.locks` (where available, `ifAvailable`) still prevents
concurrent runner passes as an optimization, not a correctness
requirement.

### Processing — live path unchanged + background runner for leftovers

- The phase-uploader keeps its exact current UX (tiles, statuses,
  retry); it now brackets its pipeline with queue put/remove.
- A global `UploadQueueRunner` (root layout, renders a small fixed
  banner only when the queue is non-empty: รอส่งรูป N รูป) drains
  leftovers: on mount (app launch resume), on `online`, on
  `visibilitychange`, on a custom queue-changed event, and on a
  capped exponential backoff (5 s · 2^attempts, max 5 min) while items
  remain.
- **Items are NEVER auto-dropped** — they are evidence. Attempts only
  widen backoff. (A manual discard affordance is a recorded seam.)
- Pure core (`processQueue(store, deps)`, error classification,
  backoff math) is unit-tested against an in-memory store; IDB and the
  runner are thin browser seams.

### Rejected

- **Service-worker Background Sync** — iOS-excluding; SW stays
  network-only (spec 18 stance). Revisit only if Android-only
  background flushing ever matters.
- **Replacing the uploader UX with a queue-only flow** — the live
  pipeline is good UX on good signal; the queue is a safety net, not a
  rewrite.
- **Auto-expiry of stuck items** — silent evidence loss; never.

## Consequences

- Login state: the runner runs on every page incl. `/login`; with an
  empty queue it does one IDB count and exits. Queued items with a
  dead session fail their insert step and back off — they send after
  the next login (the photo outlives the session, which is the point).
- Multi-tab and live/runner overlap resolve through idempotency (no
  duplicate rows, no duplicate objects possible).
- `capturedAtClient` survives replay via the persisted
  `lastModifiedMs`.
- **Shared-device attribution (review finding, amended in-build):**
  queue items carry the enqueuing `userId`; the runner SKIPS items
  whose owner is not the current session user (`photo_logs.uploaded_by`
  is append-only evidence — misattribution could never be corrected).
  A user's queued photos send after THEIR next login. Tradeoff
  recorded: queued blobs persist unencrypted in IndexedDB on a shared
  device until the owner returns (or the manual-discard seam ships) —
  same exposure class as the browser's own cache on a shared device.
- **Replay verify is identity-complete:** addPhoto's 23505 path
  requires the existing row to match WP + phase + canonical storage
  path, not merely the id — a forged replay with a foreign photo id
  cannot return ok or ride the pending_approval transition.
- Queue I/O failures (quota, private-mode IDB) are non-fatal to the
  live pipeline by construction — the safety net never breaks the
  thing it protects.
- Recorded seams: Web-Worker downscale offload, SW Background Sync
  enhancement. (Reference/delivery queueing + the manual discard UI
  shipped in spec 37; the reference-photo window closes when the
  parent PR is decided — landed replays confirm ok, never-landed items
  are discard-only, recorded there.)

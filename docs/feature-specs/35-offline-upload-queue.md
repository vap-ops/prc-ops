# Spec 35 — Offline-tolerant upload queue (WP phase photos)

**Status:** locked — 2026-06-12. ADR 0039 (binding design).

## 0. Locked design

A phase photo selected on site is never lost: it persists to an
IndexedDB queue at selection, uploads live exactly as today when
signal allows, and otherwise auto-sends when connectivity returns or
on next app open. Replay is idempotent end-to-end (bytes 409 ⇒ done;
metadata 23505 ⇒ verify-and-done), so the live path, the background
runner, and multiple tabs can overlap harmlessly. No service-worker
changes; works on iOS and Android alike.

## 1. Scope

**In:**

- `src/lib/photos/upload-queue.ts` (pure, test-first): `QueuedPhoto`,
  `QueueStore` interface, `classifyStorageUploadError` (409/"already
  exists" ⇒ alreadyExists), `backoffMs` (5 s · 2^attempts, cap 5 min),
  `nextPassDelayMs`, `processQueue(store, deps)` — per item: step
  `upload` → bytes (alreadyExists advances) → step `insert` →
  metadata → remove on success; failures persist attempts/lastError;
  **no auto-drop ever**.
- `src/lib/photos/upload-queue-idb.ts` (browser seam): raw-IDB
  `QueueStore` impl (`prc-ops`/`photo-upload-queue`, keyPath `id`).
- `UploadQueueRunner` (root layout): drains on mount / `online` /
  `visibilitychange` / `prc:upload-queue-changed` / backoff timer;
  `navigator.locks` `ifAvailable` guard (optimization only); renders
  the fixed banner รอส่งรูป N รูป… only when count > 0;
  `router.refresh()` after a pass that sent items.
- phase-uploader: brackets its existing pipeline — queue `put` at
  selection (after spec-34 prepare), `remove` after insert success;
  fires the queue-changed event on failure so the runner inherits the
  item. UX (tiles/statuses/retry copy) byte-unchanged.
- `addPhoto`: idempotent replay — insert error `23505` ⇒ verify the
  `photo_logs` row exists (caller RLS, same id) ⇒ proceed as success
  (transition guard already re-checks WP status).

**Out (recorded seams):** reference/delivery photo queueing, manual
discard UI for stuck items, SW Background Sync, Web-Worker downscale,
queue inspection/admin UI.

## 2. Verification checklist

- [ ] RED→GREEN: processQueue / classify / backoff unit tests first
      (MemoryStore + stubbed deps; IDB and runner are browser seams —
      review + operator phone pass, house posture).
- [ ] `pnpm lint && pnpm typecheck && pnpm test` green; e2e green.
- [ ] addPhoto 23505 path covered by a unit test of the extracted
      classification seam OR verified-by-checklist with the pgTAP-side
      invariants unchanged (no schema diff this unit).
- [ ] No diff under `supabase/`.
- [ ] Operator phone pass (acceptance): airplane mode → take a phase
      photo → banner shows รอส่งรูป 1 รูป → close the browser → signal
      back on → reopen app → photo appears on the WP within seconds.

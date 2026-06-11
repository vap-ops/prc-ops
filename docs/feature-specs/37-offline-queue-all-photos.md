# Spec 37 — Offline queue for all photo kinds + manual discard

**Status:** locked — 2026-06-12. Closes the two ADR 0039 seams:
reference/delivery photo queueing and the stuck-item discard UI.

## 0. Locked design

`QueuedPhoto` generalizes to a discriminated `QueuedUpload`
(`phase_photo | reference_attachment | delivery_photo`); the bucket and
the metadata action follow the kind. The pure core (`processQueue`)
stays kind-agnostic — only the runner's `insertMeta` dispatches.
Items already persisted by spec 35 carry no `kind`; the IDB store
normalizes them to `phase_photo` on read (no DB version bump — IDB is
schemaless). Both attachment actions gain the spec-35
identity-complete 23505 replay (id + parent + kind + purpose +
canonical path). The runner banner becomes a details-expander: each
waiting item shows its name + last error and a ลบ (confirm) discard —
the only way an item ever leaves the queue without landing.

## 1. Scope

**In:**

- `upload-queue.ts`: `QueuedUpload` union (+ `bucketForKind`), legacy
  normalization helper, core untouched otherwise (test additions pin
  mixed-kind passes + normalization).
- `upload-queue-idb.ts`: normalize-on-read.
- Runner: per-kind `insertMeta` dispatch (addPhoto /
  addPurchaseRequestAttachment image+reference /
  addDeliveryConfirmationPhoto); banner → expander with per-item
  discard (window.confirm, ลบรูปที่ค้างอยู่?).
- `addPurchaseRequestAttachment` (image branch) +
  `addDeliveryConfirmationPhoto`: 23505 ⇒ verify id + parent + kind +
  purpose + storage_path under caller RLS ⇒ success.
- Stager + DeliveryPhotoUploader: queue brackets (put at selection /
  after prepare, step-advance after bytes, remove + notify after
  action success), mirroring phase-uploader; failure paths
  notifyQueueChanged; queue I/O non-fatal (safe wrappers).

**Out (recorded seams):** link attachments (no bytes — failures are
instant and retryable in place), Web-Worker downscale, SW Background
Sync, queue admin/inspection beyond the discard list.

**Recorded behaviors (adversarial-review amendments):**

- **The reference-photo offline window closes at decision time.** A
  queued reference photo whose parent PR got approved/rejected while
  offline can never attach (RLS pins reference inserts to
  status='requested'); a replay whose insert LANDED before the
  decision still confirms ok (identity-complete read in the action).
  For never-landed items, discard is the designed out.
- **Discard vs in-flight send:** the core skips every put-back for a
  discarded item (`QueueStore.has` re-checks, pinned by unit test),
  but a request already on the wire may still complete — the confirm
  copy promises deletion of the _un-sent_ item, nothing more.
- **Foreign items are read-only in the discard list** (ADR 0039: other
  users' un-sent evidence) — shown without fileName or ลบ.
- Discard UI verification posture: manual (operator phone pass) — the
  IDB/DOM seam carries no jsdom component test; the race-protection
  core IS unit-tested.

## 2. Verification checklist

- [ ] RED→GREEN: core tests for mixed kinds + legacy normalization
      first; suites green (unit/e2e); no `supabase/` diff.
- [ ] Both attachment actions' replay verify is identity-complete
      (spec-35 review lesson — no foreign-id claim possible).
- [ ] Discard removes from IDB + recounts; confirm-guarded.
- [ ] Operator phone pass: airplane-mode delivery photo on an
      on_route request → banner → reopen with signal → photo lands and
      completes the delivery (the ADR 0030 trigger chain still fires —
      replay produces the SAME insert the live path would).

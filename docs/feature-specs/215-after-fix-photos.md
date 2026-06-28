# 215 — After-fix photos (หลังแก้ไข)

Status: IN PROGRESS — design confirmed with the operator 2026-06-28.
Relates: spec 144 (defect rework), spec 54/65 (photo phases + progress bar),
spec 03 (photo-driven status transition), feedback `0fa23307`. Doctrine: Field-First.

## Why

Feedback `0fa23307` (project_director, on the WP detail page): "เพิ่มรูปงานหลังดำเนิน
การแก้ไขแล้วเสร็จ" — capture photos of the completed fix when a WP's **rework**
(defect correction) is done.

Spec 144's rework loop is `complete → rework → (re-capture an "แล้วเสร็จ"/after
photo) → pending_approval → complete`. So a post-fix photo is **already capturable**
today — but as a plain `after` photo, **indistinguishable from the original work
photos** in the same แล้วเสร็จ gallery. The gap is the distinction.

## Design decision (operator-chosen 2026-06-28)

Asked to choose between (a) auto-distinguish post-reopen `after` photos, (b) a new
explicit phase, or (c) discoverability-only, the operator chose **(b) a new explicit
phase**: a 4th photo phase `after_fix` (หลังแก้ไข) with its own capture bucket +
gallery. Explicit and user-controlled.

Key design constraints:

- `after_fix` is a **rework addendum, NOT part of the 3-step lifecycle progress
  bar** (`PHASE_ORDER` stays `before → during → after`). It is a 4th display/capture
  bucket only — so a never-reworked WP's progress bar is unchanged.
- It **triggers the rework→approval transition** like `after`
  (`shouldTransitionToPendingApproval`), so capturing it on a งานแก้ไข WP closes the
  rework loop (rework → pending_approval).
- In the capture-zone tile switcher it is **always available** (no sequential lock —
  it's not a "future" phase) and is never the auto-derived "current" phase.

## Schema (additive enum-add — held by the danger-path guard)

`alter type public.photo_phase add value 'after_fix' after 'after'` — its OWN
migration (Postgres requires the value be committed before use; the machinery_tools
item_category add is the precedent). `pnpm db:types` regenerates `PhotoPhase`.

## Totality updates (same held PR — they depend on the regenerated enum)

- `PHOTO_PHASE_LABEL` += `after_fix: "หลังแก้ไข"`.
- `PHASES` (display/capture list) += the after_fix entry (galleries + capture tiles
  iterate this).
- `CurrentPhotosByPhase` + `selectCurrentPhotosByPhase` += an `after_fix` bucket;
  `load-detail.ts` adopts the canonical `CurrentPhotosByPhase` type + spreads
  after_fix into `allPhotos` (name/URL resolution); both WP-detail + review page
  count literals add the key.
- `addPhoto` validation array (`PHOTO_PHASES`) += `after_fix`.
- `shouldTransitionToPendingApproval` fires on `after` **or** `after_fix`.
- capture tile grid → 2×2; the `after_fix` tile is lock-free + never "current".
- pgTAP `09-photo-logs` enum pin → four values.

## Verification

- `pnpm db:test` — pgTAP 09 enum pin = four values.
- `pnpm lint && pnpm typecheck && pnpm test` — phase/transition/grouping/label unit
  tests updated; new: after_fix transition (rework→approval), after_fix grouping,
  progress ignores after_fix, the capture tile renders + is tappable.
- Manual: reopen a complete WP for a defect → on the WP detail, the หลังแก้ไข tile +
  gallery appear; capturing into it moves the WP to รออนุมัติ.

## Open questions / deferred

- Pre-selecting the หลังแก้ไข tile automatically when the WP is in rework (zero-tap) —
  a small follow-up; v1 leaves it user-tapped.
- After-fix photos in the PDF report — the report doesn't print phase attribution
  today; out of scope here.

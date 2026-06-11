# Spec 15 — Purchasing visibility + review ergonomics (iteration 2 of the whole-app upgrade)

**Status:** Locked 2026-06-11 — iteration 2 under the operator's standing
chat brief (UX not intuitive / AppSheet is the back office / Thai users →
Thai UI; "Upgrade the system as a whole, design a better version each
time"). Scope drawn from spec 14's recorded iteration-2 queue. UI layer
only — **no DB, RLS, enum, route, or redirect change.**

## Problem

The purchasing loop is write-only from the requester's seat. A rejection
**always** carries a PM comment (`pr_reject_has_comment` CHECK), and the
AppSheet back office writes purchase/delivery facts (`purchased_at`,
`supplier`, `delivered_at`, `received_by`, `delivery_note`) onto the same
row — but `/requests` renders none of it. The requester sees a pill flip
to ไม่อนุมัติ with no reason, or สั่งซื้อแล้ว with no date. The data is
already readable under the own-row SELECT policy (ADR 0022); it is
display that is missing.

Review surfaces have ergonomic gaps: the PM queue is ordered by WP code
(not wait time, the queue's actual semantics); `/pm/requests` fetches
`requested_at` but never shows it; review photos render as small
non-enlargeable thumbnails; every data route renders a blank screen
while server queries run; a Storage upload failure surfaces raw English
from the Supabase SDK; and a root-layout throw still reaches Next.js's
built-in English page (`error.tsx` does not cover the root layout).

## Scope

### A. Requester feedback loop on `/requests`

The my-requests query adds `decision_comment, decided_at, purchased_at,
supplier, delivered_at, received_by, delivery_note` (read-only; columns
already admitted by the own-row SELECT policy). Each row renders:

- ขอเมื่อ `formatThaiDateTime(requested_at)` — every row.
- `rejected` → red-tinted block: เหตุผลที่ไม่อนุมัติ + the PM's
  `decision_comment`, plus พิจารณาเมื่อ `decided_at` when present.
- `approved` → meta line อนุมัติเมื่อ `decided_at` (when present).
- `purchased` / `delivered` → meta line สั่งซื้อเมื่อ `purchased_at`
  (+ ` · ผู้ขาย {supplier}` when present).
- `delivered` → meta line ได้รับของเมื่อ `delivered_at`
  (+ ` · ผู้รับของ {received_by}` when present) and, when present,
  `delivery_note` as a plain note line.
- `amount` is **not** displayed (money-visibility policy not decided;
  recorded as an open question, not silently shipped).

All timestamps via `formatThaiDateTime`. Null facts simply don't render
(AppSheet fills them later; rows must look correct at every lifecycle
stage).

### B. Wait-time context on `/pm/requests`

Each queue row shows ขอเมื่อ `formatThaiDateTime(requested_at)` on the
requester meta line (the field is already fetched; ordering is already
oldest-first — unchanged).

### C. `/pm` queue ordered by wait time

The pending-approval query orders by `updated_at` ascending (the row's
status flip to `pending_approval` is the last app write to a queued WP,
so `updated_at` marks queue entry), with `code` as deterministic
tiebreak. Each row adds a meta line เข้าคิวเมื่อ
`formatThaiDateTime(updated_at)`. No schema change — this is the
recorded iteration-2 "queue ordering by wait time" item.

### D. Photo tap-to-enlarge (lightbox)

New `src/components/features/photo-lightbox.tsx` — `'use client'`
(justification: owns open/close state + document-level Escape listener).
`ZoomablePhoto({ src })`: button-wrapped thumbnail (aria-label ดูรูปขยาย)
opening a full-screen overlay (`role="dialog"`, `aria-modal`, photo
`object-contain` at ≤92vh/95vw). Closes on backdrop click, ปิด button,
or Escape; clicking the enlarged photo does not close. No portal — no
transformed ancestors exist on the consuming screens, so `fixed`
positioning escapes the `overflow-hidden` thumbnails.

Consumers: the PM review `PhaseGallery` thumbnails and the SA
`phase-uploader` `Thumbnail` (remove button overlay retained on top).

### E. `loading.tsx` skeletons

New presentational `src/components/features/page-skeleton.tsx` (server
component; header strip + section label + 4 pulsing list rows on the
zinc-950 ground, sr-only กำลังโหลด…). One `loading.tsx` per data route:
`/sa`, `/sa/projects/[projectId]`,
`/sa/projects/[projectId]/work-packages/[workPackageId]`, `/pm`,
`/pm/requests`, `/pm/projects`, `/pm/projects/[projectId]/reports`,
`/pm/work-packages/[workPackageId]`, `/requests` — each rendering the
shared skeleton.

### F. Fixed-Thai Storage upload error

`phase-uploader.tsx` `uploadOne`: the tile shows the fixed string
อัปโหลดไม่สำเร็จ กรุณาลองใหม่อีกครั้ง; the raw SDK message goes to
`console.error` only. Closes the spec-14 carve-out (raw English could
reach the tile).

### G. Root-layout error boundary

New `src/app/global-error.tsx` (`'use client'` + own `<html lang="th">`/
`<body>` per Next.js requirements; inline styles — the root layout's
font variables are unavailable when it renders). Same copy family as
`error.tsx`: เกิดข้อผิดพลาด / ลองใหม่.

### H. Centralized purchase-status pill

`purchaseRequestStatusPillClasses` moves into `src/lib/status-colors.ts`
(same exhaustive-switch + defensive-fallback shape as the existing two
helpers; palette identical to the inline map it replaces: requested
zinc / approved emerald / rejected red — red slot added as a named
constant — / purchased amber / delivered emerald). `/requests` imports
it; the page-local map is deleted. This removes the last inline pill
map in `src/`.

## Out of scope (iteration 3+ queue)

Shared app-header component refactor (the three-pattern split — visual
language is already consistent; the refactor is structural and deserves
its own diff); palette/theme identity + outdoor light theme (operator
should see/choose); PWA manifest + icons (needs icon assets); themed
confirm dialogs/toasts replacing `window.confirm`; progressive
disclosure on `/pm/requests`; super_admin hub as a real route; `amount`
display policy on `/requests`; docs refresh unit (v2-handoff / README);
any DB/RLS/enum/migration change; worker/PDF changes.

## Tests (failing first)

- `tests/unit/status-colors.test.ts` — extend with
  `purchaseRequestStatusPillClasses`: exhaustive over
  `Constants.public.Enums.purchase_request_status`, non-empty, unknown
  fallback, palette pins (rejected→red, purchased→amber,
  delivered/approved→emerald, requested→zinc).
- `tests/unit/photo-lightbox.test.tsx` — trigger renders thumbnail +
  aria-label; click opens dialog with full image; closes on Escape, on
  ปิด, on backdrop; clicking the enlarged image keeps it open.

A–C and E–G are server-rendered display/query and presentational
changes verified by lint/typecheck/build + the checklist below (same
posture as spec 14's screen copy).

## Verification checklist

- [ ] New tests RED before the helpers/component exist, GREEN after.
- [ ] `pnpm lint && pnpm typecheck && pnpm test` pass.
- [ ] `pnpm build` passes; every route still builds; the nine
      `loading.tsx` files compile.
- [ ] `pnpm test:e2e` passes (no asserted copy changed).
- [ ] No diff under `supabase/`, `worker/`; no enum/route/redirect
      change; queue ordering is the only query-order change.
- [ ] Locked behaviors intact: pinned-form modes (spec 10), back-nav
      targets (spec 12), group-header semantics (spec 11),
      progress-from-unfiltered, avatar precedence, getClaims
      render-path checks (ADR 0021).
- [ ] `/requests` rows render correctly at every lifecycle stage with
      null facts (no "Invalid Date", no empty labels).

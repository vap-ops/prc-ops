# Spec 278 — SA cockpit: the project ⇄ WP ⇄ photo loop

## Why (telemetry, 2026-07-08)

`interaction_events` (spec 244) + activity tables show the site_admin's real behaviour, not the assumed one:

- The SA home `/sa` is a **3×/week** page. The real home is **`/projects/:id`** (282 views / 111 sessions across field SAs); 46 of อนัญญา's 67 sessions START there, deep-linking past `/sa`.
- The whole SA workflow is one loop: **`/projects/:id` ⇄ WP detail** (85 + 82 in-session transitions).
- The SA's ONLY real app activity is **photographing WPs** — `photo_logs` 340 SA-created / 696 total in 14 days.
- The features earlier specs made the centrepiece are **unadopted**: `labor_logs` = **0 rows all-time**, `daily_work_plans` = **1 all-time**. Store receiving + purchase-requests are back-office (SA ≈ 0).

Operator direction ("BLEND", 2026-07-08): design for what SAs DO (photos, in the project→WP loop) AND keep **attendance** as the one deliberate adoption bet (payroll + spec 266/271 need labor data) — relocated to where SAs already are. Demote the daily-plan / muster / store from the SA surface. See memory `sa-real-usage-photos-2026-07`.

This spec optimises the real loop. It does not throw away spec-277 P0 — the camera FAB + category letter-codes carry forward; the muster/แผนวันนี้ centrepiece retires.

## Units

### U1 — "งานถัดไป" walk (this unit; code-only)

Kill the ping-pong: today, after shooting a WP the SA must back out to the list and tap the next WP. Add prev/next WP navigation on the WP detail so they walk the work linearly. The sibling WPs are NOT currently loaded for site_admin (`loadPlanner` is planner-only), so U1 adds its own read.

- **Walk sequence** = the project's leaf WPs (`is_group = false`) whose status is **not `complete`**, PLUS the current WP (so you can step off a just-completed one), **ordered by `code`** (matches the list's default code order). Lens-independent + stable.
- **Pure helper** `src/lib/work-packages/wp-walk.ts` — `wpWalkFrom(leafWps, currentId) → { prev, next, index, total }`. Filters + sorts + resolves neighbours. Unit-tested.
- **Component** `WpWalkBar` (`src/components/features/work-packages/wp-walk-bar.tsx`) — a slim bar under the WP `DetailHeader` (the bottom is taken by the capture shutter): `‹ ก่อนหน้า · {index+1}/{total} · งานถัดไป ›`. prev/next are `Link`s to the neighbour WP that **preserve the `?from` referrer** so the back chip still returns to the caller. Renders nothing when there is neither a prev nor a next.
- **Wire**: add the leaf-WP read to the WP-detail leaf-path `Promise.all`; render `WpWalkBar` under `DetailHeader`. Leaf path only (the group branch returns early — งาน don't walk).

### U2 — one-tap attendance on the photo screen (next unit; code-only)

Make attendance the adoption bet: log "who worked on this WP today" where the SA already is (the photo screen), in one tap.

- A `ใครมาทำงานนี้วันนี้` chip strip on the photos tab: the project's active workers as toggle chips; tap = logged present today (full day) via the existing `logLaborDays`; instant, no submit. Auto-saves; re-tap to remove.
- **Drop the ทีมงาน tab.** Its long-tail (back-date, half-day, history, corrections, off-project worker search) folds into a `ประวัติ / แก้ไข` sheet opened from the strip — nothing lost, progressively disclosed. WP detail goes 7 tabs → 6.
- Reuses `logLaborDays` (SA-gated) — no schema.

### Later

- `/projects/:id` becomes the SA landing (single-project SA redirected from `/sa`); `/sa` → thin project switcher. Demote แผนพรุ่งนี้ button. (own unit)
- Retire the spec-277 P0 muster / แผนวันนี้ centrepiece from `/sa`. (own unit)

## Verification

- `pnpm lint && pnpm typecheck && pnpm test` green.
- U1: `wp-walk` unit tests (filter/sort/neighbour/edge) + `WpWalkBar` RTL (hrefs preserve `?from`, position text, disabled ends, empty→null).
- Auth-gated surface → verified-by-checklist; operator device pass is acceptance.

## Open questions

- Walk "next" currently = next active leaf by code. Could later honour the SA's chosen lens order (needs the ordered id list threaded from the list page).

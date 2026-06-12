# Spec 54 — WP detail redesigned to the operator's mockup

**Status:** complete (2026-06-13) — operator eye on deploy = acceptance
**Date:** 2026-06-13
**Origin:** operator screenshot 2026-06-12 ("Can we have designs similar
to this for all pages?") — a mockup of the WP detail screen. This spec
rebuilds the reference page (SA + PM WP detail) and extracts the design
primitives; follow-up specs sweep the remaining pages with the same
language, one operator-feedback round at a time (the spec-40 loop).

## Design language read from the mockup

1. **Header**: white; back affordance = rounded chip button (white card,
   arrow); WP code small above a large bold name; status pill right.
2. **Phase progress bar**: three horizontal segments under the header —
   green (passed), blue (current), zinc (not reached) — captioned
   ความคืบหน้ารูปถ่าย **N จาก 3 ช่วง** · ช่วงปัจจุบัน: {phase label}.
3. **Attention card**: white rounded card with a thick amber left bar,
   amber dot + bold imperative title + body + the action itself inline
   (mockup: contractor assignment with select + "เพิ่มผู้รับเหมาใหม่").
4. **Count chip**: amber pill — numbered disc + label + › — for pending
   purchase requests (คำขอซื้อรออนุมัติ).
5. **Phase timeline**: per-phase row — green check disc (has photos) or
   neutral disc (none), bold phase label + "N รูป", last-updated line,
   colored vertical rail, photo strip whose FIRST tile is a dashed
   "ถ่ายเพิ่ม" camera tile; photo tiles carry a time overlay.

## Scope

### New shared primitives

- `src/lib/photos/phase-progress.ts` — `derivePhaseProgress(counts)`
  pure fn: `doneCount` = phases with ≥1 photo; `currentPhase` = LAST
  phase (before→during→after order) with ≥1 photo, `'before'` when none;
  `segments[3]`: `complete` for a phase with photos before the current
  one, `current` for the current phase IF it has photos, else `empty`.
- `src/components/features/phase-progress-bar.tsx` — segments + caption
  (server-presentational; colors green-600 / blue-700 / zinc-200).
- `src/components/features/attention-card.tsx` — `tone: 'amber'|'red'`,
  `title`, children. Rounded-xl white card, 4px left accent bar, dot +
  bold title. Replaces the bespoke rejected/needs_revision strip too
  (red tone) — one attention pattern everywhere.
- `src/components/features/count-chip.tsx` — `count`, `label`, `href`
  (anchor or route). Amber-50 pill, amber-700 numbered disc, ›.
  Renders nothing at count 0.
- `formatThaiTime` in `src/lib/i18n/labels.ts` — HH:MM, Asia/Bangkok
  pin (same doctrine as the existing two formatters).

### SA WP detail (`/sa/projects/[id]/work-packages/[id]`)

- Header rebuilt: row 1 = back chip + RefreshButton; row 2 = code over
  text-2xl name + status pill. The spec-28 at-a-glance lines are
  REPLACED by the progress bar + chip (same facts, mockup shapes).
- `PhaseProgressBar` directly under the header.
- Contractor unassigned → `AttentionCard` (amber) titled
  ต้องมอบหมายผู้รับเหมาก่อนเริ่มงาน with the existing
  `WpAssignmentPanel` inside (machinery untouched). Assigned → the
  current compact contractor line + panel, no card.
- `CountChip`: count of `status='requested'` requests, label
  คำขอซื้อรออนุมัติ, href `#wp-requests` (the requests zone gains the
  id). Hidden at 0.
- Phase sections (PhaseUploader) restyled to timeline rows:
  - Row: check disc (green ≥1 photo / zinc-300 ring none) + label +
    N รูป; the header "+ เพิ่มรูป" button is REMOVED.
  - Sub-line: อัปเดตล่าสุด {HH:MM} (latest of captured_at_client ??
    created_at) or ยังไม่มีรูป.
  - Left rail: 2px, green-600 when the phase has photos, zinc-200 else.
  - Strip: first tile = dashed "ถ่ายเพิ่ม" tile (lucide Camera) wrapping
    the SAME hidden file input — upload/queue/remove machinery is
    byte-equivalent, only the trigger moved. EmptyNotice dropped (the
    add tile means the strip is never empty).
  - Photo tiles gain a bottom time overlay (dark gradient, white HH:MM).
- Rejected/needs_revision strip → `AttentionCard` red/amber, content
  unchanged.

### PM WP detail (`/pm/work-packages/[id]`)

Same header rebuild (back chip + refresh; code/name/pill; HoldToggle
stays), `PhaseProgressBar`, and the PhaseGallery rows get the same
timeline treatment (check disc, rail, count, last-updated, time
overlays) — read-only, no add tile.

## Recorded deviations from the mockup (data-honest)

1. "ถ่ายครบแล้ว" implies a per-phase photo quota — none exists. The
   sub-line shows last-updated time only. Quota = own spec if wanted.
2. Tile captions (หน้างานก่อนเริ่ม) — photo_logs has no caption column.
   Tiles overlay TIME only. Captions = schema change = own spec.
3. Per-phase แก้ไข link — removal is already per-tile (red disc);
   a separate edit mode would duplicate it. Skipped.
4. The chip counts `requested` rows (matches the mockup label
   รออนุมัติ), replacing the old "N ค้าง" open-count line.

## Tests (failing first)

- `tests/unit/phase-progress.test.ts` — derivePhaseProgress: none /
  first-only / mockup case (before+during) / gap (before+after, no
  during) / all; formatThaiTime HH:MM + invalid-input degradation.
- `tests/unit/attention-card.test.tsx` — tone classes, title, children.
- `tests/unit/count-chip.test.tsx` — count + label + href; null at 0.

## Verification checklist

1. `pnpm lint && pnpm typecheck && pnpm test` green.
2. Operator eye on deploy (the acceptance mechanism): WP detail matches
   the mockup's shapes; upload/remove/offline queue still work on phone.

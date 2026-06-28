# 216 — Multi-rework rounds (distinguish each งานแก้ไข cycle)

Status: DESIGN — awaiting operator model sign-off (2026-06-28).
Relates: spec 144 (defect rework loop), spec 215 (after_fix / หลังแก้ไข bucket),
spec 03 (photo-driven status transition), ADR 0004/0009/0015 (append-only + supersede).
Doctrine: Field-First; WP-centric.

## Why

Spec 215 added the `after_fix` (หลังแก้ไข) bucket for a WP's rework-completion
photos. The defect loop (spec 144) is already **repeatable** — a `complete` WP can
be reopened for a defect again and again (`complete → rework → after_fix →
pending_approval → complete →` reopen `→ …`). But the model assumes **one** rework:

- **Photos collide.** Every round's หลังแก้ไข photos land in the **same** `after_fix`
  bucket. Round 2's fix photos are indistinguishable from round 1's.
- **Reasons collapse.** Each reopen appends a `wp_reopened_for_defect` `audit_log`
  row (history exists), but the UI shows only the **latest** reason.

The gap: there is no **round dimension** tying photos (and reasons) to the cycle they
belong to. "Support more than one rework" = add that dimension.

## Design decision (recommended — model A: round counter)

Add a **rework-round number** as a dimension, NOT new phases or a new entity.

- `work_packages.rework_round smallint not null default 0` — the WP's current cycle.
  `0` = never reworked. The reopen RPC increments it (`0→1→2…`).
- `photo_logs.rework_round smallint not null default 0` — the cycle a photo belongs
  to. `before/during/after` and pre-rework rows stay `0`; an `after_fix` photo is
  stamped with the WP's current `rework_round` at capture.
- Per-round **reason** is already in `audit_log` (one `wp_reopened_for_defect` row per
  reopen). Record the round in its payload so round ↔ reason is explicit, not just by
  ordering.

Why this model:

- **Smallest change that fully supports N rounds** — one integer dimension, no enum
  growth (`after_fix` stays a single phase), no new table.
- **Fits append-only** — additive columns; supersede/tombstone of an after_fix photo
  inherits its `rework_round` (the replacement is the same round).
- **Reuses existing history** — `audit_log` already holds every reopen; we only tag
  it with the round. `approvals` already holds every re-approval, ordered.

Rejected alternatives:

- **Enum per round** (`after_fix_1`, `after_fix_2`…) — unbounded, breaks at round N,
  schema change per round. No.
- **Defect-cycle entity** (`work_package_defects` table: round, reason, reporter,
  resolution, approval link) — richer per-round timeline, but a new table + RLS +
  FKs + UI for history that `audit_log` already records. Over-built for the stated
  need; revisit only if per-round resolution/owner/SLA tracking is wanted (model B).

## Units (each its own session, TDD, ships through the gate)

- **U1 — schema + reopen increment (danger-path → held PR).**
  Migration: add the two `rework_round` columns; `create or replace` the reopen RPC
  to `set rework_round = rework_round + 1` and write `round` into the audit payload.
  `pnpm db:types` regen. pgTAP: reopen increments the round + stamps the audit round;
  columns present with default 0; grants unchanged.
- **U2 — write side.** `addPhoto` reads `wp.rework_round` and stamps `after_fix`
  inserts with it (other phases stay 0); `buildTombstoneRow` / supersede propagate
  `rework_round` so an edited/removed after_fix photo keeps its round. Unit tests.
- **U3 — read side.** Group `after_fix` by `rework_round` (helper
  `groupAfterFixByRound`, pure + unit-tested); map round → reason from the
  `wp_reopened_for_defect` audit rows. Extend `CurrentPhotosByPhase` minimally
  (keep the flat `after_fix` list for back-compat; add the grouped view).
- **U4 — UI.** Capture zone: the หลังแก้ไข tile captures into the **current** round,
  labeled "หลังแก้ไข · รอบ N"; prior rounds shown read-only with their count.
  Galleries (review + read-only): one section per round — "หลังแก้ไข (รอบ N)" + that
  round's reason. The gate from #144 (show only when reworked) is unchanged.

## Verification

- `pnpm db:test` — reopen-increments-round + audit-round pgTAP.
- `pnpm lint && pnpm typecheck && pnpm test` — round-grouping, addPhoto-stamping,
  supersede-propagation unit tests.
- Manual: reopen a WP twice; round-1 and round-2 หลังแก้ไข photos sit in separate
  labeled sections, each with its own reason; capture always targets the latest round.

## Open questions / deferred

- Per-round PM approval attribution (tag `approvals` with the round) — ordering gives
  it today; explicit tagging is a later nicety.
- After-fix photos (and round) in the PDF report — still out of scope (spec 215).
- Model B (defect-cycle entity) if per-round resolution/owner/SLA tracking is wanted.

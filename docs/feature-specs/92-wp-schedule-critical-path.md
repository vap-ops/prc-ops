# Spec 92 — WP schedule + critical path (KANNA-style)

**Status:** proposal (2026-06-14). The third and final follow-up to the
Field-First worklist (after the manual priority flag + next-action verbs).
Lights the reserved `is_critical` / CRITICAL_BADGE slot and adds a schedule
view. Operator direction: **manual dependency + duration entry in-app, with a
schedule calendar similar to KANNA** (アルダグラム's construction PM app).

## Reference — KANNA (what to match)

KANNA's schedule = a Gantt/工程表: task rows on a timeline, **Month / Quarter /
Year** period switch, **dependencies shown visually** between tasks, **nested**
project → sub-project → process (maps to our **project → งวดงาน (deliverable) →
work package**), progress monitoring, plus a **calendar** view of who's doing
what when. We build the WP-centric, Thai-first, mobile-first, sunlight-readable
equivalent on the Field-First tokens — not a clone.

## Why (operator goal)

Completes the alignment story. The manual priority flag is the human override;
the critical path is the SCHEDULE truth — the WP chain whose slip slips the
project. With both, the worklist's top item = the highest-leverage work for the
whole company, and the calendar makes the plan legible.

## Data model (manual, in-app)

- `work_packages.planned_start date null`, `planned_end date null` — the PM-set
  planned window (the Gantt bar). Nullable; unscheduled WPs simply don't appear
  on the timeline. Duration is derived (`planned_end − planned_start`).
- NEW `work_package_dependencies` (predecessor_id → successor_id, finish-to-start
  only for v1): id, predecessor_id FK, successor_id FK, created_by, created_at;
  UNIQUE(predecessor, successor); CHECK predecessor ≠ successor; both FKs within
  the same project (enforced in the setter RPC). RLS: SELECT staff
  (sa/pm/super), INSERT/DELETE pm/super — mirrors `work_package_members`.
- `is_critical` is **computed on read** (CPM in TS), NOT stored — no trigger /
  refresh machinery; ~80 WPs/project is trivial to compute server-side. The
  worklist already consumes `isCritical` as a prop.
- Writes via SECURITY DEFINER RPCs (mirror `set_work_package_contractor`):
  `set_work_package_schedule(wp, start, end)` and
  `add/remove_work_package_dependency(pred, succ)` — PM/super only, with the
  same-project + no-cycle checks inside.

## CPM (pure, testable)

`src/lib/work-packages/critical-path.ts`: given WPs (with planned_start/end) +
dependencies, run the standard forward/backward pass → earliest/latest
start-finish → float; **float = 0 ⇒ on the critical path**. Cycle-guarded
(the RPC also rejects cycles at write time). Pure function, unit-tested; the
project page feeds the result into `isCritical` so the badge lights.

## Units

- **A — schema** (this is the only DB unit): the 2 columns + dependencies table
  - the 3 setter RPCs + RLS/grants + pgTAP. Apply to prod via the merged-then-
    push flow. Bounded + safe (additive); won't change with calendar design.
- **B — CPM engine**: `critical-path.ts` + tests; wire `isCritical` into the
  project page → worklist CRITICAL_BADGE lights for path WPs.
- **C — input UI** (WP detail, PM/super): a "ขึ้นกับงาน" (depends-on) picker
  over same-project WPs + planned start/end date fields. This is the manual
  entry the operator asked for; minimal, consistent with the priority control.
- **D — schedule calendar (KANNA-style)**: the big design surface. WP rows
  grouped by งวดงาน, bars across a date timeline, dependency links, critical
  path highlighted (danger/attn), Month/Quarter/Year period switch, today
  marker, Field-First tokens, mobile-first (horizontal scroll timeline + tap a
  bar → WP detail). New route under the project, e.g. `/projects/[id]/schedule`.

## Open decisions for the operator (cheap to confirm, expensive to redo)

1. **Dates vs duration** — recommend PM sets **planned_start + planned_end**
   (matches KANNA bars); duration derived. (Alt: start + duration → end derived.)
2. **Dependency type** — recommend **finish-to-start only** for v1 (the 99%
   case); add SS/FF/SF later if needed.
3. **Calendar build route** — Unit D is design-heavy and you have a high bar.
   Either (a) route the calendar mock to the design agent first (the proven
   path for big UI, like the reskin), or (b) I build it directly on the tokens
   and you spot-check. A–C are safe for me to build autonomously now.

## Done when

Each unit: `typecheck && lint && test && build` green; Unit A also `db:test`
green + verified on prod. The CRITICAL_BADGE lights from real dependencies; the
schedule calendar renders the project timeline with the critical path marked.

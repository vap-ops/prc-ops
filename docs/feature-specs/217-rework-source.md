# 217 — Rework source (ตรวจภายใน vs ลูกค้าแจ้ง)

Status: IN PROGRESS — design confirmed with the operator 2026-06-28.
Relates: spec 216 (multi-rework rounds), spec 144 (defect rework). Doctrine: WP-centric.

## Why

Operator: there are two kinds of rework — (1) **internal call** (our own QA/SA finds the
defect) and (2) **client call** (the client reports it). Spec 216 distinguishes each
rework _round_; this adds _who called_ the round. Scope (operator-chosen): **record +
display only** — no behaviour change (no extra notification / warranty / approval).

## Design (operator-confirmed)

- New enum `public.rework_source` = `{ internal, client }`. Labels (SSOT in `labels.ts`,
  `REWORK_SOURCE_LABEL`): `internal` → **ตรวจภายใน**, `client` → **ลูกค้าแจ้ง**.
- `reopen_work_package_for_defect(p_wp, p_reason)` gains `p_source rework_source`. The
  report-defect form picks it (required); the RPC stamps `source` into the
  `wp_reopened_for_defect` audit payload, next to `reason` + `round` (spec 216 U1). No
  new column — the source is a per-round property read from the audit rows, like the
  reason. RPC sourced from LIVE (project_director gate kept); DROP+CREATE the 2-arg →
  3-arg signature, RE-REVOKE public/anon + GRANT authenticated (the grant trap).
- Read: a `reworkSourcesFromAuditRows` helper (parallel to `reworkReasonsFromAuditRows`)
  → `Map<round, ReworkSource>`. `load-detail` returns it; the review page reads the same.
- Display: the per-round หลังแก้ไข heading becomes "หลังแก้ไข — รอบ N · <source label>";
  the rework banner (AttentionCard) names the current round's source. Capture tile may
  show it too. Legacy reopen rows with no source → no source label (graceful).
- Form: `report-defect-control` gains a required ตรวจภายใน / ลูกค้าแจ้ง toggle.

## Units (TDD; one held PR — U1 carries the migration)

- **U1 — schema.** Enum + RPC `p_source` + audit `source` + pgTAP (reopen records the
  source; default/validation). db:types regen.
- **U2 — write.** `reportDefect` action + form toggle pass `source` to the RPC.
- **U3 — read + display.** `reworkSourcesFromAuditRows`; load-detail + review wire it;
  per-round heading + banner show the source label.

## Verification

- `pnpm db:test` — reopen-records-source pgTAP.
- `pnpm lint && typecheck && test` — source parse/label/heading unit tests + the
  report-defect form.
- Manual: reopen a WP as ลูกค้าแจ้ง → the รอบ section + banner show "ลูกค้าแจ้ง".

## Open / deferred

- Behaviour per source (notify / warranty / SLA / reporting) — explicitly out (operator
  chose record+display). Revisit if wanted.

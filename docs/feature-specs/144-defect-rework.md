# Spec 144 — Defect rework (reopen a complete WP)

Operator (2026-06-18): "complete doesn't mean a WP can't have defects — we forgot
to handle that." The lifecycle audit confirmed it: `complete` was terminal. A
defect found after sign-off had nowhere to go — the after-photo→`pending_approval`
transition won't fire from `complete`, and `log_labor_day` blocks `complete`. So
rework couldn't be captured, re-approved, or costed.

## Decisions (operator)

- **Reopen to a new `rework` status** (not reuse `in_progress`, not a separate
  punch-list entity). `complete → rework → (re-capture After) → pending_approval
→ complete`. `rework` is a visible quality signal in worklists; labor re-logs
  while in rework; the labor cost re-freezes on re-approval (existing approve
  path). Reuses the whole photo/approval cycle; one enum value added.
- **Reportable by `site_admin` + `project_manager` + `super_admin`** — site
  agents find defects in the field; PM/super still own the re-approval. Mirrors
  the capture-vs-approve split.

## Unit map

| Unit   | Scope                                                                                                                        | Status |
| ------ | ---------------------------------------------------------------------------------------------------------------------------- | ------ |
| **U1** | DB: `rework` enum value + `reopen_work_package_for_defect` RPC + transition/label/colour/band wiring + pgTAP                 | done   |
| U2     | UI: a "report defect" control on the WP page (complete-only, SA/PM/super) → reopen; show `rework` status + the defect reason | later  |

## U1 — status + reopen path (shipped)

- **`rework`** added to `work_package_status` (own migration `20260734000000`;
  a new enum value can't be used in the tx that adds it, so the RPC ships in
  `20260734000100`). pgTAP enum pin (file 08) → six values.
- **`reopen_work_package_for_defect(p_wp, p_reason)`** — SECURITY DEFINER,
  role-gated (`site_admin`/`project_manager`/`super_admin`) AND membership-gated
  (`can_see_wp`, ADR 0056 — so a scoped SA/PM must be on the project; super
  always). Only a `complete` WP reopens; it flips to `rework` and writes an
  `audit_log` row (`action='other'`, payload `{event:'wp_reopened_for_defect',
reason}`, actor captured). Non-complete / empty-reason → `22023`; wrong role /
  non-member → `42501`.
- **Transition wiring:** `TRANSITIONABLE_FROM_STATUSES` gains `rework`, so
  re-shooting the After photo on a rework WP → `pending_approval` → PM
  re-approves → `complete` (re-freezes labor cost via the existing approve path).
  Labor logging is already allowed in `rework` (`log_labor_day` blocks only
  `complete`). The list filter's "outstanding" view shows rework automatically
  (`status <> 'complete'`).
- **Status plumbing (the enum-add ripple, all handled):** `WORK_PACKAGE_STATUS_LABEL`
  (`งานแก้ไข`), `workPackageStatusPillClasses` (amber — in-flight/attention),
  `deriveActionBand` (`rework` → `todo` band) + `nextAction` (capture: "แก้ไข
  ข้อบกพร่อง แล้วถ่ายรูปใหม่"), `schedule-gantt` `STATUS_STYLE` (amber, pct 90).
  typecheck surfaced every exhaustive consumer.
- **pgTAP file 75** (plan 10): catalog + member SA reopen → rework + audit row,
  non-complete/empty-reason `22023`, non-member SA / visitor `42501`, super
  reopen.

## U2 — report-defect UI (next)

A "รายงานข้อบกพร่อง / report defect" control on the WP detail page, shown only
when `status = 'complete'` to SA/PM/super, opening a reason field →
`reopen_work_package_for_defect` → the WP flips to `rework`. Show the `rework`
status (label + amber pill already wired) and the latest defect reason (read the
newest `wp_reopened_for_defect` `audit_log` row for the WP). From there the
normal capture → approve cycle resumes.

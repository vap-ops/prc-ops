# Spec 61 — PM control over report content

**Status:** complete (2026-06-13) — operator report try-out = acceptance
**Date:** 2026-06-13
**Origin:** operator screenshot item 3: "PM needs control over what's
being reported under สร้างรายงาน button."

## Scope

### Params model

`ReportParams` (new pure module `src/lib/reports/params.ts`):

- `scope`: `"complete"` (today's behavior — only เสร็จสิ้น WPs) |
  `"all"` (every WP, its status printed in the section heading).
- `photos`: `"after"` (today — current แล้วเสร็จ photos) |
  `"all_phases"` (current photos of all three phases, phase-labelled) |
  `"none"` (text-only listing).
- `DEFAULT_REPORT_PARAMS = { scope: "complete", photos: "after" }`.
- `parseReportParams(value: unknown): ReportParams` — anything missing
  or malformed falls back per-field to the default, so pre-61 rows
  (`{}`) and hand-edited junk both render the legacy report. Never
  throws.

### DB (migration `20260621000200_add_reports_params.sql`)

`alter table public.reports add column params jsonb not null default
'{}'::jsonb;` — written once at INSERT by the requester; readers parse
defensively. No new policies (column rides the existing posture). pgTAP
file 12 has no column-set pin (verified); add a `has_column` assert +
plan bump there.

### Builder + runner

- `build-pdf.ts`: WP section heading gains an optional status label
  (`scope: all`); photos become labelled groups
  (`{ label: string | null, photos: Buffer[] }[]`) — `after` mode keeps
  today's unlabelled single group (byte-similar layout); `all_phases`
  prints the Thai phase label above each group; `none` lists WPs with
  no images and the skip-empty-WP rule disabled (a text listing of zero
  photos is the point).
- `run-report-job.ts`: parse `job.params`; scope drives the WP query
  (`complete` filter or none); photos mode drives which phases download.

### UI

`GenerateReportButton` grows into a small options form (two radio
groups, Thai labels, defaults = legacy):

- งานที่รวม: เฉพาะงานเสร็จสิ้น / ทุกงาน (แสดงสถานะ)
- รูปถ่าย: รูปช่วงแล้วเสร็จ / รูปทุกช่วง / ไม่ใส่รูป

`generateReport` accepts `params`, validates via `parseReportParams`
round-trip (reject only non-object junk from the form — the form can't
produce it; defensive), inserts the row with `params`.

### Recorded risk — the frozen Railway worker

`worker/` is byte-frozen (ADR 0040 atrophy). If the fast path fails to
claim and the Railway cron picks the row up, the worker IGNORES params
and builds the legacy report, marking it complete. Window: fast-path
claim failure only (rare). Accepted + recorded; the operator MAY pause
the Railway cron (safe since the spec-39 reaper amendment), which
removes the window entirely — nudged via Telegram.

## Tests (failing first)

- `tests/unit/report-params.test.ts` — parse matrix: `{}`, full valid,
  partial, junk types, unknown enum strings → per-field defaults;
  defaults constant pin.
- pgTAP file 12 `has_column` for params.

## Verification checklist

1. `pnpm lint && pnpm typecheck && pnpm test` green; prod build green.
2. Migration dry-run shows exactly one file; push; `pnpm db:types`
   reconcile; `pnpm db:test` green.
3. Operator: generate with ทุกงาน + ไม่ใส่รูป → one-page listing with
   statuses; legacy defaults still produce the familiar report.

# Spec 39 — On-demand report generation (+ stale-report reaper)

**Status:** locked — 2026-06-12. ADR 0040 (binding). `/worker` is
byte-untouched; failure at every fast-path stage degrades to today's
behavior (cron sweeper) or is freed by the reaper.

## 1. Scope

**In:**

- Migration: `reap_stale_reports(p_max_age_minutes default 15)`
  (SECURITY DEFINER, revoke-then-grant pattern — service paths only) +
  pg_cron `report-reaper` every 5 min. pgTAP file 27: function
  security pins, stale `processing` → `failed` with reaped error,
  fresh `processing` / `requested` / terminal rows untouched, cron job
  pin.
- `src/lib/reports/`: `sarabun-font.ts` (base64 module, OFL notice,
  generated from worker/fonts — prettier/eslint-ignored),
  `build-pdf.ts` (PDFKit composition — port of worker/report.ts,
  same layout), `current-after-photos.ts` (the ADR 0009 anti-join
  filter — PURE, test-first port of the worker's filter + its tests),
  `run-report-job.ts` (fetch → download → build → upload → mark,
  service-role client injected).
- `generateReport` action fast path: after the existing insert —
  `claim_next_report` via admin client; claimed → `runReportJob`;
  job error → mark `failed` (worker parity); claim/raced/unexpected
  envelope errors → log and leave (sweeper territory). Button pending
  copy: "กำลังสร้าง…".
- `package.json`: `pdfkit` + `@types/pdfkit`; `next.config.ts`:
  `serverExternalPackages: ["pdfkit"]`; reports page
  `export const maxDuration = 60`.
- Unit tests: after-photos filter (RED first), Buffer smoke for
  `buildReportPdf` (`%PDF` magic + non-trivial size) if pdfkit runs
  under vitest — else recorded as worker-suite-covered.

**Out:** any `/worker` edit, Railway config changes (operator MAY
pause the cron later), report layout changes, deliverable grouping,
Edge Functions.

## 2. Verification checklist

- [ ] RED→GREEN on the ported filter tests; suites green; pgTAP 27
      green post-push; dry-run before work.
- [ ] `claim_next_report` is the ONLY claim path in the app code (no
      direct status writes from the action besides the ported
      markFailed/complete inside run-report-job).
- [ ] Reaper proven by pgTAP (backdated `updated_at` fixture).
- [ ] No diff under `worker/`.
- [ ] Operator acceptance: click สร้างรายงาน → report is
      พร้อมดาวน์โหลด within seconds (first poll), PDF opens with Thai
      header; Railway logs keep saying "No jobs to process".

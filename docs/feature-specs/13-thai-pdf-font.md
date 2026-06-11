# Spec 13 — Thai-capable font in the PDF report worker

**Status:** Locked 2026-06-11 — by the operator's "Proceed as planned, then
merge" instruction; the plan named this unit, the font approach, and the
rider explicitly (see the "Live-state refresh" unit in the progress
tracker, "Dev next-unit queue" item 1).

## Problem

`worker/src/report.ts` renders all report text with PDFKit's built-in
Helvetica, whose WinAnsi encoding cannot represent Thai. Confirmed by
repro on 2026-06-11: `buildReportPdf` with a Thai project/WP name
**throws no error** but writes the raw Thai codepoints into a single-byte
hex string — PDF viewers render Latin mojibake. Every live work-package
and deliverable name is Thai, and `reports` has zero rows in production,
so the first real report (the go-live §4 dry run) would silently deliver
garbage. Failure mode is silent success — no failed job to notice.

## Scope

1. **Embed Sarabun Regular** (SIL OFL 1.1; the de-facto Thai document
   font, full Thai + Latin coverage) in the worker:
   - Font assets at `worker/fonts/Sarabun-Regular.ttf` with `OFL.txt`
     alongside (license requirement). Source: the `google/fonts` repo,
     `ofl/sarabun/`.
   - `worker/src/report.ts` registers the font on each `PDFDocument`
     (`doc.registerFont`) and selects it for **all** text — header,
     generated-date line, WP headings, photo-count line. One face,
     regular weight only; font sizes unchanged. Loading the TTF from
     disk at module scope is permitted (static asset bundled with the
     code — not the data I/O that the module's "no I/O" rule excludes).
   - Resolve the font path relative to the module (`import.meta.url`),
     not the process CWD — the worker runs under Railway with Root
     Directory `/worker` and locally from the repo root or `worker/`.
2. **Rider (mechanical, per `worker/README.md` regen rule):** refresh
   `worker/src/database.types.ts` from the app copy
   `src/lib/db/database.types.ts` — the worker copy predates the
   `deliverables` table, `work_packages.deliverable_id`,
   `purchase_requests`, and the ADR-0025 `audit_action` values.

## Out of scope

- Bold/italic weights, font fallback chains, app-side (web UI) fonts.
- Any layout change — page breaks, sizes, margins stay as v1 locked.
- Deliverable grouping (spec 04 Phase 3) and watermarks (ADR 0003).
- Replacing the `formatGeneratedDate` locale or wording.

## Test (failing first, worker-local)

New tests in `worker/tests/unit/report.test.ts` driving `buildReportPdf`
with real Thai strings (e.g. project "โครงการนำร่อง", WP "งานปักฝัง"):

- The output embeds a font program: `/FontFile2` present and the
  `/BaseFont` name contains `Sarabun` (today: neither — standard-14
  Helvetica is never embedded).
- No `Helvetica` `BaseFont` remains anywhere in the document (all text
  paths switched).
- The embedded font's `/ToUnicode` CMap (inflate the PDF's compressed
  streams with node's `zlib`) contains Thai codepoints from the input
  (e.g. `0E42`), proving the Thai text survives into the PDF with a
  correct unicode mapping rather than the WinAnsi nibble-dump.

Existing tests must keep passing unchanged.

## Verification checklist

- [ ] New Thai tests RED before the implementation, GREEN after.
- [ ] Worker-local `pnpm typecheck` and `pnpm test` pass (the worker is
      excluded from the root suite and CI — local runs are the gate).
- [ ] Repro decode of a Thai-named report shows an embedded subset font
      and ToUnicode mapping; visual sample PDF sent to the operator.
- [ ] Root `pnpm lint && pnpm typecheck && pnpm test` unaffected.
- [ ] No diff under `supabase/`, `src/app/`, or `src/lib/` except none.
- [ ] `worker/src/report.ts` header comment's "Deferred to v2" list
      untouched (deliverable grouping stays deferred).

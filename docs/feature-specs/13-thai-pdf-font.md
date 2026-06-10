# Feature Spec 13: Thai-capable font in the PDF report worker

## Status

Draft — 2026-06-11. **Awaiting operator lock.** No code until locked.

## Problem

`worker/src/report.ts` renders all text with PDFKit's built-in Helvetica
(WinAnsi, single-byte). Helvetica cannot encode Thai. Confirmed by repro
on 2026-06-11 (see the "Live-state refresh" unit in
`docs/progress-tracker.md`): `buildReportPdf` with a Thai project/WP
name throws **no error** but emits the raw codepoints into a single-byte
hex string — viewers render Latin mojibake. Every live WP and
deliverable name is Thai (e.g. WP01 "งานปักฝัง") and `reports = 0` in
production, so the first real report — the go-live §4 dry run — would
silently deliver garbage. Failure mode is silent success: the job
completes, uploads, and marks `complete`.

## Decision to lock

1. **Font: Sarabun** (Google Fonts, SIL OFL 1.1), Regular + Bold TTFs.
   - De-facto standard for formal Thai documents (TH Sarabun lineage),
     looped letterforms — what Thai readers expect on official reports.
   - Full Thai **and** Latin coverage, so it replaces Helvetica
     wholesale — one font family, no per-script switching logic.
   - Alternative considered: Noto Sans Thai (also OFL) — loopless
     style, weaker fit for formal documents. Not recommended.
2. **Headings go Bold.** Project header and WP section headings use
   Sarabun Bold; body text uses Sarabun Regular. This is the one
   deliberate visual change beyond the typeface swap (today everything
   is Helvetica regular). All Latin text (codes, dates, labels) also
   changes typeface — flagging so the lock is informed.

## Scope

### Font assets (new, committed)

- `worker/assets/fonts/sarabun/Sarabun-Regular.ttf`
- `worker/assets/fonts/sarabun/Sarabun-Bold.ttf`
- `worker/assets/fonts/sarabun/OFL.txt` — the license, committed
  alongside the fonts (OFL requires the notice to travel with them).
- Source: the `google/fonts` GitHub repo, `ofl/sarabun/` (upstream of
  fonts.google.com). ~100–200 KB per weight — fine to commit; Railway
  deploys with Root Directory = `/worker`, so `worker/assets/` ships
  with the deploy.

### `worker/src/report.ts`

- Read both TTFs **once at module load** via
  `readFileSync(new URL("../assets/fonts/sarabun/…", import.meta.url))`
  — cwd-independent, works under `tsx` locally and on Railway.
- In `buildReportPdf`: `doc.registerFont("Sarabun", …)` /
  `doc.registerFont("Sarabun-Bold", …)` (per-document, PDFKit accepts
  Buffers), then `doc.font(…)` so **no text is ever laid out in
  Helvetica**: headings Bold, body Regular.
- Update the module header comment: the "NO I/O" claim becomes "no
  network/DB/Storage I/O; static font assets are read once at module
  load". DB/Storage I/O stays in `index.ts` — boundary unchanged.

### Test (failing first, per TDD)

New cases in `worker/tests/unit/report.test.ts`, asserting **reader-
visible text**, not just `%PDF` magic (the existing tests use only
English names — that blind spot is exactly how this bug shipped):

- **New dev-only dependency, worker-local:** `pdfjs-dist` (legacy
  build, runs in Node without a worker thread). Used to extract text
  back out of the generated buffer. Rejected alternative: hand-rolled
  zlib-inflate of content streams + ToUnicode CMap scanning — brittle,
  and asserts encoding plumbing rather than what a reader sees.
- Test 1 — Thai round-trip: project + WP names in Thai, including the
  live WP01 name "งานปักฝัง" and a mark-heavy string exercising
  above/below vowels + tone marks (e.g. "ปูกระเบื้องชั้นใต้ดิน").
  Extracted text (items concatenated; Thai has no internal spaces)
  must contain the exact input strings. **Fails on current code**
  (mojibake) — record the failure before implementing.
- Test 2 — Latin still round-trips: code, English name, generated
  date string survive the font swap.
- Test 3 — embedding guard: PDF buffer contains a `Sarabun` BaseFont
  (subset-tagged) and **no** `Helvetica` — catches partial application
  (one missed `doc.text` call would silently reintroduce mojibake).
- Existing three tests stay green, unchanged.

### Housekeeping rider (same unit, per tracker handoff)

- Refresh `worker/src/database.types.ts` from
  `src/lib/db/database.types.ts` per the `worker/README.md` regen rule
  (straight copy; the app copy was regenerated and committed
  2026-06-11). Worker copy currently lacks the `deliverables` table,
  `work_packages.deliverable_id`, and the ADR-0025 `audit_action`
  values.
- `worker/README.md`: one-line updates — tests section mentions the
  Thai round-trip coverage; files section lists `assets/fonts/`.

## Out of scope (record; do not build)

- Deliverable-grouping in the PDF — spec 04 Phase 3, separate spec.
- Watermarks (ADR 0003, v2); Before/During photos; PM curation.
- Thai word-segmentation for line breaking. Thai has no spaces;
  PDFKit breaks overflowing runs mid-word at the character level.
  Acceptable for v1 name-length strings — dictionary-based breaking
  is a non-goal.
- Localizing the generated date to Thai — stays en-GB per the locked
  v1 content in `report.ts`.
- Any app-side (Next.js) change, any DB/schema change. No
  `supabase/` diff; change-management policy not triggered.

## Risks

- PDFKit shapes via fontkit (GSUB/GPOS); Sarabun carries the mark-
  positioning tables Thai needs. If shaping proves broken in practice
  (unlikely), **stop and report per the blocked protocol** — no
  library swap without approval.

## Verification checklist

- [ ] Thai round-trip test demonstrably fails against current
      `report.ts` (failure recorded), then passes after.
- [ ] From `worker/`: `pnpm install --ignore-workspace`,
      `pnpm typecheck`, `pnpm test` — all green. (Worker is excluded
      from root suite and CI — root CI green is not evidence.)
- [ ] Sample PDF generated with live-style Thai names, opened in a
      viewer: vowels/tone marks positioned correctly, headings bold.
- [ ] `OFL.txt` committed alongside the TTFs.
- [ ] `worker/src/database.types.ts` byte-identical to
      `src/lib/db/database.types.ts`.
- [ ] Root `pnpm lint && pnpm typecheck && pnpm test` untouched/green
      (no root-app code in this unit).
- [ ] No diff under `supabase/`.

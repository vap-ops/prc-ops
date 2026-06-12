# Spec 60 — reports page: detail header + standalone-safe download

**Status:** complete (2026-06-13) — operator phone pass = acceptance (share sheet on installed PWA)
**Date:** 2026-06-13
**Origin:** operator screenshot 2026-06-13, items 1–2: "Remove these
urls, add back button. Pdf download is not working."

## Item 1 — header

The reports page still wears the hub costume: AppHeader + a three-link
nav row (รายการรอตรวจ / ← โครงการทั้งหมด / รายการงาน). Since spec 59 it
is a project-scoped detail surface entered from the project page's
รายงาน chip. Rebuild to the spec-54 detail header:

- Back chip → `/sa/projects/[id]` (the project page — the entry).
- RefreshButton (light), project code mono over h1 รายงาน, project name
  line under it. The duplicate project card in the body goes away.
- Nav-link row DELETED. The bottom tab bar still covers cross-surface
  jumps. `docs/site-map.md` updated in the same unit (its contract).

## Item 2 — download

Root cause: `window.open(url, "_blank")` after an `await` — the spec-45
lesson verbatim: the installed PWA has no tab model, and iOS transient
activation is gone after the await. Dead button in the field.

Fix (blob flow, no popups, no navigation):

1. `getReportDownloadUrl` mints the signed URL with
   `{ download: <filename> }` so any direct navigation gets an
   attachment disposition; response now carries `fileName` too.
2. New pure helper `buildReportFileName(projectCode, createdAtIso)` →
   `{code}-report-{YYYYMMDD}.pdf` (ASCII-safe, Bangkok date).
3. `DownloadButton`: fetch the signed URL → Blob → File:
   - `navigator.canShare({ files })` → `navigator.share(...)` — the iOS
     share sheet (Save to Files / LINE / AirDrop); AbortError = silent.
   - else → object-URL + `<a download>` click (desktop/Android path),
     revoked after.
   - any failure → existing Thai error strip.

## Tests (failing first)

- `tests/unit/report-file-name.test.ts` — code + date shape, Bangkok
  date pin, weird code passthrough.

## Verification checklist

1. `pnpm lint && pnpm typecheck && pnpm test` green; prod build green.
2. Operator (installed PWA): ดาวน์โหลด PDF opens the share sheet; nav
   row gone; back chip returns to the project page.

# Spec 163 — Paste work packages from Google Sheets

**Status:** Draft → in progress.
**Relates to:** ADR 0014 (wp-import contract), Spec 142 U7 (CSV import path).

## Problem

The operator builds a project's work-package list in Google Sheets (one row
per WP: a `WP-NNN` code in column A, the Thai work name in column B). The fast
way to get those into a project is to select the cells, copy, and paste.

A Google-Sheets cell copy is **tab-delimited**, has **no header row**, and the
example case is **two columns** (code, name — no description):

```
WP-001	งานหาพิกัดและระดับพื้น ...
WP-002	งานทำไฟฟ้าชั่วคราว
...
WP-262	งานเติมจุลินทรีย์ชุดถังบำบัด
```

The existing U7 importer (`parseAndValidate`, `src/lib/wp-import/parse.ts`)
assumes **comma**-delimited input **with a `code,name,description` header row**.
Pasting the sheet copy fails: PapaParse reads the first data row
(`WP-001`, `งาน…`) as the header, so every real row is misread.

## Unit U1 — accept the sheet paste in the importer

Make `parseAndValidate` accept a Google-Sheets paste, **backward-compatible**
with the comma+header CSV it handles today. Two detections, no new entry point:

1. **Delimiter.** If the text contains a TAB, parse as tab-delimited (the
   sheet-copy case); otherwise comma (the hand-written CSV case).
2. **Header optional.** If the first non-empty row's first cell is the literal
   `code` (case-insensitive), treat it as a header row and read by column name
   (today's behaviour). Otherwise there is no header: read **positionally** —
   column 1 = code, column 2 = name, column 3 (if present) = description.

Everything downstream is unchanged: same `WpRow` shape, same trim, same
required-code / required-name / in-file-dup / existing-code validation, same
1-based data-row numbering in error messages, same `create_work_package` loop in
`importWorkPackagesCsv`.

Then update the U7 sheet UI (`import-work-packages-sheet.tsx`) copy so it tells
the operator they can paste straight from Google Sheets, and fix the now-stale
`importWorkPackagesCsv` empty-result message that claims a header is required.

### Acceptance

- Pasting the spec's 262-row example (tab, no header, 2 columns) into the import
  sheet creates 262 work packages, descriptions null.
- A tab paste with a 3rd column sets description.
- The existing comma + `code,name,description` CSV path still works unchanged
  (all current `wp-import-parse.test.ts` cases stay green).
- Validation errors (missing/dup code, missing name) still report the correct
  data-row number in the headerless case.

### Out of scope

- Code/name length validation in the parser (the `create_work_package` RPC
  still enforces ≤50 / ≤200; example data is within limits).
- Importing status, cost, or any column beyond code/name/description.
- A column-mapping UI or delimiter picker — detection is automatic.

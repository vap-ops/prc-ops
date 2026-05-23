# ADR 0014: Work-packages CSV import contract

## Status

Accepted — 2026-05-24

## Context

Each pilot project carries ~80 work packages. Manual data entry is
impractical at that scale; per the locked architecture, WP data is
imported by the operator from a CSV exported from the source
spreadsheet — not auto-synced from Sheets / Excel.

This ADR locks the import contract: format, validation, conflict
handling, and runtime. The contract is documented here (not just in
code comments) so the operator can prepare files predictably and so
a future re-implementation has an explicit specification to match.

A future direction is a back-office UI (Airtable-like CRUD over a
typed schema) for both initial entry and ongoing editing of WP data.
That UI is the long-term successor to this CLI importer and is
explicitly **out of v1 scope**.

## Decision

The v1 importer is a Node-side CLI invoked as

```
pnpm import:wp <PROJECT_CODE> <path-to-file.csv>
```

`PROJECT_CODE` is the existing `public.projects.code` (e.g.
`PRC-2026-001`). The CSV carries WPs for that single project.

### Format

- **CSV only.** Not XLSX. Source spreadsheets export to CSV trivially
  via Excel's _Save as → CSV UTF-8_ or Google Sheets' _Download →
  Comma-separated values_. The simplicity of CSV — no library to
  decompress / unpack a binary format, no styling state to ignore —
  is the entire reason it wins over XLSX at v1 scale.
- **UTF-8 encoding required.** WP names commonly carry Thai
  characters; non-UTF-8 input is rejected or garbled by the parser.
  The data template's README spells this out explicitly.
- **Parser: papaparse** (the only new runtime dependency this unit
  adds). Handles quoted fields, embedded commas, embedded newlines,
  and UTF-8 — the four properties any real WP CSV will eventually
  exercise.

### File scope and project identity

- **One file per project.** The CSV does **not** carry a project
  identifier column; the project is the first CLI argument (matched
  against `projects.code`). Mixing WPs from multiple projects in one
  file is unsupported.
- **Project must exist** before importing. The CLI looks up
  `projects` by code via the admin client and stops with a clear
  error if not found. Importing is therefore a two-step operator
  flow: create the project (currently via SQL or seed file), then
  import its WPs.

### Columns

- **`code`** — required, non-blank. Composes the unique key
  `(project_id, code)` with the project supplied as the CLI argument.
- **`name`** — required, non-blank.
- **`description`** — optional. A blank cell (or a missing column
  entirely) is stored as `NULL`. Do **not** populate placeholder
  values like `"N/A"`.
- **Unknown columns ignored.** A richer source sheet that carries
  cost / subcon / QA / risk columns can be imported with the same
  CLI without first being trimmed. The importer reads only the three
  known columns by name; the rest are dropped silently.

### Validation — FAIL-ALL transactional

The importer is fail-all: it collects **every** validation error
before writing anything. If any row fails validation, **nothing** is
inserted; the operator fixes the file and re-runs.

Validation rules:

- blank or missing `code` → error
- blank or missing `name` → error
- duplicate `code` within the same file → error
- `code` already present in DB for this project → error (no upsert)
- project arg matches no `projects.code` → stop immediately
- extra / unknown columns → ignored, no error

Errors are reported with the row number (data row index, 1-based — so
row 1 is the first row after the header) and a one-line cause. All
errors are surfaced in a single run; the operator does not need to
re-run to discover the next error.

### Conflict policy — ERROR ON CONFLICT

If a `(project_id, code)` already exists in the DB, the importer
treats it as an **error** — not a skip, not an upsert. Re-importing
a file containing an already-imported WP is a mistake to surface,
not a no-op.

Editing an imported WP happens in the app, not by re-import. Bulk
re-sync / upsert is a v2 concern that will require its own contract
(diff semantics, deletion handling, audit-log entries) — not
something to retrofit into the v1 importer.

### Runtime

- **Admin (service-role) client** writes. The importer bypasses RLS
  by design — it is a trusted local tool, operator-run, effectively
  in a super_admin context. RLS still protects the app's user-facing
  surface (ADR 0013); the importer is intentionally out-of-band of
  RLS.
- **Plain `tsx` script** at `scripts/import-wp.ts`, not a Next.js
  route. It cannot reuse `src/lib/db/admin.ts` because that file —
  and its env transitively — has `import "server-only"` and throws
  outside the Next bundler. The script builds a minimal service-role
  client locally from `@supabase/supabase-js` + `process.env`. The
  same applies to `src/lib/env.server.ts`: it cannot be imported
  here; the script reads `process.env.NEXT_PUBLIC_SUPABASE_URL` and
  `process.env.SUPABASE_SERVICE_ROLE_KEY` directly and exits with a
  clear error if either is missing.
- **`.env.local` is loaded via Node's built-in `--env-file` flag**,
  passed through by tsx. The pnpm script is
  `tsx --env-file=.env.local scripts/import-wp.ts`. Node 20.6+ +
  tsx 4+ are required (the repo runs Node 22+ per CLAUDE.md).
- **`status` is not imported.** Every newly imported WP gets the DB
  default (`not_started`) regardless of any column in the file.
  Status transitions happen in-app (and, in a future unit, by
  photo-upload-driven workflow); they are not part of the import
  contract.

### Pure logic / I-O separation

The parse-and-validate logic lives at `src/lib/wp-import/parse.ts` as
a pure function: `parseAndValidate(csvText, existingCodes) → { rows,
errors }`. The CLI script is a thin I-O shell around it (file read,
project lookup, batch insert, exit codes). This split is the load-
bearing reason the validation rules are testable without touching
the DB or filesystem — the unit suite covers every rule against
crafted CSV strings.

## Consequences

### Positive

- **Predictable.** Same input always produces the same output (or
  the same set of errors).
- **All-or-nothing** reduces the operational risk of partial state.
  There is no "half-imported, half-failed" repair problem.
- **CSV + UTF-8 + papaparse** handles Thai project names and
  quoted/embedded-comma fields cleanly.
- **Pure validator is independently tested.** The Vitest suite
  covers every validation rule from crafted strings, with no DB
  fixture cost.
- **No coupling to the app runtime.** The importer runs from any
  laptop with `.env.local` present.

### Negative

- **No partial import.** A single bad row blocks the whole file.
  The operator fixes the file and re-runs — this is the intended
  behavior, but it can feel slow on a long file.
- **No upsert / sync.** Editing an existing WP requires the in-app
  UI; the importer cannot update or delete. Bulk re-sync is a v2
  concern.
- **CLI-only — non-technical users cannot self-serve.** The future
  back-office UI is the explicit successor. Until then, only
  operators with the repo and `.env.local` can run imports.

### Neutral

- **Admin client bypasses RLS.** Acceptable because the importer is
  local and operator-run; not a multi-tenant surface. The
  service-role key lives in `.env.local`, never in the client
  bundle.
- **`(project_id, code)` is the natural key.** The composite unique
  constraint on `work_packages` enforces uniqueness regardless of
  importer behavior; the error-on-conflict policy is a friendlier
  UX layer over the same constraint. A bypass-the-importer SQL
  INSERT would hit the same constraint.

## References

- ADR 0013 — Project access model (the role-level RLS this
  importer deliberately bypasses; `projects` is the FK target the
  importer requires to exist).
- `supabase/migrations/20260524010000_create_work_packages.sql` —
  the `work_packages` table this importer targets and its composite
  unique constraint.
- `data/work-packages-template.csv` and `data/README.md` —
  operator-facing template + run instructions.

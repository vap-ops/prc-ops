# PDF report worker

Standalone Node + TypeScript process that generates the PRC project PDF
reports. **Isolated from the Next.js app** — its own `package.json`, own
`node_modules`, own copy of `database.types.ts`. Designed to deploy to
Railway with **Root Directory = `/worker`**; nothing outside this
directory is included in the deploy.

## What it does — current scope

A single `run()` that:

1. Builds a service-role Supabase client from env.
2. Loops `public.claim_next_report()` (atomic FIFO claim via `FOR
UPDATE SKIP LOCKED`, flips `requested` → `processing` exactly once
   even under concurrent workers).
3. For each claimed job: fetches the project + its `complete`
   work_packages + the current After photos for each WP (ADR 0009
   anti-join + ADR 0015 tombstone filter), downloads each photo from
   the `photos` Storage bucket, builds a PDF via PDFKit, uploads it
   to the `reports` Storage bucket at `{project_id}/{report_id}.pdf`,
   and marks the row `complete` with `storage_path`.
4. On any error during a job, marks it `failed` with a short error
   message and continues to the next job.
5. When no claimable jobs remain, exits 0.

Cron-friendly shape — **run-once-and-exit, not always-on**. Railway
will invoke this on a cron schedule (separate later unit). If we ever
need always-on, that's a trivial wrapper around `run()`.

Not in scope this unit: watermarks (ADR 0003, v2), Before / During
photos in the PDF (v2 — v1 is After-only), PM image curation,
deliverable-grouping of WPs, stale-`processing` recovery, and the PM
report UI.

## Running locally

```sh
cd worker
pnpm install --ignore-workspace      # one-time; --ignore-workspace
                                     # keeps the worker out of the
                                     # root pnpm workspace
pnpm dev                             # reads ../.env.local, runs once
```

`pnpm dev` uses `tsx --env-file=../.env.local` so the operator can
share the same `.env.local` the Next app uses. On Railway, env vars
are injected directly by the platform — `pnpm start` (which is just
`tsx src/index.ts`) reads `process.env` regardless of how it was
populated.

## Required env vars

| Var                         | Purpose                                          |
| --------------------------- | ------------------------------------------------ |
| `SUPABASE_URL`              | Project URL. Fallback: `NEXT_PUBLIC_SUPABASE_URL` for shared local `.env.local`. |
| `SUPABASE_SERVICE_ROLE_KEY` | Service-role secret. Bypasses RLS — keep secret. |

The worker throws clearly on startup if either is missing.

## Tests

```sh
pnpm test
```

Pure unit tests against `src/report.ts` — asserts the PDF buffer is
valid (`%PDF` magic), that WPs with no After photos are skipped, and
that an empty project produces a header-only PDF. The I/O glue in
`src/index.ts` is exercised by the operator's local end-to-end run
against the linked Supabase project, not by these unit tests.

## Files

- `src/index.ts` — entry point. The run-once loop, DB queries,
  Storage downloads, PDF assembly, and Storage upload.
- `src/report.ts` — pure PDFKit composition. No I/O. Takes already-
  fetched data + already-downloaded photo bytes, returns a PDF
  buffer. Unit-tested in `tests/unit/report.test.ts`.
- `src/supabase.ts` — service-role client factory.
- `src/database.types.ts` — **copy** of the app's
  `src/lib/db/database.types.ts`. See "Regen rule" below.

## Regen rule for `database.types.ts`

There are TWO copies of `database.types.ts` in the repo:

- `src/lib/db/database.types.ts` (the Next app)
- `worker/src/database.types.ts` (this worker)

When the schema changes, run the app's regen and then copy the result
into the worker:

```sh
pnpm db:types                         # at the repo root — regenerates the app copy
cp src/lib/db/database.types.ts worker/src/database.types.ts
```

Both copies must stay in sync. The duplication exists because Railway
deploys with Root Directory = `/worker`; the worker cannot
`import "../../src/lib/db/database.types"` because that path is
outside the deploy.

## Isolated from the root tooling

The worker is **excluded from the root pnpm/tsc/vitest/eslint/prettier
runs** so the root `pnpm lint && typecheck && test && build` doesn't
choke on it. See the root configs (`tsconfig.json`, `vitest.config.ts`,
`eslint.config.mjs`, `.prettierignore`) and the entry in `.gitignore`
for `worker/node_modules`.

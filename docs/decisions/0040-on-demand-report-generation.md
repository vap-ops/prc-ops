# ADR 0040 — On-demand report generation + stale-report reaper

**Status:** Accepted — 2026-06-12. Spec 39. Architecture-revision §3.3
(platform consolidation), executed in the ADR 0034 "atrophy" shape:
the fast path ships alongside the worker; Railway retires by becoming
unused, not by being removed.

## Context

PDF reports run on a third platform (Railway) polling every 5 minutes
— a PM waits up to 5 minutes for a report that takes seconds to build.
The pipeline is small and already cleanly factored in `/worker`
(claim RPC → fetch → PDFKit+Sarabun → upload → mark). Separately, the
known v1 gap: a crash mid-`processing` leaves the row stuck forever,
and the duplicate guard then blocks all future reports for that
project until manual SQL.

## Decision

### Fast path in the app (port, not move)

- The worker's pipeline is PORTED into `src/lib/reports/` (composition
  - job runner); `/worker` is byte-untouched (its Railway Watch Path
    would redeploy on any edit, and it remains the fallback).
- `generateReport` (existing action), after the existing RLS insert,
  runs the fast path: admin-client `claim_next_report()` (the same
  atomic RPC — FIFO, SKIP LOCKED, so app and worker can never
  double-build) → run the job → `complete`/`failed`. Any error path
  marks `failed` exactly like the worker; an unclaimed/raced row is
  simply left for the cron sweeper.
- **Failure degrades to today's behavior by construction:** if the
  fast path dies before claiming, the row stays `requested` and the
  worker builds it within 5 minutes. If it dies after claiming, the
  reaper (below) frees it.
- The Sarabun font ships as a base64 TS module (bundler-proof; OFL 1.1
  notice retained); `pdfkit` joins the app deps with
  `serverExternalPackages` so its internal font data files resolve
  from node_modules at runtime. The reports page pins
  `maxDuration = 60`.

### Stale-report reaper (closes the v1 gap)

- `public.reap_stale_reports(p_max_age_minutes int default 15)` —
  SECURITY DEFINER, EXECUTE revoked from public/anon/authenticated:
  flips `processing` rows whose `updated_at` is older than the cutoff
  to `failed` with a reaped error message. `failed` (not back to
  `requested`): the PDF may or may not have uploaded — a human
  regenerates deliberately; the duplicate guard is freed either way.
- pg_cron job `report-reaper` every 5 minutes (pure SQL — no HTTP, no
  Vault dependency; spec-32 scheduling precedent).

### Railway end-state

Nothing to do now. The worker keeps polling and will find nothing
(the fast path claims first). Operator MAY pause the Railway cron
whenever convenient; deleting the service is a future cleanup once the
fast path has weeks of history. Recorded measurement: `audit`-free —
just check Railway logs (always "No jobs") or reports rows whose
`updated_at - created_at` exceeds seconds.

## Rejected

- **Editing /worker to share code** — triggers Railway redeploys and
  couples the fallback to the experiment.
- **Supabase Edge Function port** — Deno port cost with no benefit
  over the in-app path; still a second runtime.
- **Reaping back to `requested`** — silent auto-retry of an unknown
  failure can loop forever and double-upload; `failed` is honest and
  visible (ล้มเหลว + regenerate button becomes available).

## Consequences

- Reports appear in seconds; the 12-s polling list usually shows
  `complete` on its first refresh.
- The duplicate guard can no longer wedge a project permanently
  (reaper frees it in ≤20 min worst-case).
- `pdfkit` (+types) in the main app; bundle impact is server-only.
- Recorded seams: deliverable-grouped report layout (existing
  backlog), multi-project reports, watermarking, Railway service
  deletion + worker/ directory removal (a future cleanup spec).

# Spec 147 — Data-fetch parallelization (waterfall fix)

## Problem

Detail pages run their Supabase reads in a **serial waterfall**: a root
entity fetch, then a fan of _independent_ child queries `await`ed one-at-a-time,
then a dependent tail (signed URLs / display names). The children depend only on
the root, not on each other — yet they run in series.

Measured on prod (free tier, Singapore region) for the WP-detail subset
(`scripts/measure-wp-hops.ts`): warm hop ~55–65ms; the 8-hop chain runs
**462ms serial → 197ms when the independent fan is batched (`Promise.all`) —
57% / ~264ms saved**. The real page is worse (adds signed-URL Storage call +
labor zone + RLS eval), so the absolute saving is larger. App server is
co-located with the DB (SEA), so these numbers are representative.

## Approach

Per page, extract the data-fetch into a server-only **loader** (mirrors the
existing `fetchLaborZoneData`, spec 46) that:

1. fetches the root entity first (keeps the `notFound()` guard),
2. runs every mutually-independent child query in **one `Promise.all`**,
3. runs the dependent tail (display names need approvals+requests; signed URLs
   need the photo rows) in a final `Promise.all`.

Behavior-preserving: same queries, same column lists, same results — only the
_scheduling_ changes. The page keeps its presentational derivations; it just
calls the loader instead of inlining the reads. `requireRole()` stays in the
page (it gates/redirects).

The non-functional contract (queries run concurrently) is locked by a unit test
that fails if the fan is re-serialized.

## Units

- **U1 — WP-detail** (`projects/[projectId]/work-packages/[workPackageId]`).
  Rank 1: SA hero screen, ~10 serial hops. THIS UNIT.
- U2 — project detail (`projects/[projectId]`). Rank 2.
- U3 — request detail (`requests/[requestId]`). Rank 3.
- U4 — DC portal (`portal`). Rank 4.

Ranks 5–8 (orders/[poId], deliveries/[deliveryId], schedule, projects hub)
are a follow-up spec once the pattern is proven.

## Out of scope

`<Suspense>` streaming (separate, bigger change — perceived latency), middleware
`getUser` cost, client-bundle/hydration, infra (Pro tier / cold-start). No schema,
RLS, or query-shape changes — pure scheduling.

## Verification

- `tests/unit/load-work-package-detail.test.ts` (RED first): asserts the loader
  (a) issues its independent queries concurrently (max in-flight ≥ 5, would be 1
  if serial) and (b) assembles the correct shape.
- `pnpm lint && pnpm typecheck && pnpm test` green.
- Re-run `scripts/measure-wp-hops.ts` for before/after wall-clock.
- Page renders unchanged (same data, same JSX).

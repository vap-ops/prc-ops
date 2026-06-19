# Spec 148 — Data-fetch parallelization, round 2 (ranks 5–8)

## Problem

The same serial-waterfall problem spec 147 fixed on the four hottest detail
pages remains on four lower-traffic ones. Same fix, smaller payoff.

## Approach

Identical to spec 147: per page, extract a server-only loader that fetches the
root then runs the mutually-independent reads in one `Promise.all`, with a
dependent tail where needed. Behavior-preserving. Concurrency locked by a
RED-first unit test (in-flight-counter supabase stub).

## Units

- **U1 — PO detail** (`requests/orders/[poId]`). Rank 5, ~5 serial → po ∥ members
  ∥ deliveries, then wp-by-id ∥ amounts (both need the members).
- **U2 — delivery detail** (`requests/orders/[poId]/deliveries/[deliveryId]`).
  Rank 6, ~6 serial → po ∥ delivery ∥ members ∥ deliveryRows ∥ proofRows all
  param-keyed (full fan), then proof signed URLs.
- **U3 — project schedule** (`projects/[projectId]/schedule`). Rank 7, ~4 serial
  → project ∥ work_packages ∥ deliverables, then dependency rows + critical path.
- **U4 — projects hub** (`projects`). Rank 8, ~3 serial → projects, then client
  names ∥ PM-only (suggested code + clients). Smallest payoff.

## Out of scope

Deferring the create-sheet data into the sheet (a separate optimization, not
this spec). `<Suspense>` streaming, middleware `getUser`, client bundle/hydration,
infra — all separate larger levers. No schema/RLS/query-shape changes.

## Verification

Per unit: `tests/unit/load-*.test.ts` (RED first) asserting concurrency + shape;
`pnpm lint && pnpm typecheck`; targeted test green. Full `pnpm test` after the
last unit.

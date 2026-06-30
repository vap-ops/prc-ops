# 242 — Parallelize the dashboard's independent reads (perf)

## Why

The ภาพรวม dashboard (`/dashboard`, the highest-traffic landing) opens its render by
reading, **serially**: the pending-approvals summary, the two bank-change counts, and
the live-projects list — four sequential round-trips — even though none depends on
another. Vercel Observability (2026-07-01) flagged `/dashboard` among the heaviest
routes; the serial round-trips add wall-clock latency that the DB compute tier does
not change (it's round-trip _serialization_, not query speed).

## What (scope)

Fire the three independent opening reads in a single `Promise.all`, and parallelize the
two bank-change counts within it (today `await a + await b`).

The `work_packages` read and the PM money `Promise.all` below it **stay sequential** —
they chain off `projectIds` / `wpIds`, a genuine data dependency. The money rollup block
is **untouched**.

Behavior-preserving: identical data in, identical `ProjectVM` output; only the
concurrency of the three independent reads changes.

## Non-goals (explicit)

- No change to the money math, the spend disjointness invariants, or any rendered
  output.
- Not touching the `projects → work_packages → money` dependency spine.
- WP-detail's serial tail (`/projects/[projectId]/work-packages/[workPackageId]`, the
  heavier route) is a separate follow-up, not this unit.

## Verify

`pnpm lint && pnpm typecheck && pnpm test` green. The dashboard's behavior is guarded by
the unchanged lib-helper unit tests (`rollupProgress`, `spend`, `labor/cost`); this unit
only reorders awaits, so no output changes. Manual: dashboard renders identically; the
three opening reads issue concurrently.

## References

- spec 100 (dashboard overview). The dashboard spend model (money disjointness) is
  untouched — see the money block in `src/app/dashboard/page.tsx`.

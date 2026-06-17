# Spec 139 — App-feel slice 3: optimistic UI (Unit 1 — worker active-toggle)

**Status:** Draft (2026-06-18). **Program:** the "feel like a native app" round (memory
`app-feel-roadmap`). Slice 3 of N — deliberately deferred until now because it mutates
payroll/labor data; it is done CAREFULLY, per-surface, payroll-safe surfaces only. App-only,
no DB change. Acceptance = operator eyeball on the live deploy + the helper/component tests.

## Why

The worker active-toggle on `/workers` is the canonical "web form" lag: tap → the button
disables → it awaits the `update_worker` RPC round-trip → `router.refresh()` repaints the whole
`/workers` RSC tree. For what is conceptually an instant on/off flip, the user sees a pause and a
flicker. This slice introduces **React 19 `useOptimistic`** (verified: React 19.2.4, zero
`useOptimistic` usage in the codebase today) so the tap flips instantly and rolls back on error —
the first of the ~37 `router.refresh()` round-trips the roadmap targets.

It is scoped to ONE surface on purpose. The worker active-toggle is the clean, payroll-safe pick:

- `WorkerRow` (`src/components/features/labor/worker-roster-manager.tsx`) is **already a Client
  Component**, so no server/client boundary change.
- The toggle reads `worker.active` for exactly three presentational things — the name's text
  colour, the `(ปิดใช้งาน)` status suffix, and the button label — and **nothing server-computed
  sits beside it** (the day-rate and note are static props). An optimistic client-only flip is
  therefore coherent; nothing on the row would lie.
- The action `updateWorker({ id, active })` returns the canonical `{ ok } | { ok: false; error }`
  shape and already `revalidatePath("/workers")`s, so the server stays the source of truth for the
  next navigation.

Labor-day logging (server-computed display fields) stays **pessimistic**; money/payment surfaces
are **never** optimistic. Those are explicitly out of scope (see Seams).

## Change (app-only, no schema)

`src/components/features/labor/worker-roster-manager.tsx` — `WorkerRow` only:

- Replace the toggle's `busy` state + success-only `router.refresh()` reconcile with React 19
  `useOptimistic` + `useTransition`:
  - `const [committed, setCommitted] = useState(worker.active)` — the post-mount truth, seeded
    once from the server prop.
  - `const [optimisticActive, setOptimisticActive] = useOptimistic(committed, (_, next: boolean)
=> next)`.
  - `const [isPending, startTransition] = useTransition()`.
- `toggleActive()` runs inside `startTransition(async () => { … })`:
  - `setOptimisticActive(next)` where `next = !committed` — the **instant** flip.
  - `await updateWorker({ id: worker.id, active: next })`.
  - on `ok` → `setCommitted(next)` — commit; when the transition ends the optimistic value falls
    through to `committed` (= `next`), so the row stays flipped with **no `router.refresh()`** (the
    round-trip flicker is gone).
  - on `!ok` → `toast.error(result.error)` — the optimistic value **auto-reverts** to `committed`
    (the un-flipped truth) when the transition ends; that snap-back IS the rollback, now explained
    through the slice-1 toast channel (the toggle previously failed **silently** — see note).
- The row renders from `optimisticActive` (NOT `worker.active`) for the name colour, the
  `(ปิดใช้งาน)` suffix, and the button label; the button is `disabled={isPending}` (prevents a
  double-fire race while the action is in flight).
- `useToast()` from `@/lib/ui/use-toast` (NO-OP outside a provider → the component stays
  renderable in tests; the provider is mounted once at the root layout). No new `'use client'`
  (already client). No styling/class change → `design-doctrine` stays green.

**Untouched** (out of scope this unit): the add-worker form, the per-row edit-save, the
`updateWorker` action, the `update_worker` RPC, and the page. `useRouter`/`router.refresh()` stay
imported and used by the add-form + edit-save — both are correctly pessimistic (they surface
server validation and need the new/edited row to appear).

**Note (rollback visibility):** the current `toggleActive` is `if (result.ok) router.refresh()` —
it does **nothing** on failure (silent). An optimistic flip that silently snaps back is more
confusing than the current silent no-op, so surfacing the error via `toast.error` is part of
making the optimistic rollback correct, not a separate feature.

## Tests

`tests/unit/worker-roster-manager.test.tsx` (extend; TDD). Mock `@/lib/ui/use-toast`'s `useToast`
to capture `error`:

- **optimistic flip (pending):** `updateWorker` returns a deferred (unresolved) promise — clicking
  `ปิดใช้งาน` flips the button label to `เปิดใช้งาน` and shows the `(ปิดใช้งาน)` status suffix
  **before** the action resolves; `updateWorker` called with `{ id: "w1", active: false }`; the
  toggle does **not** call `router.refresh()`.
- **commit:** resolving the action `{ ok: true }` leaves the row flipped (`เปิดใช้งาน`) after the
  transition settles.
- **rollback + toast:** `updateWorker` resolves `{ ok: false, error }` → the button reverts to
  `ปิดใช้งาน`, the `(ปิดใช้งาน)` suffix is gone, `toast.error` fired with the message, and no
  `router.refresh()`.

The existing 4 notes / DC-picker tests are unchanged — the add-form + edit-save still
`router.refresh()` (→ `mockRefresh`).

## Seams / out of scope

- The other ~37 `router.refresh()` sites — migrated per-surface in later units; only the toggle
  here.
- The `/workers` add-form + edit-save stay pessimistic (server validation + row appearance need
  the refresh). Revisit once the optimistic pattern is proven on device.
- Money/payment + labor-day logging surfaces are explicitly NOT optimistic candidates
  (server-computed / auditable).
- `committed` is seeded from the prop once at mount; an external change to this row's `active`
  (another device) is reflected only on a full reload — acceptable, since this toggle is the only
  in-app mutator of the row's `active`.

## Next slices (memory `app-feel-roadmap`)

3 optimistic UI — more payroll-safe surfaces (later units) · 5 motion (CSS list-enter via
`@starting-style`; route View Transitions are experimental → guarded spike only).

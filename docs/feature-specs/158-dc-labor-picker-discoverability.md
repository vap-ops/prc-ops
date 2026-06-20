# Spec 158 — DC labor picker discoverability (bridge)

Operator feedback (2026-06-20): "the DC's wage count flow is confusing — **site admins can't
find the DCs**." Root cause (read from code): the WP labor picker
(`LaborLogZone`) renders a **global, unscoped roster** — `fetchLaborZoneData`
selects every active `workers` row company-wide, ordered by name, with no
project/WP filter and no search. On a real roster (many DCs across many
contractors) the worker an SA needs is buried in a long flat list.

## Direction (operator, 2026-06-20)

"Designed for us. Eventually we want to promote self-governance." The **destination**
is the DC self-reporting their own attendance — the external partner portal
(spec 130, ADR 0051; `labor_logs.self_logged` already exists). See the
`self-governance-doctrine` memory. This spec is an explicit **bridge**: keep the
field unblocked today while the self-report flow is designed; do **not** invest in
a richer admin-logs-everyone surface than needed.

Bridge decomposes into three units. **This spec ships U1 only** (CLAUDE.md:
one unit per session). U2/U3 are sequenced below as open questions.

## U1 — worker search/filter in the picker (THIS UNIT)

Pure, client-side, **no schema / no role / no money change**. Turns the flat
global list into something findable.

- **`filterRoster(roster: GroupedRoster, query: string): GroupedRoster`** — new pure
  function in `src/lib/labor/group-workers.ts` (co-located with `groupRoster`).
  - Empty / whitespace query → roster returned unchanged.
  - Case-insensitive, Thai-aware (`localeCompare`-style lowercasing via
    `toLocaleLowerCase`). A trimmed query matches a substring of either a
    **worker name** or a **contractor (group) name**.
  - A **contractor-name** match keeps the whole group (all its workers).
  - Otherwise keep only the **workers** whose name matches; drop groups left empty.
  - The `own` ("ช่างบริษัท") group filters by worker name the same way.
- **UI** (`labor-log-zone.tsx`): a single search `<input>` above the roster,
  shown only when the roster is non-empty **and** not `locked`. Placeholder reuses
  the SSOT term — `"ค้นหาทีมงาน"`. Filtering is display-only: **selection state
  persists across filtering** (selection is keyed by worker id, independent of what
  the filter currently shows), so an SA can search → tick → search again → submit
  the full set. No new term in `labels.ts` (single use; inline).

## TDD

Failing tests first.

1. **vitest** `tests/unit/labor-group-workers.test.ts` (extend): `filterRoster` —
   empty query unchanged; worker-name substring match (case-insensitive); Thai
   substring match; contractor-name match keeps the whole group; non-matching
   groups dropped; `own` group filtered by name.
2. **vitest** `tests/unit/labor-log-zone.test.tsx` (extend): typing in the search
   box hides non-matching workers; a worker ticked **before** filtering is still
   submitted after the filter hides it (selection persists).

## Scope — IN

1. `filterRoster` pure function + its unit tests.
2. Search input wired into `LaborLogZone` + its component test.

## Scope — OUT (open questions — own units)

- **U2 — project-scope the picker.** Surface DCs relevant to _this_ project/WP
  (e.g. the WP's assigned contractor, or workers already logged on this project)
  ahead of / instead of the global list. Needs a data-model decision: `workers`
  has no project linkage today — scope by contractor, by prior `labor_logs` on the
  project, or add an explicit worker↔project link? Own spec.
- **U3 — SA adds a DC on the spot.** Today roster editing is **pm/super only**
  (`worker-roster-manager`), so an SA hits a dead end when the DC was never
  pre-seeded. Tension: `workers.day_rate` is money (no field grant) — an SA-create
  path must **not** expose/require a rate (PM sets it later). Touches role gates +
  RLS + the create RPC. Own spec, operator sign-off first.
- **Destination — DC self-report.** Spec 130 portal flow; the real fix. Tracked
  there, not here.

## Verify

- `pnpm lint && pnpm typecheck && pnpm test` — all green. (No DB change → no
  `db:push`/`db:test`.)
- Live: an SA on a WP with a long roster types a name/contractor into the search
  box → the list narrows; ticking a worker, searching again, then submitting logs
  every ticked worker.

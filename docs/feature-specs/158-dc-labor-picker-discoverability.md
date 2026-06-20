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

- **U2 — project-scope the picker.** ✅ **BUILT 2026-06-20 — see the U2 section below.**
  The data-model question is resolved: spec 160 U1 added an explicit
  `workers.project_id` (worker↔project link), so the picker scopes by it.
- **U3 — SA adds a DC on the spot.** Today roster editing is **pm/super only**
  (`worker-roster-manager`), so an SA hits a dead end when the DC was never
  pre-seeded. Tension: `workers.day_rate` is money (no field grant) — an SA-create
  path must **not** expose/require a rate (PM sets it later). Touches role gates +
  RLS + the create RPC. Own spec, operator sign-off first.
- **Destination — DC self-report.** Spec 130 portal flow; the real fix. Tracked
  there, not here.
- **Working-hours / time-in-out capture.** Operator (2026-06-20): "any would do as
  long as we can change later." **DECISION: stay day-only (`เต็มวัน`/`ครึ่งวัน`)
  now** — it is the DC=daily pay basis (see `prc-ops-pay-model` memory) and there is
  nothing to build. **Reversible with zero history rewrite:** later add nullable
  `time_in`/`time_out` to `labor_logs` (additive migration; existing rows stay valid,
  append-only/supersede intact) as **attendance evidence**, optionally deriving the
  fraction from hours. Pay stays daily either way. Revisit only when crews actually
  need hour-level proof (disputes / overtime).

## Verify

- `pnpm lint && pnpm typecheck && pnpm test` — all green. (No DB change → no
  `db:push`/`db:test`.)
- Live: an SA on a WP with a long roster types a name/contractor into the search
  box → the list narrows; ticking a worker, searching again, then submitting logs
  every ticked worker.

---

## U2 — project-scope the picker (THIS UNIT, 2026-06-20)

Now that [spec 160 U1](160-worker-ecosystem-foundation-stage-0.md) gave `workers`
an explicit **`project_id`**, the WP picker scopes by the WP's own project.

**Prioritize, don't hide (no-regression bridge).** Workers assigned to this WP's
project surface in an **"ในโครงการนี้"** section **first**; everyone else stays
reachable below, and U1 search still spans the whole roster. Because U1 shipped
**no backfill**, `project_id` is null for existing DCs → the in-project section is
empty at first and the picker renders **exactly like today**; it fills as PMs
assign DCs (`assign_worker_to_project`). This matches the operator's "bridge, do not
over-invest" direction — no richer admin surface, just ordering.

- **Pure `partitionRosterByProject(roster: GroupedRoster, inProjectIds: Set<string>):
{ inProject: GroupedRoster; others: GroupedRoster }`** in `group-workers.ts` —
  splits a grouped roster by worker-id membership; preserves group order +
  contractor names; drops a group left empty **within each partition**. No new type;
  reuses `GroupedRoster`.
- **`fetch-zone-data.ts`** — add a `projectId` param; select `workers.project_id`
  (not money — fine under the existing column grant); return
  `projectWorkerIds: string[]` (ids whose `project_id === projectId`) alongside
  `roster` + `rows`. The id list, not a roster-type change, keeps `RosterWorker`
  clean.
- **`labor-log-zone.tsx`** — new `projectWorkerIds?: string[]` prop (default `[]`).
  Partition the **already-filtered** view (search ∘ partition compose); render the
  in-project block under **"ในโครงการนี้"**, then the rest under **"ทีมงานอื่น"**
  — the second heading shows **only when** the in-project block is non-empty (else
  the rest renders heading-less = today). Selection stays keyed by worker id, so a
  tick survives both filtering and the partition.
- **Callers** — PM WP page (`loadWorkPackageDetail` threads `wp.project_id` into
  `fetchLaborZoneData`; `WorkPackageDetailData.labor` gains `projectWorkerIds`) +
  SA review page (passes `wp.project_id`); both pass `projectWorkerIds` to the zone.

No schema / role / money change (reads the U1 column).

### U2 TDD

1. **vitest** `labor-group-workers.test.ts` (extend): `partitionRosterByProject` —
   splits own + dc by id set; a mixed contractor group appears in **both**
   partitions with only its own members; empty set → in-project empty + others ===
   roster; group order/names preserved.
2. **vitest** `labor-log-zone.test.tsx` (extend): a project-assigned worker renders
   under **"ในโครงการนี้"** ahead of **"ทีมงานอื่น"**; **no** partition heading
   when `projectWorkerIds` is empty (today's look); a worker ticked in the
   in-project section submits.

### U2 Scope — OUT (still own units)

- **U3 — SA adds a DC on the spot** (role + RLS + create RPC; `day_rate` stays
  PM-only). Operator sign-off first.
- **Backfill** existing DCs' `project_id` (data-only; spec 160 follow-up).
- **Destination — DC self-report** (spec 130 portal; the real fix).

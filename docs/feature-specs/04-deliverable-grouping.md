# Feature Spec 04: Deliverable grouping in reports

## Status

Phase 1 (schema) **as-built** — shipped to prod 2026-05-31, recovered
from drift 2026-06-07. Phase 2 (data backfill) **implemented
2026-06-11** as a committed idempotent seed (see below) — applied to
the live DB once the operator approves the run. Phase 3 (PDF layout)
is **unstarted**.

This spec is documented after the schema phase landed in the live DB
without a committed spec. It is written from the recovered SQL plus
the originating v2 backlog entry
[`docs/v2-handoff.md` §4](../v2-handoff.md) ("Deliverable grouping in
reports"). No goals are invented beyond what those sources support.

Backed by [`ADR 0016`](../decisions/0016-deliverables-domain-table.md).
Read the ADR before extending this spec.

This spec **owns the feature-spec 04 number** because Phase 1 shipped
first. Any other in-flight work that was tentatively using `04-*` must
be renumbered to the next free slot (currently 05).

## Goal

Restore the customer-visible deliverable grouping (D01–D30) in PDF
reports. Source CSVs already carry the `DeliverableID` per work
package; v1 reports flatten that away. This unit re-introduces the
grouping at the data layer and surfaces it in output.

## Phases

The work splits into three independent phases. Each phase ships and
is reviewable on its own; phase N is a prerequisite for phase N+1.

### Phase 1 — Schema (DONE — as-built)

Shipped to the live DB on 2026-05-31. Two migrations, both committed
on `chore/recover-migration-drift` on 2026-06-07:

- `supabase/migrations/20260531000000_create_deliverables.sql` — the
  `public.deliverables` table (per-project unique `code`, ordered by
  `sort_order`), the `updated_at` trigger, and the four RLS policies
  (SELECT for sa/pm/super, INSERT/UPDATE for pm/super, no DELETE
  policy). RLS gated through `public.current_user_role()` (ADR 0011).
- `supabase/migrations/20260531000100_add_work_packages_deliverable_id.sql`
  — `public.work_packages.deliverable_id uuid` nullable FK
  (`ON DELETE SET NULL`) + `work_packages_deliverable_id_idx`.

**Verification on the live DB (read-only audit 2026-06-07):**

- `public.deliverables` exists with the columns above; `count = 0`.
- `public.work_packages.deliverable_id` exists, nullable;
  `count where deliverable_id is not null = 0`.
- All four policies, the trigger, and the two indexes are present.

For the full table / column / policy / trigger inventory, see ADR 0016. **Phase 1 needs no further work** — it is documented here for
completeness.

### Phase 2 — Data backfill (IMPLEMENTED 2026-06-11 — seed, not importer)

This spec originally sketched a CSV importer mirroring
`scripts/import-wp.ts` and deferred the contract to pickup time. At
pickup, the source turned out to be the operator's AppSheet master
**Google Sheet** (not per-project CSVs), and the dataset is fixed and
small (30 deliverables × 2 projects + 81 WP links applied identically
to both pilots). A general importer would be speculative tooling; the
chosen mechanism is the repo's existing seed precedent
(`supabase/seed.sql`, applied via `supabase db query --linked`):

- **`supabase/seed-deliverables.sql`** — committed, idempotent,
  generated 2026-06-11 from the sheet's tab 1 (deliverables master,
  D01–D30 + names + `DeliverableOrder` 1–30) and tab 2 (WP master,
  WP01–WP81 → DeliverableID).
- **Version guard:** the sheet's later tabs carry a different plan
  revision (a `D00` deliverable and ~124 WPs whose codes collide with
  different meanings). The live DB's WP names were verified against
  tab 2 (WP01 'งานปักฝัง' … WP81 'งานส่งมอบ', both pilots) before
  generation; the later tabs are excluded.
- **Idempotency:** deliverables upsert `on conflict (project_id, code)
do update set name, sort_order` — re-running after a sheet
  correction converges on the file (deliberate deviation from
  seed.sql's `do nothing`: names/order must track the file of
  record). The WP link UPDATE likewise converges `deliverable_id`.
- **Built-in verification:** the file ends with a count SELECT —
  expected `60 / 162 / 0` (deliverable rows / linked WPs / unlinked
  WPs).
- **Application:** `pnpm exec supabase db query --linked --file
supabase/seed-deliverables.sql` after the PR merges (same channel
  and context as seed.sql). Operator-approved run; re-runnable.

### Phase 3 — PDF layout (NOT STARTED)

Group the existing WP-per-row PDF output by deliverable (header per
group, ordered by `deliverable.sort_order`, "Ungrouped" bucket for
WPs whose `deliverable_id is null`).

Not specified in detail here — when the unit is picked up, the
PDFKit changes are spec'd against current report fidelity rules.

## Out of scope (for this entire feature)

- Deliverable-level **attributes** beyond `code`, `name`, `sort_order`
  (Amount, status, dates, owner, …). They have a natural home in
  `public.deliverables` when their owning features are spec'd, but
  none of them are part of "deliverable grouping in reports".
- A `deliverables` **admin UI**. Authoring is via importer + SQL
  until a feature requires more.
- Multi-project / cross-pilot rollups. v1's "report" is one project.

## Verification (per phase)

### Phase 1 (already passed; logged here for the record)

- [x] `to_regclass('public.deliverables') is not null`.
- [x] All four RLS policies present on `public.deliverables`.
- [x] `work_packages.deliverable_id` column exists, type uuid,
      nullable, FK to `public.deliverables(id)` with
      `on delete set null`.
- [x] `work_packages_deliverable_id_idx` exists on
      `(deliverable_id)`.
- [x] `deliverables_set_updated_at` trigger fires `set_updated_at()`
      before update.
- [x] No DELETE policy on `public.deliverables` — `delete` issued
      through an authenticated session affects 0 rows.

### Phases 2 and 3 — define when picked up.

## Known gaps

- **The `deliverables` table is empty on the live DB.** No row links
  back from any WP. Grouping has zero visible effect until the Phase 2
  seed is applied (file committed 2026-06-11; gap closes at apply
  time — verify with the seed's built-in count SELECT, expect
  60 / 162 / 0).
- **No pgTAP coverage for Phase 1.** The shipped migrations have no
  paired test file under `supabase/tests/database/`. Worth adding
  when the importer (Phase 2) wants to assert constraint shape from
  its tests.

## References

- [`ADR 0016`](../decisions/0016-deliverables-domain-table.md) — the
  schema decision; mandatory reading before touching phases 2 or 3.
- [`docs/v2-handoff.md` §4](../v2-handoff.md) — originating v2
  backlog entry.
- ADR 0011 — `current_user_role()` (the RLS helper Phase 1's
  policies call).
- ADR 0013 — Role-level access model (the access model Phase 1's
  policies follow).
- ADR 0014 — WP CSV import contract (the shape Phase 2's importer
  should mirror).

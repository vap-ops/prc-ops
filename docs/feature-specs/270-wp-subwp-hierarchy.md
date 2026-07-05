# Spec 270 — Two-level work packages: งาน (group WP) + งานย่อย (sub-WP)

**Status:** U1–U2b + U6 SHIPPED; **PRC-2026-004 imported live 2026-07-06** (378 rows: 47 งาน + 331
งานย่อย, fixture `270-final-grouping-2026-07-06.tsv`) **then renumbered hierarchically** (operator
decision: งาน `WP-01`…`WP-47` by list order, งานย่อย `WP-01-01`… within group; fixture
`270-renumber-2026-07-06.tsv`; pure recode — all joins are by uuid). Next: U3 grouped roster + labels,
U4, U5.
**ADR:** [0074-wp-subwp-hierarchy.md](../decisions/0074-wp-subwp-hierarchy.md)
**Origin:** operator directive, project PRC-2026-004 (TFM โพธิ์ทอง ลพบุรี). The site team restructures the
flat 262-WP list into ~39 groups. Sample mapping (incomplete): [270-sample-grouping-v0.tsv](270-sample-grouping-v0.tsv).

## 1. Problem

`work_packages` is flat. Real plans have two levels: a งาน ("อาคาร roof steel", "tile work") made of
sequential งานย่อย steps (prime-paint → topcoat → assemble). Today the 262 rows ARE the steps; the app
has no grouping, so rosters are 262-row walls and progress per งาน is invisible.

## 2. Decisions (operator-confirmed 2026-07-06)

| #   | Decision                                                                                                                                                                                                                                                               |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D1  | **Same-table hierarchy.** `work_packages.parent_id` self-FK + `is_group`. Parents (งาน) are first-class WP rows; existing 262 rows become งานย่อย children. Depth exactly 2.                                                                                           |
| D2  | **Naming:** parent = **งาน** (takes the plain WP label), child = **งานย่อย**. Labels via `labels.ts` SSOT; existing WP-labeled surfaces relabel to งานย่อย where they show the 262-level rows.                                                                         |
| D3  | **Codes: full renumber from the final list.** The import applies new codes to everything. Existing rows are matched by **OldCode** (template column), never by name.                                                                                                   |
| D4  | **Money stays on งานย่อย.** Supply plans, PRs/POs, stock issues, `wp_labor_costs`, GL dims, wp_profit — all keep binding to leaf rows. Parent-level money = read-only aggregation in views (later unit).                                                               |
| D5  | **Photos + editable status live ONLY on งานย่อย.** Parents never hold photos; parent status is derived, never hand-set.                                                                                                                                                |
| D6  | **Grouping is mandatory** (operator overrode the draft): after import, every งานย่อย has a parent. DB CHECK is added and VALIDATEd only **after** the prod import lands (U6) — adding it earlier would fail daily status updates on the 262 currently-parentless rows. |
| D7  | Engineers get a **template** (pre-filled from live data) to complete before import; import runs dry-run-first.                                                                                                                                                         |

## 3. Data model (U1, additive)

```sql
alter table work_packages
  add column is_group boolean not null default false,
  add column parent_id uuid references work_packages(id);   -- ON DELETE default (NO ACTION): parent undeletable while children exist
create index on work_packages (parent_id) where parent_id is not null;
```

Trigger-enforced invariants (BEFORE INSERT/UPDATE on `work_packages`):

- `parent_id` → target row must be `is_group = true`, same `project_id`, and itself have `parent_id IS NULL` (depth cap 2).
- `is_group` rows must have `parent_id IS NULL` (a งาน cannot be someone's child).
- `is_group` is immutable after insert (no leaf↔group flips once history can exist).
- Groups cannot carry photo/money history: `photo_logs` BEFORE INSERT trigger rejects group WPs; the
  money write paths (supply-plan line RPCs, PR create, `wp_labor_costs` writes, stock issue) gain a
  `is_group` rejection. work_package_members / work_package_dependencies / priority stay leaf-only
  (RPC guards), parents excluded from the worklist priority lens.
- Manual status paths (`update status` action, `set_work_package_hold`, approve/rework RPCs) reject
  `is_group` rows.

### Status rollup (derived, materialized in `status`)

AFTER UPDATE OF status / INSERT / DELETE / UPDATE OF parent_id on leaf rows → recompute the (old and
new) parent's `status` inside the same transaction (definer helper; the guard trigger allows the write
when it comes from the rollup fn). Truth table over the child set S:

| condition                                                                   | parent status |
| --------------------------------------------------------------------------- | ------------- |
| S empty                                                                     | `not_started` |
| all complete                                                                | `complete`    |
| all not_started                                                             | `not_started` |
| all on_hold                                                                 | `on_hold`     |
| anything else (mixed, or any `in_progress` / `pending_approval` / `rework`) | `in_progress` |

Parents never take `pending_approval`/`rework` — review states are per-งานย่อย, where the photos are.
Rollup writes bypass `updated_at`-based "user touched this" semantics nowhere special — plain update.

## 4. Import + template (U2)

**Template columns (TSV/CSV/Google Sheet):** `SubOf | WP | OldCode | ชื่องาน`

- One row per งาน (SubOf empty, OldCode empty) and per งานย่อย (SubOf = parent's `WP` code).
- `WP` = the NEW code (final renumber, D3). `OldCode` = current live code for existing rows — the join
  key; empty ⇒ row is created new.
- U2 ships a **template generator**: exports the current project's rows with `OldCode` pre-filled
  (name, current code) so engineers only fill `SubOf`/`WP`/new names — mistake-proof against D3's
  rename+renumber join problem.

**Validation (dry-run report; ALL must pass before apply is offered):**

1. `WP` codes unique; `OldCode` unique where present; every `OldCode` exists in the project; every
   existing project WP appears exactly once as an `OldCode` (no silent drops — removals are a separate
   explicit feature, not part of this import).
2. Every non-group row has `SubOf` (D6) and `SubOf` references a งาน row defined in the same file.
3. No งาน row has `SubOf` (depth 2); no งาน row carries an `OldCode` of a leaf that has photo/money
   history (a leaf may not become a group).
4. Diff preview: groups to create, rows renamed, rows re-coded, parent assignments — counts + samples.

**Apply (single transaction, `super_admin`, audit-logged):** create งาน rows → set `parent_id` on all
leaves → apply renames → apply renumber (two-phase code swap to dodge unique collisions) → rollup
recompute for every parent. Re-runnable: matching by OldCode makes the import idempotent-by-content.

Sample v0 verification (this spec's fixture, 2026-07-06): 301 rows = 39 งาน + 262 งานย่อย; all 262 live
codes covered; 0 structural errors; **5 ungrouped leaves (WP-020, 021, 190, 242, 257) = blockers under
D6 that the final list must resolve**; 1 name diff vs live (WP-001 "ทำทำ" typo — final list should carry
the clean name); group sizes 1–48 (six single-child groups are legitimate).

## 5. UI units

- **U3 grouped roster:** project WP list = งาน sections (rollup status badge, n/m งานย่อย complete)
  with งานย่อย rows inside; labels.ts gains the งาน/งานย่อย SSOT pair; relabel swept across surfaces
  that show leaf rows (WP detail header, review queue, pickers, daily report, portal).
- **U4 งาน detail page:** children list + rollup + read-only aggregates (spend/labor totals from leaf
  bindings; no new money writes). WP-centric principle now applies per level: งานย่อย detail keeps
  photos/materials/labor; งาน detail = oversight.
- **U5 exclusion sweep:** every WP picker (supply plan, PR form, photo upload target, review queue,
  worklist, schedule actuals, client portal progress denominator, daily report) offers/counts
  **leaves only**. DB guards (U1) make violations impossible; U5 makes UI not offer them. Tests pin each.
- **U6 (post-prod-import, AMENDED as-built):** the planned global `CHECK ... VALIDATE` is impossible
  while legacy projects (PRC-2026-003/005) hold parentless leaves — even NOT VALID fires on their daily
  status UPDATEs. Shipped instead (`072500`): a FORWARD guard arm in `wp_hierarchy_guard` — once a
  project has งาน rows, inserting a parentless งานย่อย is rejected (23514); legacy projects adopt the
  rule automatically when their own import creates งาน rows. `072600` follow-up: import phase C creates
  new งานย่อย WITH parent (the old parentless-then-parent two-step trips the new guard mid-re-import).
  New-งานย่อย creation UI requires a parent pick from U3 on.

## 6. Testing

- pgTAP (new `270-wp-subwp.test.sql`): depth cap, cross-project parent rejection, is_group immutability,
  photo-on-group rejection, money-on-group rejection, manual-status-on-group rejection, rollup truth
  table incl. empty group + child re-parenting + child delete, CHECK validation behavior (U6).
- vitest: template parse/validate module (pure — the dry-run ruleset above), diff preview builder,
  grouped roster view-model, rollup badge rendering, labels SSOT pins.

## 7. Out of scope / later

- Parent-level planned dates, dependencies, and schedule grouping (timeline by งาน) — later spec.
- wp_profit / dashboard aggregation at งาน level — read views, later spec.
- Deleting/merging งานย่อย with history (import forbids silent drops; needs its own flow).
- Other projects' adoption (template+import are project-scoped and reusable as-is).

## 8. Open items

1. **FINAL grouping list** (operator/site team) — resolves the 5 ungrouped + WP-001 typo + any renames;
   arrives as the U2 template.
2. Schema-lane slot for U1: claim `20260813072200+` after spec 269's `072100` lands (LANES.md).
3. Prod apply of the import = operator-gated (destructive-adjacent: mass renumber).

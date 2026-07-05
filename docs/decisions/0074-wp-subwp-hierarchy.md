# ADR 0074 — Two-level work packages: งาน groups over งานย่อย leaves (same-table hierarchy)

**Status:** Accepted (operator, 2026-07-06) · **Spec:** [270](../feature-specs/270-wp-subwp-hierarchy.md)

## Context

Work packages are flat. Site reality is two-level: a งาน (e.g. roof steel structure) decomposes into
sequential งานย่อย steps. PRC-2026-004's team restructured their 262-WP list into ~39 groups and the
operator directed the app to support it: photos + hand-edited status live on งานย่อย only; งาน status is
derived; the whole list gets renumbered from the incoming final sheet.

## Decision

1. **Hierarchy inside `work_packages`** — `parent_id` self-FK + `is_group`, depth exactly 2, triggers
   enforcing: parent must be a same-project group; groups are never children; `is_group` immutable;
   groups reject photos, money bindings, membership/dependencies/priority, and manual status writes.
2. **Existing rows become the leaves.** All history (photos, approvals, materials, labor, GL dims)
   already binds to them — zero data migration. Groups are new rows.
3. **Parent status is materialized-derived**: recomputed by trigger from the child set
   (all-complete→complete · all-not_started/empty→not_started · all-on_hold→on_hold · else in_progress;
   `pending_approval`/`rework` never appear on groups). Stored in the same `status` column so every
   existing reader keeps working.
4. **Money stays leaf-level** (operator decision). Group-level money = read-only aggregation later.
5. **Grouping mandatory** after the one-time import (operator decision): `CHECK (is_group OR parent_id
   IS NOT NULL)` added + validated only post-import — earlier would break status updates on live
   parentless rows.
6. **Naming**: parent = งาน, child = งานย่อย (labels.ts SSOT). **Codes**: full renumber from the final
   sheet; imports match existing rows by an explicit `OldCode` template column (rename+renumber in one
   pass is only safe with an explicit join key).

## Alternatives rejected

- **Separate `wp_groups` table** — leak-proof by construction, but parents couldn't reuse WP machinery
  (status enum, dates, dependencies) without duplication, and one shared code sequence across two
  tables needs cross-table uniqueness hacks. Parents are first-class งาน in the operator's model.
- **Grouping as a facet/category (ADR 0066 machinery)** — these groups are project-local plan
  structure, not taxonomy; and rollup status/roster nesting don't fit facets.
- **Renumber-by-sheet-order (no OldCode)** — magic ordering; breaks the moment the final sheet reorders
  rows or renames while renumbering. Explicit join key wins.

## Consequences

- Every WP picker/list must exclude groups (DB guards guarantee correctness; UI sweep = spec 270 U5).
- Client-portal progress %, worklist, review queue, daily report count leaves only — denominators
  unchanged in effect since groups add no countable work.
- WP single-category rule (memory doctrine) applies to leaves; groups may carry `category_id` NULL.
- Future: parent planned dates/dependencies, งาน-level profit views, timeline grouped by งาน.

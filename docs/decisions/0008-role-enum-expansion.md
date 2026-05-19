# ADR 0008: Role Enum Expansion

## Status

Accepted — 2026-05-19

## Context

The deployed `user_role` enum contains 3 values: `site_admin`, `pm`, `super_admin`. CLAUDE.md and the PRC org model require 8 roles covering every job in the company, even though only `site_admin` and `project_manager` receive features in v1. Roles without v1 features will be redirected to `/coming-soon` after LINE auth.

The deployed `pm` value uses an abbreviated name. The org model and CLAUDE.md use full names (`project_manager`). Allowing abbreviations to leak into the schema creates ambiguity when adding the 6 new roles and complicates future RLS policies that match on role.

## Decision

Expand `user_role` from 3 to 8 values, renaming the existing `pm` to `project_manager` in the same migration. Final enum:

- `site_admin` — v1
- `project_manager` — v1 (renamed from `pm`)
- `super_admin` — retained, no v1 features
- `project_coordinator` — v2
- `procurement` — v2
- `technician` — v2 or v3
- `hr` — v3
- `subcon_manager` — v3
- `accounting` — v3

The `super_admin` value is retained because it already exists and may be in use by seeded accounts. It does not appear in CLAUDE.md's role list because it is an operational role (platform owner), not a PRC job function.

### Rename approach

PostgreSQL supports `ALTER TYPE user_role RENAME VALUE 'pm' TO 'project_manager'` since version 10. The rename does not require updating existing rows — the underlying integer storage stays the same; only the label changes.

The 6 new values are added with `ALTER TYPE user_role ADD VALUE`.

### Ordering

PostgreSQL enum values are ordered by addition order. New values are appended after `super_admin`. Order is not load-bearing in any current code; if ordering becomes significant later, a separate ADR will recreate the type in the desired order.

## Consequences

**Positive**

- Schema matches CLAUDE.md and the documented org model. No "what does pm mean" ambiguity for future contributors or Claude Code sessions.
- RLS policies can reference role names that match the codebase's role display logic and the `/coming-soon` redirect map.
- Adding the 6 unserved roles now (with zero v1 features) costs near-nothing and prevents a larger migration when v2 begins.

**Negative**

- Any existing code, seed data, or test fixture referencing `'pm'` as a string literal breaks after the rename. Migration must be accompanied by a grep-and-replace across the repo and a regeneration of `database.types.ts`.
- `ALTER TYPE … ADD VALUE` cannot run inside a transaction block on some PostgreSQL versions. The migration is split into two files if Supabase's migration runner requires it.

**Neutral**

- The `users.role` column default remains `site_admin` (set by the `auth.users` insert trigger per ADR 0007). No change to that trigger.

## Open questions

None blocking. Future ADRs may revisit enum value ordering, the role of `super_admin`, or splitting roles further (e.g., separating PM from senior PM).

## References

- ADR 0007 — Users and Auth (defines the `auth.users` → `public.users` trigger and default role)
- `CLAUDE.md` — Roles section
- Supabase migrations directory: `supabase/migrations/`

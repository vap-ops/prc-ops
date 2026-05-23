# ADR 0013: Project access model — role-level only for v1

## Status

Accepted — 2026-05-24

Governs the access scoping of `projects` and, transitively, every domain
table that will hang off it in v1 (`work_packages`, `photo_logs`, future
`dc_entries`). Those tables will follow the same role-level model unless
and until membership is introduced — see "Upgrade path" below.

## Context

`projects` is the root domain table for v1. Two access models were on the
table during the design session that produced this ADR:

- **(A) Per-project membership.** A `project_members` join table
  (`user_id`, `project_id`, optional role-on-project) gates every domain
  query. RLS policies on `projects` / `work_packages` / `photo_logs`
  consult membership to decide what each user sees. Maximum isolation —
  two PMs assigned to different projects cannot see each other's data.
- **(C) Role-level only.** Access is determined entirely by
  `public.users.role`. Any `site_admin` / `project_manager` /
  `super_admin` sees every project; nobody else sees any project. Writes
  to `projects` are restricted to `super_admin`. No membership join table.

Model (B) — a hybrid where some roles bypass membership — was discussed
and discarded as the worst of both: it requires the membership table
plus carve-outs, with no isolation gain over (A) once carve-outs exist.

The v1 pilot is two construction projects (TFG Lam Sonthi and
TFG Kham Muang) and a small set of trusted users on the operator's team.
Project-level isolation between PMs is not a requirement at this scale.
The deciding factors are:

- **No isolation requirement in v1.** All v1 users are internal to the
  operator's team and trusted across both pilot projects. There is no
  external party, no subcontractor account, no customer-facing surface.
- **Schedule.** Membership ships at least one extra table, one extra
  domain to model in RLS, and a UI / admin flow to manage assignments.
  v1 is bounded; the photo → approval → PDF flow has to land before the
  pilot starts. Membership work delays that without buying anything the
  pilot needs.
- **The trigger for membership is known and falsifiable.** As soon as
  the operator must onboard a user who should see one project but not
  another — an external PM, a subcontractor manager, a customer review
  account — role-level becomes inadequate and membership is required.
  v1 has no such user. The "Consequences" section makes this explicit
  so reviewers know exactly when to revisit.

## Decision

v1 uses **role-level access only** for `projects` and every domain
table that hangs off it. RLS policies on these tables gate exclusively
on `public.current_user_role()` (the ADR 0011 helper).

Concrete shape for `projects`:

- **SELECT** allowed when `public.current_user_role() in
('site_admin', 'project_manager', 'super_admin')`. Anyone else (any
  other role, including `visitor`, or no `public.users` row at all) sees
  zero rows.
- **INSERT** allowed when `public.current_user_role() = 'super_admin'`.
- **UPDATE** allowed when `public.current_user_role() = 'super_admin'`,
  in both `using` and `with check` so a super_admin cannot transition a
  row out of their own visibility.
- **No DELETE policy.** Projects are archived via the `status` column
  (`status = 'archived'`), never hard-deleted via the app. The absence
  of a DELETE policy is load-bearing: with RLS enabled and no matching
  policy, every DELETE — including those issued by super_admin through
  the application path — affects zero rows. Hard deletes, when ever
  needed, require a service-role context (an explicit migration or
  console action) and a paper trail in the audit log.

The same shape will apply to `work_packages` and `photo_logs` when
those units land. Their policies will read:
`public.current_user_role() in ('site_admin', 'project_manager',
'super_admin')` for read paths, and tighter role checks for writes
appropriate to the table. No table in this scoping chain self-joins
`public.users` (ADR 0011 fixed that defect once; future policies must
not re-introduce it).

The `project_status` enum (`'active', 'on_hold', 'completed',
'archived'`) is created with the table, but **no v1 logic gates on it**.
It is accurate metadata that the UI may surface (e.g. an "archived"
badge), and it is the future home of the archive operation. Writing
logic that depends on `status` is deferred until the feature that needs
it is on the table.

## Upgrade path — membership without restructuring

When membership is required, no schema restructure is needed:

1. Add a `project_members` table:

   ```sql
   create table public.project_members (
     project_id uuid not null references public.projects(id) on delete cascade,
     user_id    uuid not null references public.users(id)    on delete cascade,
     role_on_project text,
     created_at timestamptz not null default now(),
     primary key (project_id, user_id)
   );
   ```

2. **Tighten** the existing role-level SELECT policy on `projects`,
   `work_packages`, `photo_logs` from a pure role check to a role check
   plus a membership subquery — e.g.

   ```sql
   using (
     public.current_user_role() = 'super_admin'
     or exists (
       select 1 from public.project_members m
       where m.project_id = projects.id and m.user_id = auth.uid()
     )
   )
   ```

3. Existing data needs no migration: every current row remains in
   `projects` and `work_packages`; only access tightens. The operator
   backfills `project_members` for the existing internal users.

4. The `public.current_user_role()` helper stays in use for the
   `super_admin` carve-out — no recursion concern, because the new
   subquery hits `project_members`, not `public.users`.

This ADR commits to **not building anything that would obstruct the
above** — in particular:

- No assumption anywhere in the codebase that role-level visibility is
  the permanent contract. Application code reads from RLS; tightening
  the policy is invisible to callers.
- No application-level filtering that duplicates RLS. RLS is the only
  layer that decides "can this user see this project". When the policy
  tightens, the application keeps working.
- No global cache of "all projects" keyed on session role. The role
  helper is per-statement; the future membership subquery is too.

## Consequences

**Positive**

- One table, three policies, no membership management surface. The
  photo → approval → PDF flow can be implemented against `projects` and
  `work_packages` directly without first building user assignment.
- Recursion-safe by construction: every policy uses
  `public.current_user_role()`, the canonical helper from ADR 0011.
  Future domain tables inherit the pattern.
- The `status` enum is in place from the start, so adding the archive
  feature later is a UI / mutation change, not a schema migration.

**Negative**

- **No cross-project isolation.** Two PMs on different projects each
  see the other's project. Acceptable for v1's controlled pilot
  (internal team, two trusted projects). **Not acceptable** once any
  of the following is true: an external PM is onboarded, a
  subcontractor account is granted PM-level access, a customer-review
  account is added, or the project count grows past the operator's
  team's working memory. The appearance of any of these is the
  trigger to implement the membership upgrade above.
- Hard deletes of projects require service-role access (a migration or
  manual SQL). Intentional — the app is archive-only — but worth
  knowing during incident response.

**Neutral**

- `project_status` enum exists but no v1 code paths branch on it. Its
  value is being able to record the state accurately now (`active`,
  `archived`) so the data is correct when the archive UI ships.
- `code` is human-assigned (`PRC-YYYY-NNN` convention) rather than
  database-generated. The two pilot codes (`PRC-2026-001`,
  `PRC-2026-002`) are provisional until the operator confirms the real
  project numbers. The unique constraint on `code` prevents duplicates.

## Open questions

None blocking.

- **When does membership land?** Triggered by external/non-team
  account onboarding, not by a calendar date. The operator decides.
- **Does the `status` enum need a `paused` value separate from
  `on_hold`?** v1 says no — they're synonyms; pick `on_hold`. Revisit
  only if a real workflow distinction emerges.

## References

- ADR 0005 — v1 scope (the photo → approval → PDF flow this ADR
  unblocks)
- ADR 0007 — Users and Auth (the `public.users` table that
  `current_user_role()` reads)
- ADR 0010 — Visitor default role (new signups have role `visitor`
  and therefore see zero projects until promoted)
- ADR 0011 — RLS role-check helper (mandatory primitive for every
  policy this ADR establishes; no self-joins on `public.users`)

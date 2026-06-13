# Spec 80 — Project team / supervisors

**Status:** Not started.
**Related:** Spec 79 (project metadata + `project_lead_id` single lead), ADR 0032/0033 (`work_package_members` precedent — the exact table shape), ADR 0013 (project access), ADR 0011 (RLS hygiene + eval-once), Spec 58/79 (settings page).

## Why

Spec 79 added `projects.project_lead_id` — the **single** person-in-charge. A project also has a **team**: the supervisors/staff working it. The operator chose (2026-06-13) to capture this as a list, split out of spec 79 because it is a join table with its own add/remove UI.

## Scope

A `project_members` join table (mirrors `work_package_members`, ADR 0032): one row per (project, user). **Mutable** — members are added and removed (unlike append-only logs); PM/super manage, staff read. The single `project_lead_id` (spec 79) is unchanged and distinct (a lead need not be a member, and vice-versa).

### Database — migration `20260626000300_create_project_members.sql`

```sql
create table public.project_members (
  project_id uuid not null references public.projects(id) on delete cascade,
  user_id    uuid not null references public.users(id),
  added_by   uuid not null references public.users(id),
  added_at   timestamptz not null default now(),
  primary key (project_id, user_id)
);

create index project_members_user_idx on public.project_members (user_id);

alter table public.project_members enable row level security;
revoke all on public.project_members from anon, authenticated;

grant select on public.project_members to authenticated;
grant insert (project_id, user_id, added_by) on public.project_members to authenticated;
grant delete on public.project_members to authenticated;

-- Policies use the EVAL-ONCE wrapped form from the start ((select …)) — a bare
-- current_user_role()/auth.uid() fails pgTAP file 40 (the eval-once pin).
create policy "project members readable by staff"
  on public.project_members for select to authenticated
  using ((select public.current_user_role())
         in ('site_admin', 'project_manager', 'super_admin'));

create policy "project members insert by pm or super_admin"
  on public.project_members for insert to authenticated
  with check ((select public.current_user_role()) in ('project_manager', 'super_admin')
              and added_by = (select auth.uid()));

create policy "project members delete by pm or super_admin"
  on public.project_members for delete to authenticated
  using ((select public.current_user_role()) in ('project_manager', 'super_admin'));
```

No SECURITY DEFINER RPC: PM/super write directly under their authenticated session (they hold the grant + policy), the same as the masters' create path. `ON DELETE CASCADE` on `project_id` (a deleted project — service-role only — drops its membership); `user_id`/`added_by` have no cascade (users are not deleted).

### pgTAP — file `43-project-members.test.sql`

- table + composite PK + `user_id` index + RLS enabled; column-scoped grants (insert on the 3 cols, delete granted); no policy uses a BARE `current_user_role()`/`auth.uid()` (eval-once — assert the wrapped form, mirrors file 40's check scoped to this table).
- Role sims: PM/super INSERT (added_by pinned to caller) + DELETE; `site_admin` INSERT/DELETE denied (42501); staff SELECT; visitor sees none; anon denied.
- Duplicate (project,user) insert → 23505 (PK).

## Application

- **`src/app/sa/projects/[projectId]/settings/actions.ts`**: `addProjectMember(projectId, userId)` and `removeProjectMember(projectId, userId)` — PM/super gate (re-check role), direct insert/delete, `added_by = user.id`, revalidate the project + settings pages. Validate uuids; ignore duplicate (23505 → treat as already-added, ok).
- **Settings form** (`settings-form.tsx`): a **ทีมงาน** section under the project-lead picker — current members listed with a remove (✕) button each, plus a "เพิ่มสมาชิก" picker offering staff not already on the team. Add/remove are immediate actions (like the inline client-add), not batched into the main save. Members + the staff roster come from the page.
- **Page** (`page.tsx`): fetch `project_members` for the project (admin client for the member display names, like the lead), pass `members: {id, name}[]` to the form.
- **Display** — project detail header (`/sa/projects/[id]`): a `ทีมงาน:` line listing member names (or the count if many) when the team is non-empty. Not on the PDF report or the list (header only, v1).

## Authorization

Settings page gate unchanged (PM/super). project_members: staff SELECT, PM/super INSERT/DELETE. Procurement excluded (back-office, like clients).

## Tests

- pgTAP file 43 (above).
- Unit: a small `validateProjectMember`-style uuid guard is covered by the existing `isValidUuid`; the add/remove actions are thin RLS relays (no new pure logic), so no new unit test file is required beyond the action-level checks. (If a member-list helper emerges, TDD it.)

## Verification checklist

1. `pnpm lint && typecheck && test` green; `pnpm build` green.
2. `pnpm db:push` applies the one migration (operator-gated); `pnpm db:types` reconciles; `pnpm db:test` green (file 43).
3. PM adds + removes a team member on a project; the header shows ทีมงาน; SA cannot reach settings; a duplicate add is a no-op.

## Out of scope (seams)

- Per-member role/title on the team (just membership for v1).
- Team on the WP level (work_package_members already exists, dormant — ADR 0033).
- Showing the team on the PDF report or the project list (header only).
- Notifying a user when added to a project.

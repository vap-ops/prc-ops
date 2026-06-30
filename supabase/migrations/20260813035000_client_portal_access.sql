-- Spec 233 / ADR 0067 — temporary, scoped, read-only client portal:
-- the binding/state table, the single-use claim-token table, the live-access
-- predicate, and the dedicated client read arms. RPC writers land in 036000.

-- The binding + temporary state: one client user → one project, with the
-- valid-until (expires_at) and an early-revoke stamp. Live access ≔ a row exists
-- with revoked_at IS NULL AND (expires_at IS NULL OR expires_at > now()).
create table public.client_portal_access (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references public.users(id),
  project_id  uuid not null references public.projects(id) on delete cascade,
  granted_by  uuid not null references public.users(id),
  granted_at  timestamptz not null default now(),
  expires_at  timestamptz,
  revoked_at  timestamptz,
  revoked_by  uuid references public.users(id),
  unique (user_id, project_id)
);
create index client_portal_access_project_idx on public.client_portal_access (project_id);

-- The single-use claim token. Two clocks: the link dies after 14 days (from
-- created_at) or one use; the *access* lives until access_expires_at (stamped
-- onto the access row at claim). Only the SHA-256 digest is stored — a DB/backup
-- read yields nothing replayable (mirrors contractor_invites, mig 20260813024000).
create table public.client_invites (
  id                uuid primary key default gen_random_uuid(),
  token_hash        text not null unique,
  project_id        uuid not null references public.projects(id) on delete cascade,
  access_expires_at timestamptz not null,
  created_by        uuid not null references public.users(id),
  created_at        timestamptz not null default now(),
  claimed_at        timestamptz,
  claimed_by        uuid references public.users(id)
);

alter table public.client_portal_access enable row level security;
alter table public.client_invites        enable row level security;
-- Zero blanket privileges; the explicit grants below re-add only SELECT. All
-- writes go through the SECURITY DEFINER RPCs in 036000 (never direct DML).
revoke all on public.client_portal_access from anon, authenticated;
revoke all on public.client_invites        from anon, authenticated;

-- Live-access predicate. SECURITY DEFINER so the client read arms can call it
-- without a recursive grant; the body reads only the caller's own rows. NULL
-- caller → exists() false → no access (safe direction).
create function public.client_has_live_access(p_project uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.client_portal_access a
    where a.user_id = (select auth.uid())
      and a.project_id = p_project
      and a.revoked_at is null
      and (a.expires_at is null or a.expires_at > now())
  );
$$;
revoke execute on function public.client_has_live_access(uuid) from public, anon;
grant execute on function public.client_has_live_access(uuid) to authenticated;

-- SELECT only; writes go through the RPCs. Manage = PD/super read the bindings
-- (U3 lists active client links); the client reads only its OWN binding row.
grant select on public.client_portal_access to authenticated;
grant select on public.client_invites        to authenticated;

create policy "client access manage by director"
  on public.client_portal_access for all to authenticated
  using ((select public.current_user_role()) in ('project_director', 'super_admin'))
  with check ((select public.current_user_role()) in ('project_director', 'super_admin'));
create policy "client reads own access"
  on public.client_portal_access for select to authenticated
  using (user_id = (select auth.uid()));

create policy "client invites manage by director"
  on public.client_invites for all to authenticated
  using ((select public.current_user_role()) in ('project_director', 'super_admin'))
  with check ((select public.current_user_role()) in ('project_director', 'super_admin'));

-- ── Dedicated client read arms — ADDITIONAL permissive policies (OR'd with the
-- existing staff arms, which a 'client' role never matches). NEVER edit a staff
-- arm. eval-once wrapped (select …) so the role check runs once per query.
--
-- NOTE (money): projects.budget_amount_thb is a money column on a row a client
-- CAN read. Postgres RLS is row-level only, and a client shares the
-- `authenticated` DB role with staff, so a column grant cannot block it per
-- app-role. The U4 client reader MUST select only safe columns (never budget);
-- the money *tables* (wp_labor_costs, wp_economics, dc_payments, …) simply carry
-- NO client arm, so none of them is reachable at all.
create policy "client reads own project"
  on public.projects for select to authenticated
  using ((select public.current_user_role()) = 'client'
         and public.client_has_live_access(id));

create policy "client reads project work_packages"
  on public.work_packages for select to authenticated
  using ((select public.current_user_role()) = 'client'
         and public.client_has_live_access(project_id));

-- Photos: "approved" ≔ the owning work package is complete (the signed-off end
-- state; pending_approval/rework are not shown). Project resolved via the WP
-- (photo_logs has no project_id). Supersede/watermark are the reader's job (U4).
create policy "client reads approved project photos"
  on public.photo_logs for select to authenticated
  using ((select public.current_user_role()) = 'client'
         and exists (
           select 1 from public.work_packages w
           where w.id = photo_logs.work_package_id
             and w.status = 'complete'
             and public.client_has_live_access(w.project_id)
         ));

-- Reports: only successfully-generated (complete) reports for the live project
-- (requested/processing/failed are never shown).
create policy "client reads completed project reports"
  on public.reports for select to authenticated
  using ((select public.current_user_role()) = 'client'
         and status = 'complete'
         and public.client_has_live_access(project_id));

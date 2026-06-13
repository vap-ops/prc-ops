-- Spec 79 — clients master (project owners). Mirrors the contractors (ADR 0033)
-- and suppliers (ADR 0038) masters: mutable, PM/super-managed, created_by audit
-- pin, NO delete. A client is the customer a project is built for; one client
-- may own several projects (projects.client_id FK, added in 20260626000100).

create table public.clients (
  id              uuid primary key default gen_random_uuid(),
  name            text not null,
  contact_person  text null,
  phone           text null,
  email           text null,
  mailing_address text null,
  created_by      uuid not null references public.users(id),
  created_at      timestamptz not null default now(),
  constraint clients_name_nonblank check (length(trim(name)) > 0)
);

-- RLS + grants — revoke-all-first (platform default privileges), then the
-- column-scoped grants the masters pattern uses.
alter table public.clients enable row level security;
revoke all on public.clients from anon, authenticated;

grant select on public.clients to authenticated;
grant insert (id, name, contact_person, phone, email, mailing_address, created_by)
  on public.clients to authenticated;
grant update (name, contact_person, phone, email, mailing_address)
  on public.clients to authenticated;
-- NO delete grant / no delete policy (ADR 0033): a client referenced by a
-- project stays referencable forever; pruning is a service-role concern.

create policy "clients readable by staff"
  on public.clients for select to authenticated
  using (public.current_user_role()
         in ('site_admin', 'project_manager', 'super_admin'));

create policy "clients insert by pm or super_admin"
  on public.clients for insert to authenticated
  with check (public.current_user_role() in ('project_manager', 'super_admin')
              and created_by = (select auth.uid()));

create policy "clients update by pm or super_admin"
  on public.clients for update to authenticated
  using (public.current_user_role() in ('project_manager', 'super_admin'))
  with check (public.current_user_role() in ('project_manager', 'super_admin'));

comment on table public.clients is
  'Customer/owner a project is built for (project-owner master). Mutable, PM/super-managed, no delete (ADR 0033 masters pattern). projects.client_id references this.';

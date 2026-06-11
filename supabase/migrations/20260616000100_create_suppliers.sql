-- Spec 33 / ADR 0038 — suppliers master table + purchase_requests.supplier_id.
-- Contractors mirror (ADR 0033): mutable master data, created_by pin, NO
-- delete path. Read: all staff (incl. procurement). Write: back office
-- (project_manager, procurement, super_admin) — NOT site_admin: purchase
-- facts are financial data, unlike crew records.
--
-- supplier_id is the analytics link; the existing `supplier text` column
-- stays and is written as a name snapshot by record_purchase (display +
-- AppSheet continuity). appsheet_writer gets NO grant on supplier_id
-- (ADR 0034 column freeze).

create table public.suppliers (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  phone      text null,
  created_by uuid not null references public.users(id),
  created_at timestamptz not null default now(),
  constraint suppliers_name_nonblank check (length(trim(name)) > 0)
);

alter table public.purchase_requests
  add column supplier_id uuid null references public.suppliers(id);

alter table public.suppliers enable row level security;
revoke all on public.suppliers from anon, authenticated;

grant select on public.suppliers to authenticated;
grant insert (id, name, phone, created_by) on public.suppliers to authenticated;
grant update (name, phone) on public.suppliers to authenticated;
-- NO delete grant/policy: a supplier that sold something stays
-- referencable forever; pruning is a service-role concern.

create policy "suppliers readable by staff"
  on public.suppliers
  for select
  to authenticated
  using (public.current_user_role()
           in ('site_admin', 'project_manager', 'procurement', 'super_admin'));

create policy "suppliers insert by back office"
  on public.suppliers
  for insert
  to authenticated
  with check (
    public.current_user_role() in ('project_manager', 'procurement', 'super_admin')
    and created_by = auth.uid()
  );

create policy "suppliers update by back office"
  on public.suppliers
  for update
  to authenticated
  using (public.current_user_role() in ('project_manager', 'procurement', 'super_admin'))
  with check (public.current_user_role() in ('project_manager', 'procurement', 'super_admin'));

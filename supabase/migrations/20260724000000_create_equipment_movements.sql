-- Spec 141 U3 / ADR 0055 §4 — equipment_movements: the append-only custody log.
-- A SET of equipment deploys to a PROJECT (operator Case A); current location =
-- the latest movement per item (an event log, NOT a supersede chain —
-- corrections are compensating events). Immutable: no UPDATE/DELETE. An AFTER
-- INSERT trigger derives equipment_items.status from the movement so the
-- registry stays coherent with where the gear is.
--
-- WHO: site staff + procurement (the field physically moves equipment, so
-- site_admin records movements — this is tracking, NOT money). No money column.
-- Movements are self-auditing (the append-only log IS the trail), so no
-- audit_log row and no new audit_action enum value.

create type public.equipment_movement_kind as enum
  ('received', 'deployed', 'returned', 'maintenance', 'lost');

create table public.equipment_movements (
  id          uuid primary key default gen_random_uuid(),
  item_id     uuid not null references public.equipment_items(id),
  kind        public.equipment_movement_kind not null,
  project_id  uuid null references public.projects(id),
  quantity    integer not null default 1,
  occurred_at timestamptz not null default now(),
  note        text null,
  created_by  uuid not null references public.users(id),
  created_at  timestamptz not null default now(),
  -- project_id is set IFF the item is deployed to a project; every other kind
  -- (received / returned / maintenance / lost) carries no project.
  constraint equipment_movements_project_iff_deployed
    check ((project_id is not null) = (kind = 'deployed')),
  constraint equipment_movements_quantity_positive check (quantity >= 1),
  constraint equipment_movements_note_len check (note is null or length(note) <= 2000)
);

create index equipment_movements_item_idx
  on public.equipment_movements (item_id, occurred_at desc);
create index equipment_movements_project_idx on public.equipment_movements (project_id);

alter table public.equipment_movements enable row level security;
revoke all on public.equipment_movements from anon, authenticated;

-- Append-only: SELECT + INSERT only. NO update/delete grant or policy — a
-- correction is a new compensating movement, never a row edit.
grant select on public.equipment_movements to authenticated;
grant insert (id, item_id, kind, project_id, quantity, occurred_at, note, created_by)
  on public.equipment_movements to authenticated;

create policy "equipment_movements readable by staff"
  on public.equipment_movements for select to authenticated
  using ((select public.current_user_role())
         in ('site_admin', 'project_manager', 'procurement', 'super_admin'));

create policy "equipment_movements insert by staff"
  on public.equipment_movements for insert to authenticated
  with check ((select public.current_user_role())
                in ('site_admin', 'project_manager', 'procurement', 'super_admin')
              and created_by = (select auth.uid()));

-- Derive equipment_items.status from the movement just logged. SECURITY DEFINER:
-- a site_admin (not back-office) records movements but cannot UPDATE
-- equipment_items under RLS — the derive must bypass that, like the purchasing
-- derive triggers. Last-recorded wins (status reflects the new movement); the
-- currentEquipmentLocation helper is the source of truth for the latest-OCCURRED
-- location + project. They agree when movements are recorded chronologically.
-- Mapping: received→available, deployed→on_site, returned→returned,
-- maintenance→maintenance, lost→lost. ('in_use' is a manual refinement.)
create function public.equipment_movement_derive_status()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.equipment_items
     set status = (case new.kind
       when 'received'    then 'available'
       when 'deployed'    then 'on_site'
       when 'returned'    then 'returned'
       when 'maintenance' then 'maintenance'
       when 'lost'        then 'lost'
     end)::public.equipment_status
   where id = new.item_id;
  return new;
end;
$$;

create trigger equipment_movements_derive_status
  after insert on public.equipment_movements
  for each row
  execute function public.equipment_movement_derive_status();

comment on table public.equipment_movements is
  'Append-only equipment custody log (spec 141 U3 / ADR 0055). A set deploys to a project (kind=deployed -> project_id); current location = latest movement per item. Immutable (no update/delete). AFTER INSERT trigger derives equipment_items.status. Recorded by site staff + procurement; no money.';

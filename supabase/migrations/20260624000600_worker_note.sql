-- Spec 75 — worker note (notes-everywhere rollout, last existing-screen slice).
-- An editable free-text note on a roster worker (skills, phone, "probation",
-- whatever the fields don't cover). workers is RPC-only-write (rates are
-- money); the note rides the existing create_worker / update_worker RPCs.
--
-- note is presence data, not money — authenticated SELECT grant (unlike
-- day_rate). App caps at 1000; CHECK<=2000 is the backstop.

alter table public.workers
  add column note text,
  add constraint workers_note_len
    check (note is null or length(note) <= 2000);

grant select (note) on public.workers to authenticated;

-- Both RPCs gain p_note. CREATE OR REPLACE cannot add a parameter, so DROP
-- then CREATE. Bodies reproduced verbatim from 20260619000200 plus the note
-- (create: set it; update: case-preserve so omitted keeps it, '' clears).

drop function public.create_worker(text, public.worker_type, numeric, uuid, uuid);

create function public.create_worker(
  p_name text,
  p_type public.worker_type,
  p_day_rate numeric,
  p_contractor uuid default null,
  p_user uuid default null,
  p_note text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
  v_name text := trim(coalesce(p_name, ''));
begin
  if public.current_user_role() not in ('project_manager', 'super_admin') then
    raise exception 'create_worker: role not permitted' using errcode = '42501';
  end if;
  if length(v_name) = 0 or length(v_name) > 120 then
    raise exception 'create_worker: invalid name' using errcode = 'P0001';
  end if;
  if p_day_rate is null or p_day_rate < 0 then
    raise exception 'create_worker: invalid day rate' using errcode = 'P0001';
  end if;

  insert into public.workers (name, worker_type, contractor_id, user_id,
                              day_rate, created_by, note)
  values (v_name, p_type, p_contractor, p_user, p_day_rate, auth.uid(),
          nullif(btrim(p_note), ''))
  returning id into v_id;

  insert into public.audit_log (action, actor_id, actor_role, target_table,
                                target_id, payload)
  values ('worker_change', auth.uid(), public.current_user_role(), 'workers',
          v_id, jsonb_build_object('kind', 'create', 'name', v_name,
                                   'worker_type', p_type,
                                   'day_rate', p_day_rate));
  return v_id;
end;
$$;

drop function public.update_worker(uuid, text, boolean, uuid);

create function public.update_worker(
  p_id uuid,
  p_name text default null,
  p_active boolean default null,
  p_contractor uuid default null,
  p_note text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.workers%rowtype;
  v_name text := nullif(trim(coalesce(p_name, '')), '');
begin
  if public.current_user_role() not in ('project_manager', 'super_admin') then
    raise exception 'update_worker: role not permitted' using errcode = '42501';
  end if;
  select * into v_row from public.workers where id = p_id;
  if not found then
    raise exception 'update_worker: worker not found' using errcode = 'P0001';
  end if;
  if v_name is not null and length(v_name) > 120 then
    raise exception 'update_worker: invalid name' using errcode = 'P0001';
  end if;
  if p_contractor is not null and v_row.worker_type <> 'dc' then
    raise exception 'update_worker: contractor only applies to dc workers'
      using errcode = 'P0001';
  end if;

  -- Coalesce semantics (record_purchase precedent): omitted = preserved.
  -- The note uses case-preserve so an explicit '' can clear it.
  update public.workers
     set name          = coalesce(v_name, name),
         active        = coalesce(p_active, active),
         contractor_id = coalesce(p_contractor, contractor_id),
         note          = case
                           when p_note is null then note
                           else nullif(btrim(p_note), '')
                         end
   where id = p_id;

  insert into public.audit_log (action, actor_id, actor_role, target_table,
                                target_id, payload)
  values ('worker_change', auth.uid(), public.current_user_role(), 'workers',
          p_id, jsonb_build_object('kind', 'update', 'name', v_name,
                                   'active', p_active,
                                   'contractor_id', p_contractor));
end;
$$;

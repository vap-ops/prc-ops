-- Spec 367 §10.4 — `set_equipment_acquisition`: the write path for
-- `acquisition_cost` + `acquired_at`, and the history arm that shows it.
--
-- Why a DEFINER RPC. Both columns are money-walled: `equipment_items` is
-- column-granted (ADR 0055 decision 6) and neither column carries ANY grant to
-- `authenticated`, in either direction (verified live 2026-08-07 — only
-- `service_role` and `postgres` hold one). So the app has had NO way to record
-- what a machine cost, which is what blocks the §3 PRI transfer schedule, and an
-- RLS-client UPDATE would 42501 rather than write.
--
-- Shape mirrors its sibling `set_equipment_daily_rate` on purpose — same five
-- back-office roles, same explicit existence probe (DEFINER bypasses RLS, so
-- "not found" must be raised, never inferred), same audit row. Deviations are
-- deliberate and noted inline.

-- Both value params DEFAULT NULL, and null means CLEAR (see below). The default
-- is not decoration: supabase's type generator emits a parameter as OPTIONAL
-- only when it carries one, so without it the generated `Args` type is
-- `{p_cost: number}` and the app cannot express "clear this" without a cast that
-- lies about the contract.
create or replace function public.set_equipment_acquisition(
  p_id uuid,
  p_cost numeric default null,
  p_acquired_at date default null
) returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_role     public.user_role := public.current_user_role();
  v_old_cost numeric;
  v_old_date date;
begin
  if v_role is null
       or v_role not in ('project_manager', 'super_admin', 'procurement',
                         'procurement_manager', 'project_director') then
    raise exception 'set_equipment_acquisition: role not permitted' using errcode = '42501';
  end if;

  -- NULL is a value here, not "leave unchanged": one meaning per argument, so a
  -- caller can never wonder which reading it got. Clearing a wrong figure is a
  -- real need and a second "clear" verb would be a second way to say one thing.
  if p_cost is not null and p_cost < 0 then
    raise exception 'set_equipment_acquisition: cost must not be negative' using errcode = 'P0001';
  end if;

  -- `current_date` is UTC on this database while the users are in Bangkok, so
  -- for seven hours a day it is a day behind — a machine bought this morning
  -- would be refused as "in the future". Compare the civil date instead.
  if p_acquired_at is not null
       and p_acquired_at > (now() at time zone 'Asia/Bangkok')::date then
    raise exception 'set_equipment_acquisition: acquisition date is in the future'
      using errcode = 'P0001';
  end if;

  select acquisition_cost, acquired_at
    into v_old_cost, v_old_date
    from public.equipment_items
   where id = p_id;
  if not found then
    raise exception 'set_equipment_acquisition: equipment item not found' using errcode = 'P0001';
  end if;

  update public.equipment_items
     set acquisition_cost = p_cost,
         acquired_at      = p_acquired_at
   where id = p_id;

  -- Its own action, not `equipment_rate_change`: the history RPC maps that one
  -- to "เปลี่ยนค่าเช่า", so a cost change filed under it would render a false
  -- sentence. Old AND new are recorded — a money trail that cannot say what the
  -- figure was before is not a trail.
  insert into public.audit_log (action, actor_id, actor_role, target_table,
                                target_id, payload)
  values ('equipment_acquisition_change', auth.uid(), v_role,
          'equipment_items', p_id,
          jsonb_build_object('kind', 'acquisition_change',
                             'old_cost', v_old_cost, 'new_cost', p_cost,
                             'old_acquired_at', v_old_date,
                             'new_acquired_at', p_acquired_at));
end;
$$;

-- A new function is born executable by PUBLIC on this database, so the revoke
-- comes BEFORE the grant and is the load-bearing half.
revoke all on function public.set_equipment_acquisition(uuid, numeric, date) from public, anon;
grant execute on function public.set_equipment_acquisition(uuid, numeric, date) to authenticated;

-- ---------------------------------------------------------------------------
-- The read side: surface acquisition changes in the item's own history, under
-- the SAME money-audience gate as the rate arm. A money event that leaves no
-- visible trace is the silent-gap class; `create or replace` keeps the signature
-- so no consumer changes.
-- ---------------------------------------------------------------------------
create or replace function public.equipment_item_history(p_item_id uuid)
 returns table(occurred_at timestamptz, kind text, actor_id uuid, detail jsonb)
 language plpgsql
 stable security definer
 set search_path to 'public', 'pg_temp'
as $function$
declare
  v_role text := coalesce((select public.current_user_role())::text, '');
  v_money boolean;
begin
  -- coalesce-to-empty above: an unbound caller must fall to the DENY arm, not
  -- slip through a NULL comparison (the rls-self-check-coalesce trap).
  if v_role not in ('site_admin','project_manager','procurement',
                    'procurement_manager','super_admin','project_director') then
    raise exception 'not authorised to read equipment history' using errcode = '42501';
  end if;

  v_money := v_role in ('project_manager','procurement','procurement_manager',
                        'super_admin','project_director');

  return query
  -- Location moves (append-only).
  select m.occurred_at,
         'movement_' || m.kind::text,
         m.created_by,
         jsonb_strip_nulls(jsonb_build_object(
           'project_id', m.project_id,
           'quantity', m.quantity,
           'note', m.note
         ))
    from public.equipment_movements m
   where m.item_id = p_item_id

  union all
  -- Borrow / return (spec 370's scan door). daily_rate_snapshot is money and is
  -- deliberately NOT selected — not even for the money audience, because this
  -- surface is about custody, not billing.
  select u.created_at,
         case when u.checked_in_on is null then 'loan_out' else 'loan_returned' end,
         u.entered_by,
         jsonb_strip_nulls(jsonb_build_object(
           'work_package_id', u.work_package_id,
           'checked_out_on', u.checked_out_on,
           'checked_in_on', u.checked_in_on,
           'borrower_worker_id', u.borrower_worker_id,
           'via', u.via
         ))
    from public.equipment_usage_logs u
   where u.item_id = p_item_id
     and u.superseded_by is null

  union all
  -- Field edits.
  select a.created_at,
         'item_updated',
         a.actor_id,
         a.payload
    from public.audit_log a
   where a.target_table = 'equipment_items'
     and a.target_id = p_item_id
     and a.action = 'equipment_item_updated'

  union all
  -- Rate changes — MONEY. Omitted entirely for a non-money caller.
  select a.created_at,
         'rate_change',
         a.actor_id,
         a.payload
    from public.audit_log a
   where v_money
     and a.target_table = 'equipment_items'
     and a.target_id = p_item_id
     and a.action = 'equipment_rate_change'

  union all
  -- Spec 367 §10.4 — acquisition cost / date. MONEY, same gate as the rate arm.
  select a.created_at,
         'acquisition_change',
         a.actor_id,
         a.payload
    from public.audit_log a
   where v_money
     and a.target_table = 'equipment_items'
     and a.target_id = p_item_id
     and a.action = 'equipment_acquisition_change'

  order by 1 desc;
end;
$function$;

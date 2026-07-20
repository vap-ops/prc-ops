-- Spec 332 U1 — worker_trades (สายงานช่าง): assignment-axis trade tags from
-- workers to TOP-LEVEL work_categories (W01–W09). Deliberately NO per-trade
-- rating column (ADR 0060 anti-favoritism: no subjective ratings; money stays
-- on workers.level). Writes RPC-only through set_worker_trades (full-replace,
-- PM/PD/super gate); reads = select for authenticated (non-PII tags).

create table public.worker_trades (
  worker_id        uuid not null references public.workers(id) on delete cascade,
  work_category_id uuid not null references public.work_categories(id),
  is_primary       boolean not null default false,
  created_by       uuid references public.users(id),
  created_at       timestamptz not null default now(),
  primary key (worker_id, work_category_id)
);

-- at most ONE primary trade per worker — writer-agnostic DB invariant
create unique index worker_trades_one_primary
  on public.worker_trades (worker_id) where is_primary;

alter table public.worker_trades enable row level security;

create policy worker_trades_select on public.worker_trades
  for select to authenticated using (true);

revoke all on public.worker_trades from anon, authenticated;
grant select on public.worker_trades to authenticated;

create or replace function public.set_worker_trades(
  p_worker uuid,
  p_categories uuid[],
  p_primary uuid default null
) returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_role public.user_role := (select public.current_user_role());
  v_cats uuid[];
  v_bad  integer;
begin
  if v_role is null or v_role not in ('project_manager', 'super_admin', 'project_director') then
    raise exception 'set_worker_trades: role not permitted' using errcode = '42501';
  end if;

  -- FOR UPDATE serializes concurrent full-replaces on the same worker. Without it
  -- two calls that both start with zero existing rows delete nothing, then insert
  -- disjoint sets — the result is their UNION, not last-writer-wins (and a differing
  -- p_primary surfaces a raw 23505 the UI has no message for).
  perform 1 from public.workers where id = p_worker for update;
  if not found then
    raise exception 'set_worker_trades: worker not found' using errcode = 'P0001';
  end if;

  -- dedup silently (the UI may repeat ids); null/empty clears all tags
  select coalesce(array_agg(distinct c), '{}'::uuid[]) into v_cats
    from unnest(coalesce(p_categories, '{}'::uuid[])) as c;

  -- every category must exist, be TOP-LEVEL (W01–W09), and be active
  select count(*) into v_bad
    from unnest(v_cats) as c
    left join public.work_categories wc
      on wc.id = c and char_length(wc.code) = 3 and wc.is_active
   where wc.id is null;
  if v_bad > 0 then
    raise exception 'set_worker_trades: invalid category' using errcode = '22023';
  end if;

  if p_primary is not null and not (p_primary = any (v_cats)) then
    raise exception 'set_worker_trades: primary not in set' using errcode = '22023';
  end if;

  delete from public.worker_trades where worker_id = p_worker;
  insert into public.worker_trades (worker_id, work_category_id, is_primary, created_by)
  select p_worker, c, coalesce(c = p_primary, false), auth.uid()
    from unnest(v_cats) as c;

  insert into public.audit_log (action, actor_id, actor_role, target_table, target_id, payload)
  values ('worker_change', auth.uid(), v_role, 'workers', p_worker,
          jsonb_build_object(
            'kind', 'trades_change',
            'categories', (select coalesce(jsonb_agg(wc.code order by wc.code), '[]'::jsonb)
                             from public.work_categories wc
                            where wc.id = any (v_cats)),
            'primary', (select wc.code from public.work_categories wc where wc.id = p_primary)));
end;
$$;

revoke execute on function public.set_worker_trades(uuid, uuid[], uuid) from public, anon;
grant execute on function public.set_worker_trades(uuid, uuid[], uuid) to authenticated;

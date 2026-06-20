-- Spec 161 U6b / ADR 0060 §6 + decision c + design-rules 1/6/7 + ADR 0061 trust
-- invariant — the TRUST layer: HOLDING IS SAFE. Vested coins (past the warranty/defect
-- tail) are the worker's to keep, un-confiscatable; confiscation is reserved for a
-- short, explicit gross-violation list; a saver's bonus rewards holding.
--
-- VESTING is time-based (+ the external lock), derived from posting age — NO project
-- link is added to coin_postings (post_coins stays untouched). The per-project defect
-- clawback auto-wiring (spec 144 reopen → claw THAT project's unvested profit_share)
-- needs such a link → its own follow-up; here the time-based vesting + the
-- 'defect_rework' confiscation reason are the manual clawback mechanism.

-- 1. New seeded dials (decision a — PLACEHOLDERS; calibrate before go-live).
insert into public.nova_dials (dial_key, value) values
  ('vesting_tail_days',  365),    -- the post-close warranty/defect tail
  ('savers_bonus_rate',  0.02);   -- 2% on held balance per cycle

-- 2. Narrow, explicit confiscation reasons (decision c): the three gross violations +
--    the quality clawback (design-rule 1). NO catch-all 'other' → never arbitrary.
create type public.confiscation_reason as enum
  ('fraud', 'theft', 'gross_misconduct', 'defect_rework');

-- 3. The confiscation trail (append-only). Self-auditing alongside the ledger.
create table public.coin_confiscations (
  id              uuid primary key default gen_random_uuid(),
  worker_id       uuid not null references public.workers(id),
  reason          public.confiscation_reason not null,
  amount          numeric(20, 4) not null,
  note            text null,
  posting_id      uuid not null references public.coin_postings(id),
  confiscated_by  uuid not null references public.users(id),
  confiscated_at  timestamptz not null default now(),
  constraint coin_confiscations_amount_positive check (amount > 0),
  constraint coin_confiscations_note_cap check (note is null or length(note) <= 500)
);

create index coin_confiscations_worker_idx on public.coin_confiscations (worker_id, confiscated_at desc);

alter table public.coin_confiscations enable row level security;
revoke all on public.coin_confiscations from anon, authenticated;
grant select on public.coin_confiscations to authenticated;
create policy "coin_confiscations readable by operator"
  on public.coin_confiscations for select to authenticated
  using ((select public.current_user_role()) = 'super_admin');

comment on table public.coin_confiscations is
  'Append-only confiscation trail (spec 161 U6b / ADR 0060 §6). Records the reason (narrow enum) + amount + the negative posting. Only UNVESTED coins are confiscated (vested = the worker''s to keep). RPC-only writes; operator-read; self-auditing.';

-- 4. Vesting derives. SECURITY DEFINER (read the ledger via the owner) + super/director
--    gate (null-safe; NO PM ref → 90/91 untouched) so a direct call is protected; the
--    super-only confiscate / redeem / savers callers pass the gate definer-to-definer.
create function public.coin_unvested_balance(p_worker uuid)
returns numeric
language plpgsql
security definer
stable
set search_path = public
as $$
declare
  v_balance  numeric;
  v_external boolean;
  v_recent   numeric;
  v_tail     numeric;
begin
  if public.current_user_role() is distinct from 'super_admin'
     and public.current_user_role() is distinct from 'project_director' then
    raise exception 'coin_unvested_balance: role not permitted' using errcode = '42501';
  end if;
  if not exists (select 1 from public.workers where id = p_worker) then
    raise exception 'coin_unvested_balance: worker not found' using errcode = 'P0001';
  end if;

  v_balance := public.coin_balance(p_worker);

  -- External (contractor dc_temporary): the whole balance is locked/unvested until the
  -- worker is invited internal (§4, generalized).
  v_external := exists (
    select 1 from public.workers w
      join public.contractors c on c.id = w.contractor_id
     where w.id = p_worker and c.contractor_subtype = 'dc_temporary');
  if v_external then
    return greatest(v_balance, 0);
  end if;

  -- Internal: recently-earned coins still inside the warranty/defect tail are unvested.
  v_tail := coalesce((select value from public.nova_dials where dial_key = 'vesting_tail_days'), 0);
  select coalesce(sum(amount), 0) into v_recent
    from public.coin_postings
   where worker_id = p_worker and amount > 0
     and occurred_at > now() - (v_tail || ' days')::interval;

  return least(greatest(v_balance, 0), v_recent);
end;
$$;

revoke all on function public.coin_unvested_balance(uuid) from public;
grant execute on function public.coin_unvested_balance(uuid) to authenticated;

create function public.coin_vested_balance(p_worker uuid)
returns numeric
language plpgsql
security definer
stable
set search_path = public
as $$
begin
  if public.current_user_role() is distinct from 'super_admin'
     and public.current_user_role() is distinct from 'project_director' then
    raise exception 'coin_vested_balance: role not permitted' using errcode = '42501';
  end if;
  return greatest(public.coin_balance(p_worker) - public.coin_unvested_balance(p_worker), 0);
end;
$$;

revoke all on function public.coin_vested_balance(uuid) from public;
grant execute on function public.coin_vested_balance(uuid) to authenticated;

-- Spendable = vested (an external's vested is 0 → locked; an internal spends only vested).
create function public.coin_spendable_balance(p_worker uuid)
returns numeric
language plpgsql
security definer
stable
set search_path = public
as $$
begin
  if public.current_user_role() is distinct from 'super_admin'
     and public.current_user_role() is distinct from 'project_director' then
    raise exception 'coin_spendable_balance: role not permitted' using errcode = '42501';
  end if;
  return public.coin_vested_balance(p_worker);
end;
$$;

revoke all on function public.coin_spendable_balance(uuid) from public;
grant execute on function public.coin_spendable_balance(uuid) to authenticated;

-- 5. confiscate_coins — forfeit the UNVESTED coins only (vested is never touched).
--    super_admin only (peak authority, like minting). A defect clawback uses
--    p_reason='defect_rework' (coins within the tail are unvested → reachable).
create function public.confiscate_coins(
  p_worker uuid,
  p_reason public.confiscation_reason,
  p_note text default null
)
returns numeric
language plpgsql
security definer
set search_path = public
as $$
declare
  v_unvested numeric;
  v_note     text := nullif(trim(coalesce(p_note, '')), '');
  v_posting  uuid;
begin
  if public.current_user_role() is distinct from 'super_admin' then
    raise exception 'confiscate_coins: role not permitted' using errcode = '42501';
  end if;
  if not exists (select 1 from public.workers where id = p_worker) then
    raise exception 'confiscate_coins: worker not found' using errcode = 'P0001';
  end if;

  v_unvested := public.coin_unvested_balance(p_worker);
  if v_unvested <= 0 then
    raise exception 'confiscate_coins: no unvested coins to confiscate (vested coins are kept)'
      using errcode = 'P0001';
  end if;

  v_posting := public.post_coins(p_worker, 'confiscation', -v_unvested,
    'Confiscation (' || p_reason::text || ')' || coalesce(': ' || v_note, ''));

  insert into public.coin_confiscations (worker_id, reason, amount, note, posting_id, confiscated_by)
  values (p_worker, p_reason, v_unvested, v_note, v_posting, auth.uid());
  return v_unvested;
end;
$$;

revoke all on function public.confiscate_coins(uuid, public.confiscation_reason, text) from public;
grant execute on function public.confiscate_coins(uuid, public.confiscation_reason, text) to authenticated;

-- 6. award_savers_bonus — reward holding. super_admin only. Rewards CONTINUED holding:
--    the first bonus is allowed; a later bonus is blocked if the worker redeemed since
--    their last bonus. Cadence is operator-driven (call per cycle); the rate is the dial.
create function public.award_savers_bonus(p_worker uuid)
returns numeric
language plpgsql
security definer
set search_path = public
as $$
declare
  v_rate       numeric;
  v_bal        numeric;
  v_last_bonus timestamptz;
  v_bonus      numeric;
  v_posting    uuid;
begin
  if public.current_user_role() is distinct from 'super_admin' then
    raise exception 'award_savers_bonus: role not permitted' using errcode = '42501';
  end if;
  if not exists (select 1 from public.workers where id = p_worker) then
    raise exception 'award_savers_bonus: worker not found' using errcode = 'P0001';
  end if;

  v_bal := public.coin_balance(p_worker);
  if v_bal <= 0 then
    raise exception 'award_savers_bonus: no balance to reward' using errcode = 'P0001';
  end if;

  v_last_bonus := (select max(occurred_at) from public.coin_postings
                    where worker_id = p_worker and source = 'savers_bonus');
  if v_last_bonus is not null and exists (
    select 1 from public.coin_postings
     where worker_id = p_worker and source = 'shop_redemption' and occurred_at > v_last_bonus
  ) then
    raise exception 'award_savers_bonus: spent since last bonus' using errcode = 'P0001';
  end if;

  v_rate := coalesce((select value from public.nova_dials where dial_key = 'savers_bonus_rate'), 0);
  v_bonus := round(v_bal * v_rate, 4);
  if v_bonus <= 0 then
    raise exception 'award_savers_bonus: bonus is zero (rate not set)' using errcode = 'P0001';
  end if;

  v_posting := public.post_coins(p_worker, 'savers_bonus', v_bonus, 'Saver bonus');
  return v_bonus;
end;
$$;

revoke all on function public.award_savers_bonus(uuid) from public;
grant execute on function public.award_savers_bonus(uuid) to authenticated;

-- 7. redeem_shop_item REPLACE — spend only SPENDABLE (vested) coins, making the lock
--    real (U6a built redeem on the full balance). Same signature → grants preserved.
create or replace function public.redeem_shop_item(p_worker uuid, p_item uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_price     numeric;
  v_active    boolean;
  v_name      text;
  v_spendable numeric;
  v_posting   uuid;
  v_id        uuid;
begin
  if public.current_user_role() is distinct from 'super_admin' then
    raise exception 'redeem_shop_item: role not permitted' using errcode = '42501';
  end if;
  if not exists (select 1 from public.workers where id = p_worker) then
    raise exception 'redeem_shop_item: worker not found' using errcode = 'P0001';
  end if;

  select price_coins, active, name into v_price, v_active, v_name
    from public.shop_items where id = p_item;
  if not found then
    raise exception 'redeem_shop_item: item not found' using errcode = 'P0001';
  end if;
  if not v_active then
    raise exception 'redeem_shop_item: item is not available' using errcode = 'P0001';
  end if;

  -- Spendable = vested + not-externally-locked (U6b): unvested coins (and ALL of an
  -- external's) cannot be spent until they vest / the worker is invited internal.
  v_spendable := public.coin_spendable_balance(p_worker);
  if v_spendable < v_price then
    raise exception 'redeem_shop_item: insufficient spendable balance' using errcode = 'P0001';
  end if;

  v_posting := public.post_coins(p_worker, 'shop_redemption', -v_price,
    'Shop redemption: ' || v_name);

  insert into public.shop_redemptions (worker_id, item_id, price_coins, posting_id, redeemed_by)
  values (p_worker, p_item, v_price, v_posting, auth.uid())
  returning id into v_id;
  return v_id;
end;
$$;

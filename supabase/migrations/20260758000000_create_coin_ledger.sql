-- Spec 160 U2 / ADR 0061 (invariants 2 + 3) — event-sourced coin-ledger
-- skeleton. The SPINE coins hang on, built before any economics. Reuses the GL
-- discipline (ADR 0057): every coin is an immutable POSTING (worker · source ·
-- amount · reason · occurred_at); the balance is DERIVED (coin_balance), never a
-- stored integer; a clawback / reversal is a NEGATIVE posting, never a row edit.
-- Coins attach to the durable workers identity (U1 / invariant 1), so a banked
-- share follows a DC across project moves for free.
--
-- NO economics: sources are NAMED, not valued — no coin value, earn-rules,
-- settlement, shop, vesting, or ADR 0060 dials. Those are later units.
--
-- MONEY/AUTHORITY POSTURE: coins are operator/economics domain. Read is
-- super_admin-only (the worker-sees-own read waits for the portal, U3); writes
-- go through the SECURITY DEFINER post_coins RPC (zero write grant — the
-- definer's owner bypasses). Self-auditing like equipment_movements (the
-- append-only ledger IS the trail), so no audit_log row and no audit_action.

-- 1. Pluggable earn-sources (invariant 3). A future source (education / safety /
--    referral / tenure …) is an `alter type ... add value`, never table surgery.
create type public.coin_source as enum ('profit_share', 'savers_bonus', 'behavior_bonus');

-- 2. The append-only ledger. amount is SIGNED (negative = clawback/reversal).
create table public.coin_postings (
  id          uuid primary key default gen_random_uuid(),
  worker_id   uuid not null references public.workers(id),
  source      public.coin_source not null,
  amount      numeric(20, 4) not null,
  reason      text not null,
  occurred_at timestamptz not null default now(),
  created_by  uuid not null references public.users(id),
  created_at  timestamptz not null default now(),
  -- A posting always moves coins; zero is meaningless.
  constraint coin_postings_amount_nonzero check (amount <> 0),
  constraint coin_postings_reason_nonblank check (length(trim(reason)) > 0),
  constraint coin_postings_reason_len check (length(reason) <= 500)
);

create index coin_postings_worker_idx on public.coin_postings (worker_id, occurred_at desc);

alter table public.coin_postings enable row level security;
revoke all on public.coin_postings from anon, authenticated;

-- SELECT only, operator-gated. No INSERT/UPDATE/DELETE grant or policy — writes
-- go through post_coins; a correction is a new (negative) posting, never an edit.
grant select on public.coin_postings to authenticated;

create policy "coin_postings readable by operator"
  on public.coin_postings for select to authenticated
  using ((select public.current_user_role()) = 'super_admin');

comment on table public.coin_postings is
  'Append-only event-sourced coin ledger (spec 160 U2 / ADR 0061 invariant 2). One immutable posting per coin movement; balance = coin_balance() (derived, never stored); clawback = negative posting. RPC-only writes (post_coins); operator-read; self-auditing. NO economics yet.';

-- 3. The derive. SECURITY INVOKER (default) so it respects the read policy — a
--    non-operator sees no rows and gets 0, never a leak of the real balance.
create function public.coin_balance(p_worker uuid)
returns numeric
language sql
stable
set search_path = public
as $$
  select coalesce(sum(amount), 0) from public.coin_postings where worker_id = p_worker;
$$;

-- 4. The write path. SECURITY DEFINER, super_admin only (`is distinct from`
--    null-safe — an unbound role must NOT open the gate; the RLS self-check
--    coalesce trap). Self-auditing — no audit_log row.
create function public.post_coins(
  p_worker uuid,
  p_source public.coin_source,
  p_amount numeric,
  p_reason text,
  p_occurred_at timestamptz default now()
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
  v_reason text := trim(coalesce(p_reason, ''));
  v_exists boolean;
begin
  if public.current_user_role() is distinct from 'super_admin' then
    raise exception 'post_coins: role not permitted' using errcode = '42501';
  end if;
  if p_amount is null or p_amount = 0 then
    raise exception 'post_coins: amount must be nonzero' using errcode = 'P0001';
  end if;
  if length(v_reason) = 0 or length(v_reason) > 500 then
    raise exception 'post_coins: invalid reason' using errcode = 'P0001';
  end if;
  select true into v_exists from public.workers where id = p_worker;
  if not found then
    raise exception 'post_coins: worker not found' using errcode = 'P0001';
  end if;

  insert into public.coin_postings (worker_id, source, amount, reason, occurred_at, created_by)
  values (p_worker, p_source, p_amount, v_reason, coalesce(p_occurred_at, now()), auth.uid())
  returning id into v_id;
  return v_id;
end;
$$;

-- Spec 161 U4a / ADR 0060 §3 + build-decision (a) — the settlement multiplier
-- dial. At project close the coin pool = Σ banked WP profits × the project
-- multiplier (the engine = U4b). The multiplier is "the most important undefined
-- lever" — so per decision (a) it is an EDITABLE, SEEDED dial (tune anytime), not
-- a hardcoded constant. nova_dials is the one key/value home for every economic
-- dial; the arc's remaining dials (HT cut %, level weights — U5; saver-bonus rate
-- — U6) land here as seeded rows in their own units. U4a seeds only coin_multiplier.
--
-- MONEY/economics posture (a payout lever): zero authenticated grant — the
-- operator reads via the admin client behind requireRole; the settlement engine
-- (U4b) reads via the definer; set_nova_dial is the sole writer. super_admin-only
-- (anti-favoritism §5, like the sell-rate dials; NO project_manager reference →
-- ADR 0058 pgTAP 90/91 untouched).

create table public.nova_dials (
  dial_key   text primary key,
  value      numeric(20, 4) not null,
  updated_by uuid null references public.users(id),
  updated_at timestamptz not null default now(),
  constraint nova_dials_value_nonnegative check (value >= 0)
);

alter table public.nova_dials enable row level security;
-- Zero grant: the operator reads via the admin client; the definer setter / the
-- U4b engine are the only other readers/writers.
revoke all on public.nova_dials from anon, authenticated;

comment on table public.nova_dials is
  'Editable key/value home for Nova economic dials (spec 161 U4a / ADR 0060 decision a). MONEY/economics — zero authenticated grant; tuned via set_nova_dial, read via the admin client / the settlement engine. Seeded with coin_multiplier (U4a); HT cut / level weights / saver-bonus rate land here in U5/U6.';

-- Seeded placeholder: 1 baht banked profit → 1 coin point (coins are abstract
-- points, no baht peg — ADR decision b). The operator MUST calibrate this against
-- real utilization before go-live (the standing markup-% open dial).
insert into public.nova_dials (dial_key, value) values ('coin_multiplier', 1.0);

-- set_nova_dial — super_admin tunes a SEEDED dial (update-only: a typo'd key is
-- rejected, never creates a phantom dial). null-safe gate; value >= 0; audited via
-- the generic update action (no enum-add).
create function public.set_nova_dial(p_key text, p_value numeric)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_old numeric;
begin
  if public.current_user_role() is distinct from 'super_admin' then
    raise exception 'set_nova_dial: role not permitted' using errcode = '42501';
  end if;
  if p_value is null or p_value < 0 then
    raise exception 'set_nova_dial: value must be non-negative' using errcode = 'P0001';
  end if;
  select value into v_old from public.nova_dials where dial_key = p_key;
  if not found then
    raise exception 'set_nova_dial: unknown dial' using errcode = 'P0001';
  end if;

  update public.nova_dials
     set value = p_value, updated_by = auth.uid(), updated_at = now()
   where dial_key = p_key;

  insert into public.audit_log (action, actor_id, actor_role, target_table,
                                target_id, payload)
  values ('update', auth.uid(), public.current_user_role(), 'nova_dials', null,
          jsonb_build_object('key', p_key, 'old', v_old, 'new', p_value));
end;
$$;

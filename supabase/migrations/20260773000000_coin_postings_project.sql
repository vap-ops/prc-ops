-- Spec 161 U10 / ADR 0060 design-rule 1 — give coin postings a PROJECT origin so a
-- defect clawback can target exactly the project's coins (and only the unvested
-- ones). Additive nullable column; post_coins gains an optional p_source_project.
--
-- post_coins must change its argument list (add a defaulted param). A bare
-- create-or-replace would create a SECOND overload, making the existing 4-named-arg
-- callers (awardCoins, etc.) ambiguous → DROP + CREATE instead. plpgsql callers
-- (distribute/award/redeem/confiscate/savers) bind at runtime, so the DROP is safe;
-- the only signature pin is pgTAP 96 (updated alongside). Body is byte-identical to
-- the spec-160 original plus the project ref + its existence check.

alter table public.coin_postings
  add column source_project_id uuid null references public.projects(id);

comment on column public.coin_postings.source_project_id is
  'Spec 161 U10 — the project a posting derives from (profit_share distribution / defect clawback). NULL for project-agnostic postings (manual awards, saver bonus). Enables per-project, vested-safe defect clawback.';

drop function public.post_coins(uuid, public.coin_source, numeric, text, timestamptz);

create function public.post_coins(
  p_worker uuid,
  p_source public.coin_source,
  p_amount numeric,
  p_reason text,
  p_occurred_at timestamptz default now(),
  p_source_project uuid default null
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
  -- A project ref, when given, must exist.
  if p_source_project is not null
     and not exists (select 1 from public.projects where id = p_source_project) then
    raise exception 'post_coins: project not found' using errcode = 'P0001';
  end if;

  insert into public.coin_postings
    (worker_id, source, amount, reason, occurred_at, created_by, source_project_id)
  values
    (p_worker, p_source, p_amount, v_reason, coalesce(p_occurred_at, now()), auth.uid(),
     p_source_project)
  returning id into v_id;
  return v_id;
end;
$$;

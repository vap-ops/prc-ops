-- Spec 149 U4c / ADR 0057 — the remaining subledger posters (mechanical repeats
-- of post_purchase_to_gl, each its accrual postings). All SECURITY DEFINER,
-- owner-context (read zero-grant money), granted to service_role for the drainer,
-- reverse-and-repost (auto-correct). Accounts are the construction-standard
-- skeleton; the accountant refines the mapping later.

-- ----------------------------------------------------------------------------
-- DC payment → settles the DC-clearing liability:  Dr DC-clearing (2110) / Cr Bank (1110).
-- amount = paid_amount; party = contractor. A SUPERSEDE (superseded_by set) first
-- reverses the superseded row's entry; a VOID (tombstone, paid_amount NULL) only
-- reverses and posts nothing new. Also reverse-and-reposts this row's own current
-- entry (re-drain safety).
create function public.post_dc_payment_to_gl(p_source_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_paid    numeric(14,2);
  v_paid_at date;
  v_contractor uuid;
  v_actor   uuid;
  v_superseded uuid;
  v_old     uuid;
  v_lines   jsonb;
begin
  select paid_amount, paid_at, contractor_id, paid_by, superseded_by
    into v_paid, v_paid_at, v_contractor, v_actor, v_superseded
    from public.dc_payments where id = p_source_id;
  if not found then
    raise exception 'post_dc_payment_to_gl: payment not found' using errcode = 'P0001';
  end if;

  -- A superseding row voids the row it replaces: reverse that entry first.
  if v_superseded is not null then
    select e.id into v_old from public.journal_entries e
      where e.source_table = 'dc_payments' and e.source_id = v_superseded
        and e.source_event = 'dc_payment' and e.status = 'posted'
        and not exists (select 1 from public.journal_entries r where r.reversal_of = e.id)
      limit 1;
    if v_old is not null then
      perform public.reverse_journal_internal(v_old, v_actor, 'void: superseded DC payment');
    end if;
  end if;

  -- Reverse this row's own current entry (re-drain safety).
  select e.id into v_old from public.journal_entries e
    where e.source_table = 'dc_payments' and e.source_id = p_source_id
      and e.source_event = 'dc_payment' and e.status = 'posted'
      and not exists (select 1 from public.journal_entries r where r.reversal_of = e.id)
    limit 1;
  if v_old is not null then
    perform public.reverse_journal_internal(v_old, v_actor, 'auto-correct: DC payment re-posted');
  end if;

  -- A tombstone/void (no paid_amount) posts nothing new.
  if v_paid is null or v_paid = 0 then
    return null;
  end if;

  v_lines := jsonb_build_array(
    jsonb_build_object('account_code', '2110', 'debit',  v_paid, 'contractor_id', v_contractor),
    jsonb_build_object('account_code', '1110', 'credit', v_paid));

  return public.post_journal_internal(
    v_paid_at, 'dc_payments', p_source_id, 'dc_payment', 'DC payment', v_lines, null, v_actor);
end;
$$;
revoke all on function public.post_dc_payment_to_gl(uuid) from public, anon, authenticated;
grant execute on function public.post_dc_payment_to_gl(uuid) to service_role;

-- ----------------------------------------------------------------------------
-- Labor freeze → accrue labor to WIP per WP:
--   Dr WIP-construction (1400) own + dc  [project/WP dims]
--   Cr Payroll-clearing (2130) own  /  Cr DC-clearing (2110) dc
-- Zero-cost sides are skipped (one-sided lines); a fully-zero freeze posts nothing.
-- Reverse-and-reposts the WP's current entry (re-freeze auto-correct; keyed by WP).
create function public.post_labor_freeze_to_gl(p_source_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_own     numeric(14,2);
  v_dc      numeric(14,2);
  v_when    date;
  v_actor   uuid;
  v_project uuid;
  v_old     uuid;
  v_lines   jsonb := '[]'::jsonb;
begin
  select own_cost, dc_cost, computed_at::date, frozen_by
    into v_own, v_dc, v_when, v_actor
    from public.wp_labor_costs where work_package_id = p_source_id;
  if not found then
    raise exception 'post_labor_freeze_to_gl: labor cost not found' using errcode = 'P0001';
  end if;

  select project_id into v_project from public.work_packages where id = p_source_id;

  -- Reverse the WP's current labor entry (re-freeze auto-correct).
  select e.id into v_old from public.journal_entries e
    where e.source_table = 'wp_labor_costs' and e.source_id = p_source_id
      and e.source_event = 'labor_freeze' and e.status = 'posted'
      and not exists (select 1 from public.journal_entries r where r.reversal_of = e.id)
    limit 1;
  if v_old is not null then
    perform public.reverse_journal_internal(v_old, v_actor, 'auto-correct: labor re-frozen');
  end if;

  if coalesce(v_own, 0) = 0 and coalesce(v_dc, 0) = 0 then
    return null;  -- nothing to accrue
  end if;

  if coalesce(v_own, 0) > 0 then
    v_lines := v_lines
      || jsonb_build_object('account_code', '1400', 'debit', v_own,
                            'project_id', v_project, 'work_package_id', p_source_id)
      || jsonb_build_object('account_code', '2130', 'credit', v_own);
  end if;
  if coalesce(v_dc, 0) > 0 then
    v_lines := v_lines
      || jsonb_build_object('account_code', '1400', 'debit', v_dc,
                            'project_id', v_project, 'work_package_id', p_source_id)
      || jsonb_build_object('account_code', '2110', 'credit', v_dc);
  end if;

  return public.post_journal_internal(
    v_when, 'wp_labor_costs', p_source_id, 'labor_freeze', 'Labor accrual', v_lines, null, v_actor);
end;
$$;
revoke all on function public.post_labor_freeze_to_gl(uuid) from public, anon, authenticated;
grant execute on function public.post_labor_freeze_to_gl(uuid) to service_role;

-- ----------------------------------------------------------------------------
-- Rental batch → the inbound intercompany commitment:
--   Dr WIP-construction (1400) monthly_rate  /  Cr Intercompany AP (2120) [owner party].
-- No project dim (a batch is not allocated to a project until spec 146 U2). entry
-- date = starts_on. Reverse-and-reposts this batch's current entry (re-drain safety).
create function public.post_rental_batch_to_gl(p_source_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_rate    numeric(14,2);
  v_starts  date;
  v_owner   uuid;
  v_actor   uuid;
  v_old     uuid;
  v_lines   jsonb;
begin
  select monthly_rate, starts_on, owner_id, created_by
    into v_rate, v_starts, v_owner, v_actor
    from public.equipment_rental_batches where id = p_source_id;
  if not found then
    raise exception 'post_rental_batch_to_gl: batch not found' using errcode = 'P0001';
  end if;

  select e.id into v_old from public.journal_entries e
    where e.source_table = 'equipment_rental_batches' and e.source_id = p_source_id
      and e.source_event = 'rental_batch' and e.status = 'posted'
      and not exists (select 1 from public.journal_entries r where r.reversal_of = e.id)
    limit 1;
  if v_old is not null then
    perform public.reverse_journal_internal(v_old, v_actor, 'auto-correct: rental batch re-posted');
  end if;

  if coalesce(v_rate, 0) = 0 then
    return null;
  end if;

  v_lines := jsonb_build_array(
    jsonb_build_object('account_code', '1400', 'debit',  v_rate),
    jsonb_build_object('account_code', '2120', 'credit', v_rate, 'equipment_owner_id', v_owner));

  return public.post_journal_internal(
    v_starts, 'equipment_rental_batches', p_source_id, 'rental_batch', 'Equipment rental', v_lines, null, v_actor);
end;
$$;
revoke all on function public.post_rental_batch_to_gl(uuid) from public, anon, authenticated;
grant execute on function public.post_rental_batch_to_gl(uuid) to service_role;

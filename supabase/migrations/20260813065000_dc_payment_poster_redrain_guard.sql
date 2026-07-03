-- Re-drain guard on the DC-payment GL poster — twin of the spec 249 U1c
-- receipt-poster guard (20260813064200), chipped there as a separate unit.
-- Flaw: if R1 was superseded by R2 and R2's drain already reversed R1's entry,
-- re-running R1's outbox job found no un-reversed entry to reverse (the
-- not-exists filter skips reversed ones) and re-posted R1 UNPAIRED. Guard: a
-- row that ANY newer row supersedes is non-current — post nothing for it; the
-- successor's own drain owns the reversal.
--
-- Body sourced from LIVE via pg_get_functiondef (house rule), verified equal
-- to 20260783000000. CREATE OR REPLACE — signature unchanged, grants preserved.

create or replace function public.post_dc_payment_to_gl(p_source_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_paid    numeric(14,2);
  v_paid_at date;
  v_actor   uuid;
  v_superseded uuid;
  v_old     uuid;
  v_lines   jsonb;
begin
  select paid_amount, paid_at, paid_by, superseded_by
    into v_paid, v_paid_at, v_actor, v_superseded
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

  -- Re-drain guard: a row a newer row supersedes is NON-CURRENT — never (re)post
  -- it. Its successor's drain owns any reversal of its prior entry.
  if exists (select 1 from public.dc_payments n where n.superseded_by = p_source_id) then
    return null;
  end if;

  -- ADR 0062: the DC payee is a worker, not a contractor; journal_lines has no
  -- worker dimension, so the DC-clearing line carries no party.
  v_lines := jsonb_build_array(
    jsonb_build_object('account_code', '2110', 'debit',  v_paid),
    jsonb_build_object('account_code', '1110', 'credit', v_paid));

  return public.post_journal_internal(
    v_paid_at, 'dc_payments', p_source_id, 'dc_payment', 'DC payment', v_lines, null, v_actor);
end;
$$;

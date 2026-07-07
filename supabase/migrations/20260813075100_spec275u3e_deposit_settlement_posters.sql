-- Spec 275 U3e — the GL posters for the deposit lifecycle and the settlement.
--
-- Two posters, both drain-called (owner context), both with the reverse-and-repost
-- (re-drain) guard that every poster in this codebase carries:
--
--   post_rental_deposit_to_gl   — the deposit PAID leg. Fires when the agreement's
--     deposit_paid_date is set (Dr 1320 prepaid / Cr 1110 Bank). Routed under the
--     SYNTHETIC source_table 'rental_deposits' (NOT 'equipment_rental_batches',
--     which the drain already routes to post_rental_batch_to_gl for the rent) so
--     two events on one row reach two posters without collision.
--
--   post_rental_settlement_to_gl — the THIN settlement entry (operator decision
--     2026-07-07). The rent is already posted at batch creation and each fee at
--     charge time, so this poster books ONLY the not-yet-booked legs: overtime
--     (Dr 1400 / Cr 2100 supplier) + the deposit RELEASE (refunded Dr 1110 / Cr
--     1320; forfeited Dr 1400 / Cr 1320). It does NOT re-post base/fees/VAT (would
--     double-count), and does NOT post WHT (the issued wht_certificate does that,
--     Dr 2100 / Cr 2210). A settlement with no overtime and no deposit movement
--     posts no entry (nothing new to book).

-- ===========================================================================
-- Deposit enqueue: a dedicated trigger on equipment_rental_batches that enqueues
-- under the synthetic 'rental_deposits' source_table. INSERT + UPDATE split (a
-- WHEN clause on an INSERT-or-UPDATE trigger may not reference OLD — 42P17).
-- ===========================================================================
create function public.enqueue_rental_deposit_gl_tg()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.enqueue_gl_posting('rental_deposits', new.id, 'rental_deposit');
  return new;
end;
$$;

create trigger equipment_rental_batches_enqueue_deposit_gl_ins
  after insert on public.equipment_rental_batches
  for each row
  when (new.deposit_amount > 0 and new.deposit_paid_date is not null)
  execute function public.enqueue_rental_deposit_gl_tg();

create trigger equipment_rental_batches_enqueue_deposit_gl_upd
  after update on public.equipment_rental_batches
  for each row
  when (new.deposit_amount > 0 and new.deposit_paid_date is not null
        and new.deposit_paid_date is distinct from old.deposit_paid_date)
  execute function public.enqueue_rental_deposit_gl_tg();

-- ===========================================================================
-- post_rental_deposit_to_gl(batch_id) — Dr 1320 prepaid deposit / Cr 1110 Bank,
-- dated deposit_paid_date. Not a human RPC; drain-only.
-- ===========================================================================
create function public.post_rental_deposit_to_gl(p_source_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_amount numeric(14, 2);
  v_when   date;
  v_actor  uuid;
  v_old    uuid;
  v_lines  jsonb;
begin
  select deposit_amount, deposit_paid_date, created_by
    into v_amount, v_when, v_actor
    from public.equipment_rental_batches where id = p_source_id;
  if not found then
    raise exception 'post_rental_deposit_to_gl: agreement not found' using errcode = 'P0001';
  end if;
  -- Nothing to post if there is no paid deposit.
  if coalesce(v_amount, 0) <= 0 or v_when is null then
    return null;
  end if;

  -- Reverse-and-repost (re-drain) idempotency guard.
  select e.id into v_old from public.journal_entries e
   where e.source_table = 'rental_deposits' and e.source_id = p_source_id
     and e.source_event = 'rental_deposit' and e.status = 'posted'
     and not exists (select 1 from public.journal_entries r where r.reversal_of = e.id)
   limit 1;
  if v_old is not null then
    perform public.reverse_journal_internal(v_old, v_actor, 'auto-correct: rental deposit re-posted');
  end if;

  v_lines := jsonb_build_array(
    jsonb_build_object('account_code', '1320', 'debit',  v_amount),
    jsonb_build_object('account_code', '1110', 'credit', v_amount));

  return public.post_journal_internal(
    v_when, 'rental_deposits', p_source_id, 'rental_deposit', 'Rental deposit paid', v_lines, null, v_actor);
end;
$$;
revoke all on function public.post_rental_deposit_to_gl(uuid) from public, anon, authenticated;
grant execute on function public.post_rental_deposit_to_gl(uuid) to service_role;

-- ===========================================================================
-- post_rental_settlement_to_gl(settlement_id) — the thin settlement entry.
-- Mirrors post_subcontract_payment_to_gl's supersede-reversal + re-drain guard.
-- ===========================================================================
create function public.post_rental_settlement_to_gl(p_source_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row      public.rental_settlements%rowtype;
  v_supplier uuid;
  v_old      uuid;
  v_lines    jsonb := '[]'::jsonb;
begin
  select * into v_row from public.rental_settlements where id = p_source_id;
  if not found then
    raise exception 'post_rental_settlement_to_gl: settlement not found' using errcode = 'P0001';
  end if;

  select supplier_id into v_supplier
    from public.equipment_rental_batches where id = v_row.agreement_id;

  -- A superseding row voids the row it replaces: reverse that entry first.
  if v_row.superseded_by is not null then
    select e.id into v_old from public.journal_entries e
      where e.source_table = 'rental_settlements' and e.source_id = v_row.superseded_by
        and e.source_event = 'rental_settlement' and e.status = 'posted'
        and not exists (select 1 from public.journal_entries r where r.reversal_of = e.id)
      limit 1;
    if v_old is not null then
      perform public.reverse_journal_internal(v_old, v_row.created_by, 'void: superseded rental settlement');
    end if;
  end if;

  -- Reverse this row's own current entry (re-drain safety).
  select e.id into v_old from public.journal_entries e
    where e.source_table = 'rental_settlements' and e.source_id = p_source_id
      and e.source_event = 'rental_settlement' and e.status = 'posted'
      and not exists (select 1 from public.journal_entries r where r.reversal_of = e.id)
    limit 1;
  if v_old is not null then
    perform public.reverse_journal_internal(v_old, v_row.created_by, 'auto-correct: rental settlement re-posted');
  end if;

  -- Re-drain guard: a row a newer row supersedes is NON-CURRENT — never (re)post it.
  if exists (select 1 from public.rental_settlements n where n.superseded_by = p_source_id) then
    return null;
  end if;

  -- Thin: book only the not-yet-booked legs. Each pair balances independently.
  if v_row.overtime_amount > 0 then
    v_lines := v_lines
      || jsonb_build_object('account_code', '1400', 'debit',  v_row.overtime_amount)
      || jsonb_build_object('account_code', '2100', 'credit', v_row.overtime_amount, 'supplier_id', v_supplier);
  end if;
  if v_row.deposit_refunded > 0 then
    v_lines := v_lines
      || jsonb_build_object('account_code', '1110', 'debit',  v_row.deposit_refunded)
      || jsonb_build_object('account_code', '1320', 'credit', v_row.deposit_refunded);
  end if;
  if v_row.deposit_forfeited > 0 then
    v_lines := v_lines
      || jsonb_build_object('account_code', '1400', 'debit',  v_row.deposit_forfeited)
      || jsonb_build_object('account_code', '1320', 'credit', v_row.deposit_forfeited);
  end if;

  -- Nothing new to book (rent + fees already posted; no overtime, no deposit move).
  if jsonb_array_length(v_lines) = 0 then
    return null;
  end if;

  return public.post_journal_internal(
    v_row.invoice_date, 'rental_settlements', p_source_id, 'rental_settlement',
    'Rental settlement', v_lines, null, v_row.created_by);
end;
$$;
revoke all on function public.post_rental_settlement_to_gl(uuid) from public, anon, authenticated;
grant execute on function public.post_rental_settlement_to_gl(uuid) to service_role;

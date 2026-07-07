-- Spec 275 U0 / ADR 0078 — repoint the rental-batch GL poster to trade AP.
-- PRI is now a generic vendor, so the payable moves from 2120 (AP-intercompany, owner
-- party) to 2100 (AP-trade, SUPPLIER party) — matching post_purchase_to_gl and the store
-- receipt posters, which credit 2100 with a supplier_id party.
--
-- Re-sourced byte-for-byte from the LIVE post_rental_batch_to_gl (20260743000100,
-- confirmed latest — no later redefinition). ONLY the payee select, the credit account,
-- and the party key change: owner_id → supplier_id, '2120'/equipment_owner_id →
-- '2100'/supplier_id. The reverse-and-repost (re-drain) guard is preserved verbatim.
--
-- NOTE: batches were dormant (no create UI ever shipped), so there are no posted rental
-- entries to re-account; the repoint takes effect for the first batch created in U1.
-- Any pre-existing posted entry keeps its 2120 line until its batch is re-posted (moot at 0).
create or replace function public.post_rental_batch_to_gl(p_source_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_rate     numeric(14,2);
  v_starts   date;
  v_supplier uuid;
  v_actor    uuid;
  v_old      uuid;
  v_lines    jsonb;
begin
  select monthly_rate, starts_on, supplier_id, created_by
    into v_rate, v_starts, v_supplier, v_actor
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
    jsonb_build_object('account_code', '2100', 'credit', v_rate, 'supplier_id', v_supplier));

  return public.post_journal_internal(
    v_starts, 'equipment_rental_batches', p_source_id, 'rental_batch', 'Equipment rental', v_lines, null, v_actor);
end;
$$;
revoke all on function public.post_rental_batch_to_gl(uuid) from public, anon, authenticated;
grant execute on function public.post_rental_batch_to_gl(uuid) to service_role;

-- Spec 275 U2c — the write + GL layer for rental charges:
--   1. add_rental_charge         — the create-gate RPC (records one fee)
--   2. void_rental_charge        — the manager-gate RPC (un-books one fee)
--   3. post_rental_charge_to_gl  — the internal poster (the journal entry)
--
-- GL policy (ADR 0057 direct-posting; the spec-260 charge precedent + the
-- post_rental_batch_to_gl shape): one journal entry per charge, through the
-- async outbox. A rental batch has NO member lines (unlike a PO), so there is no
-- proportional split — the whole net posts to a single 1400 WIP leg, undimensioned,
-- exactly as post_rental_batch_to_gl posts the rent. Dr 1400 net + Dr 1300 Input
-- VAT / Cr 2100 AP (gross, supplier party). All five charge types are positive
-- debit costs — there is no discount/contra type (unlike spec 260).

-- ===========================================================================
-- 1. add_rental_charge — create gate: the 5-role rental create-audience
--    (project_manager / super_admin / procurement / procurement_manager /
--    project_director), identical to the spec-261-widened add_purchase_order_charge
--    and to create_equipment_rental_batch. amount>0 and 'other'-needs-note are
--    enforced by the table CHECKs (→ 23514), not re-checked here. The AFTER-INSERT
--    trigger (U2b) enqueues the GL posting job.
-- ===========================================================================
create function public.add_rental_charge(
  p_batch_id    uuid,
  p_charge_type public.rental_charge_type,
  p_amount      numeric,
  p_vat_rate    numeric,
  p_note        text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_batch_id  uuid;
  v_charge_id uuid;
begin
  if public.current_user_role() is null
     or public.current_user_role()
          not in ('project_manager', 'super_admin', 'procurement',
                  'procurement_manager', 'project_director') then
    raise exception 'add_rental_charge: role not permitted'
      using errcode = '42501';
  end if;

  select id into v_batch_id
    from public.equipment_rental_batches where id = p_batch_id;
  if v_batch_id is null then
    raise exception 'add_rental_charge: rental batch not found'
      using errcode = 'P0001';
  end if;

  -- The table CHECKs enforce amount>0 (23514) and the 'other'-needs-note rule
  -- (a whitespace-only note collapses to NULL here → the CHECK fires 23514).
  insert into public.rental_charges
    (rental_batch_id, charge_type, amount, vat_rate, note, created_by)
  values
    (p_batch_id, p_charge_type, p_amount, coalesce(p_vat_rate, 0),
     nullif(btrim(coalesce(p_note, '')), ''), auth.uid())
  returning id into v_charge_id;

  insert into public.audit_log
    (actor_id, actor_role, action, target_table, target_id, payload)
  values
    (auth.uid(), public.current_user_role(),
     'rental_charge_add', 'rental_charges', v_charge_id,
     jsonb_build_object(
       'rental_batch_id', p_batch_id,
       'charge_type',     p_charge_type,
       'amount',          p_amount));

  return v_charge_id;
end;
$$;

revoke all on function public.add_rental_charge(uuid, public.rental_charge_type, numeric, numeric, text)
  from public, anon;
grant execute on function public.add_rental_charge(uuid, public.rental_charge_type, numeric, numeric, text)
  to authenticated;

-- ===========================================================================
-- 2. void_rental_charge — manager gate. Adding a fee is routine data entry;
--    removing one un-books recorded money, so it is the manager tier PLUS
--    procurement_manager (is_manager = PM/super/PD, spec 261 item 2 adds procmgr).
--    GL safety mirrors void_purchase_order_charge: reverse a posted entry, or
--    skip a still-pending job (mutually exclusive per charge) — then DELETE the
--    row. The table has no supersede column; the audit row (before the delete)
--    is the permanent record.
-- ===========================================================================
create function public.void_rental_charge(p_charge_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_charge    public.rental_charges%rowtype;
  v_old_entry uuid;
begin
  if not (public.is_manager(public.current_user_role())
          or public.current_user_role() = 'procurement_manager') then
    raise exception 'void_rental_charge: role not permitted'
      using errcode = '42501';
  end if;

  select * into v_charge
    from public.rental_charges where id = p_charge_id;
  if not found then
    raise exception 'void_rental_charge: charge not found'
      using errcode = 'P0001';
  end if;

  -- reverse_journal_internal takes an ENTRY id — look the posted, not-yet-
  -- reversed entry up by (source_table, source_id, source_event) first.
  select e.id into v_old_entry
    from public.journal_entries e
   where e.source_table = 'rental_charges'
     and e.source_id    = p_charge_id
     and e.source_event = 'rental_charge'
     and e.status       = 'posted'
     and not exists (select 1 from public.journal_entries r where r.reversal_of = e.id)
   limit 1;
  if v_old_entry is not null then
    perform public.reverse_journal_internal(
      v_old_entry, auth.uid(), 'void: rental charge removed');
  end if;

  update public.gl_posting_outbox
     set status = 'skipped'
   where source_table = 'rental_charges'
     and source_id    = p_charge_id
     and source_event = 'rental_charge'
     and status in ('pending', 'posting');

  -- Audit BEFORE the delete (the payload captures the row about to vanish).
  insert into public.audit_log
    (actor_id, actor_role, action, target_table, target_id, payload)
  values
    (auth.uid(), public.current_user_role(),
     'rental_charge_void', 'rental_charges', p_charge_id,
     jsonb_build_object(
       'rental_batch_id', v_charge.rental_batch_id,
       'charge_type',     v_charge.charge_type,
       'amount',          v_charge.amount));

  delete from public.rental_charges where id = p_charge_id;
end;
$$;

revoke all on function public.void_rental_charge(uuid) from public, anon;
grant execute on function public.void_rental_charge(uuid) to authenticated;

-- ===========================================================================
-- 3. post_rental_charge_to_gl(charge_id) — the internal poster. NOT a human RPC:
--    revoked from authenticated; the drain (SECURITY DEFINER, runs as owner) is
--    the only caller. Mirrors post_rental_batch_to_gl (the reverse-and-repost
--    re-drain guard) + the spec-260 gross-inclusive VAT split, minus the member
--    allocation (a batch has no lines). One 1400 WIP Dr (net), one 1300 Input VAT
--    Dr (when vat_rate > 0), one 2100 AP Cr (gross, supplier party).
-- ===========================================================================
create function public.post_rental_charge_to_gl(p_source_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_charge   public.rental_charges%rowtype;
  v_supplier uuid;
  v_actor    uuid;
  v_at       date;
  v_gross    numeric(14, 2);
  v_net      numeric(14, 2);
  v_vat      numeric(14, 2);
  v_rate     numeric;
  v_old      uuid;
  v_lines    jsonb;
begin
  select * into v_charge
    from public.rental_charges where id = p_source_id;
  if not found then
    raise exception 'post_rental_charge_to_gl: charge not found'
      using errcode = 'P0001';
  end if;

  select supplier_id into v_supplier
    from public.equipment_rental_batches where id = v_charge.rental_batch_id;

  v_gross := v_charge.amount;
  v_rate  := coalesce(v_charge.vat_rate, 0);
  v_actor := v_charge.created_by;
  v_at    := v_charge.created_at::date;

  -- Reverse-and-repost (re-drain) idempotency guard — mirrors post_rental_batch_to_gl.
  select e.id into v_old
    from public.journal_entries e
   where e.source_table = 'rental_charges' and e.source_id = p_source_id
     and e.source_event = 'rental_charge' and e.status = 'posted'
     and not exists (select 1 from public.journal_entries r where r.reversal_of = e.id)
   limit 1;
  if v_old is not null then
    perform public.reverse_journal_internal(v_old, v_actor, 'auto-correct: rental charge re-posted');
  end if;

  -- Net / Input VAT from gross + rate (ADR 0045, gross-inclusive); net + VAT = gross.
  if v_rate <= 0 then
    v_net := v_gross;
    v_vat := 0;
  else
    v_net := round(v_gross / (1 + v_rate / 100), 2);
    v_vat := v_gross - v_net;
  end if;

  -- No member split (a batch has no lines): the whole net posts to one 1400 WIP
  -- leg, undimensioned, exactly as the rent poster does. Cr 2100 gross, supplier.
  v_lines := jsonb_build_array(
    jsonb_build_object('account_code', '1400', 'debit', v_net));
  if v_vat <> 0 then
    v_lines := v_lines || jsonb_build_object('account_code', '1300', 'debit', v_vat);
  end if;
  v_lines := v_lines || jsonb_build_object('account_code', '2100', 'credit', v_gross,
                          'supplier_id', v_supplier);

  return public.post_journal_internal(
    v_at, 'rental_charges', p_source_id, 'rental_charge',
    'Rental charge: ' || v_charge.charge_type::text, v_lines, null, v_actor);
end;
$$;

revoke all on function public.post_rental_charge_to_gl(uuid) from public, anon, authenticated;
grant execute on function public.post_rental_charge_to_gl(uuid) to service_role;

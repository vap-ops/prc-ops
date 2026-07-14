-- spec 312 follow-up — void_equipment_rental_batch settlement-gate fix.
--
-- The 075781 gate refused a void when ANY public.rental_settlements row existed
-- for the batch. Settlements are append-only (corrections supersede, never
-- delete), so a batch that was EVER settled could never be voided through the
-- RPC — contradicting the RPC's own contract that downstream money merely has
-- to be "unwound through its own path first" (hit live 2026-07-14, batch
-- 320d800d: settlement superseded to zero, void still refused).
--
-- Fix: block only when a CURRENT settlement — a chain head, i.e. a row no other
-- row supersedes — still carries money (net_amount, vat_amount, wht_amount,
-- deposit_refunded, deposit_forfeited; all NOT NULL). A chain superseded down
-- to zero is already unwound: the supersede poster contra-reverses its GL, and
-- the void's own reversal loop below only touches batch-sourced entries.
-- Note supersede_rental_settlement carries wht_amount over from the target row
-- by design (the WHT certificate exists), so a wht-bearing settlement keeps
-- blocking until that is unwound too — intended.
--
-- Everything outside the settlement gate is the LIVE 075781 body, verbatim.

create or replace function public.void_equipment_rental_batch(
  p_batch_id uuid,
  p_reason   text default null
)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_role     public.user_role := public.current_user_role();
  v_status   text;
  v_supplier uuid;
  v_rate     numeric(14,2);
  v_old      uuid;
begin
  -- Back-office gate, identical to create_equipment_rental_batch — the same
  -- audience that can record a rental (incl. plain procurement) can undo its
  -- own mistake.
  if v_role is null
       or v_role not in ('project_manager', 'super_admin', 'procurement',
                         'procurement_manager', 'project_director') then
    raise exception 'void_equipment_rental_batch: role not permitted'
      using errcode = '42501';
  end if;

  select status::text, supplier_id, monthly_rate
    into v_status, v_supplier, v_rate
    from public.equipment_rental_batches
   where id = p_batch_id;
  if v_status is null then
    raise exception 'void_equipment_rental_batch: batch not found'
      using errcode = 'RB404';
  end if;

  -- Only an active batch is void-able here; a settled/returned/already-cancelled
  -- batch is not.
  if v_status <> 'active' then
    raise exception 'void_equipment_rental_batch: only an active batch can be voided'
      using errcode = 'RB409';
  end if;

  -- Downstream money must be unwound through its own path first: block only
  -- when a CURRENT settlement (chain head — no other row supersedes it) still
  -- carries money. Settlements are append-only, so a chain superseded down to
  -- zero must NOT block — its GL was already contra-reversed by the supersede
  -- poster.
  if exists (
    select 1
      from public.rental_settlements s
     where s.agreement_id = p_batch_id
       and not exists (select 1 from public.rental_settlements n
                        where n.superseded_by = s.id)
       and (s.net_amount        <> 0
         or s.vat_amount        <> 0
         or s.wht_amount        <> 0
         or s.deposit_refunded  <> 0
         or s.deposit_forfeited <> 0)
  ) then
    raise exception 'void_equipment_rental_batch: batch has a live settlement'
      using errcode = 'RB409';
  end if;
  if exists (select 1 from public.rental_charges where rental_batch_id = p_batch_id) then
    raise exception 'void_equipment_rental_batch: batch has charges'
      using errcode = 'RB409';
  end if;

  -- Reverse every posted GL entry sourced from this batch (append-only contra),
  -- and skip any still-pending outbox job — identical shape to
  -- void_purchase_order, so a voided batch leaves no phantom posting behind. A
  -- batch can post TWO entries: the rent leg (source_table='equipment_rental_batches')
  -- and, when a deposit was paid, a deposit leg the enqueue trigger books under the
  -- synthetic source_table='rental_deposits' with source_id = the batch id — both
  -- must be reversed.
  for v_old in
    select e.id
      from public.journal_entries e
     where e.source_table in ('equipment_rental_batches', 'rental_deposits')
       and e.source_id    = p_batch_id
       and e.status       = 'posted'
       and not exists (select 1 from public.journal_entries r where r.reversal_of = e.id)
  loop
    perform public.reverse_journal_internal(
      v_old, auth.uid(), 'void: rental batch cancelled');
  end loop;

  update public.gl_posting_outbox
     set status = 'skipped'
   where source_table in ('equipment_rental_batches', 'rental_deposits')
     and source_id    = p_batch_id
     and status in ('pending', 'posting');

  -- Cancel the batch. Allocations are kept as harmless history (a cancelled
  -- batch is hidden by the list view regardless).
  update public.equipment_rental_batches
     set status = 'cancelled'
   where id = p_batch_id;

  insert into public.audit_log
    (actor_id, actor_role, action, target_table, target_id, payload)
  values
    (auth.uid(), v_role, 'equipment_batch_void', 'equipment_rental_batches', p_batch_id,
     jsonb_build_object(
       'supplier_id',  v_supplier,
       'monthly_rate', v_rate,
       'reason',       nullif(btrim(coalesce(p_reason, '')), '')));
end;
$function$;

revoke all on function public.void_equipment_rental_batch(uuid, text) from public, anon;
grant execute on function public.void_equipment_rental_batch(uuid, text) to authenticated;

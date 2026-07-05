-- Spec 266 / ADR 0073 — Worker identity merge: DC → ช่าง (one worker; pay_type × employment_type).
--
-- DESTRUCTIVE greenfield rebuild. Operator-authorized 2026-07-05 ("Go"); greenfield
-- verified live the same day (workers = 1 test row "C Lek", dc_payments = 0,
-- labor_logs = 0, wage/GL outbox+journal for dc_payment = 0), so there is no
-- data-migration risk. Supersedes ADR 0062's own/dc `worker_type` + `dc_arrangement`
-- and removes the term "DC" from the schema.
--
-- Every SECURITY DEFINER function that referenced the doomed objects is rebuilt in
-- THIS one atomic migration ("remove all refs first" — a DROP TYPE fails while any
-- signature uses it, and a renamed/dropped column breaks any body that reads it).
-- Function bodies were re-sourced VERBATIM from LIVE (pg_get_functiondef, 2026-07-05)
-- and changed ONLY where a doomed token appears. Postgres DDL is transactional, so
-- the whole file applies or rolls back as a unit.
--
-- Old → new mapping (applied to the model, not data): own → (monthly, permanent);
-- dc+regular → (daily, permanent); dc+temporary → (daily, temporary).
--
-- NOT in scope (recorded, not changed): the audit_action value `dc_payment_recorded`
-- (internal label, not in the spec's rename list — kept); wp_labor_costs.own_cost /
-- dc_cost column names (kept — semantically own_cost = monthly labor, dc_cost = daily
-- labor); the p_include_dc Nova param rename + Nova pgTAP fixtures (U5); the portal
-- role flip + create_worker_invite loosening (U7); workers.contractor_id kept nullable
-- (ADR 0073 §6 — spec258 crew is a separate table, no collision).

-- ============================================================================
-- 0. Wipe the greenfield test rows. (No append-only guards on these tables —
--    verified. worker_project_moves + worker_invites reference workers NO ACTION,
--    so delete them first. labor_logs / dc_payments already 0.)
-- ============================================================================
delete from public.worker_project_moves;
delete from public.worker_invites;
delete from public.workers;

-- ============================================================================
-- 1. New orthogonal enums.
-- ============================================================================
create type public.pay_type        as enum ('monthly', 'daily');
create type public.employment_type as enum ('permanent', 'temporary');

-- ============================================================================
-- 2. workers — add pay_type + employment_type; drop the two enum-coupling CHECKs
--    and the worker_type + dc_arrangement columns. contractor_id kept (nullable).
-- ============================================================================
alter table public.workers
  add column pay_type        public.pay_type        not null default 'monthly',
  add column employment_type public.employment_type not null default 'permanent';

alter table public.workers
  drop constraint workers_arrangement_dc_only,
  drop constraint workers_own_has_no_contractor,
  drop column worker_type,
  drop column dc_arrangement;

-- authenticated may read the two new (non-money) fields, like name/level.
grant select (pay_type, employment_type) on public.workers to authenticated;

-- ============================================================================
-- 3. labor_logs — worker_type_snapshot → pay_type_snapshot (retype to pay_type);
--    drop the vestigial contractor_id_snapshot. Two portal-read RLS policies
--    reference the doomed snapshot columns and must be handled first.
-- ============================================================================
alter table public.labor_logs add column pay_type_snapshot public.pay_type;
update public.labor_logs
   set pay_type_snapshot = case when worker_type_snapshot = 'own'
                                then 'monthly'::public.pay_type
                                else 'daily'::public.pay_type end;

-- Drop both policies before the columns (they depend on them). The
-- contractor-bound read is now vestigial — contractor_id_snapshot is gone and
-- spec 258 moved subcontractor crew to its own table, so a subcontractor has no
-- ช่าง labor logs; it is RETIRED. The self-worker portal read is recreated on
-- pay_type_snapshot below. (U7 finalizes the portal role split / RLS.)
drop policy "labor_logs readable by bound contractor" on public.labor_logs;
drop policy "labor_logs readable by self worker (portal)" on public.labor_logs;

alter table public.labor_logs
  drop column worker_type_snapshot,
  drop column contractor_id_snapshot;
alter table public.labor_logs alter column pay_type_snapshot set not null;

create policy "labor_logs readable by self worker (portal)"
  on public.labor_logs
  for select
  to authenticated
  using (pay_type_snapshot = 'daily'
         and worker_id = (select public.current_user_worker_id()));

-- ============================================================================
-- 4. Rename the DC-payment domain off "DC".
-- ============================================================================
alter type public.dc_payment_method rename to wage_payment_method;

alter table public.dc_payments rename to wage_payments;
alter index public.dc_payments_pkey                 rename to wage_payments_pkey;
alter index public.dc_payments_worker_period_idx    rename to wage_payments_worker_period_idx;
alter index public.dc_payments_one_current_per_period rename to wage_payments_one_current_per_period;
alter table public.wage_payments rename constraint dc_payments_superseded_by_fkey
  to wage_payments_superseded_by_fkey;

-- Append-only block trigger + its function (a table rename leaves the old names).
drop trigger dc_payments_no_update_delete on public.wage_payments;
drop function public.dc_payments_block_mutation();
create function public.wage_payments_block_mutation()
returns trigger language plpgsql as $$
begin
  raise exception 'wage_payments is append-only (spec 127): no % allowed', tg_op
    using errcode = 'P0001';
end;
$$;
create trigger wage_payments_no_update_delete
  before delete or update on public.wage_payments
  for each row execute function public.wage_payments_block_mutation();

-- GL enqueue trigger (generic enqueue_gl_posting_tg: source_table = tg_table_name =
-- 'wage_payments' now; source_event = tg_argv[0] → 'wage_payment'). Greenfield: no
-- outbox/journal rows carry the old 'dc_payment' string, so the switch is clean.
drop trigger dc_payments_enqueue_gl_posting on public.wage_payments;
create trigger wage_payments_enqueue_gl_posting
  after insert on public.wage_payments
  for each row execute function public.enqueue_gl_posting_tg('wage_payment', 'id');

-- ============================================================================
-- 5. Rebuild every function that referenced the doomed objects. Bodies verbatim
--    from LIVE except the doomed-token swaps. DROP+CREATE where the signature or
--    return changes (grants re-applied to match the LIVE ACL exactly).
-- ============================================================================

-- 5.1 create_worker — signature: drop p_type/p_arrangement, add p_pay_type/p_employment_type.
drop function public.create_worker(text, worker_type, numeric, uuid, uuid, text, dc_arrangement, text, text, text, text, text);
create function public.create_worker(
  p_name                text,
  p_pay_type            public.pay_type,
  p_employment_type     public.employment_type,
  p_day_rate            numeric default 0,
  p_contractor          uuid    default null,
  p_user                uuid    default null,
  p_note                text    default null,
  p_phone               text    default null,
  p_tax_id              text    default null,
  p_bank_name           text    default null,
  p_bank_account_number text    default null,
  p_bank_account_name   text    default null)
 returns uuid
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_id uuid;
  v_name text := trim(coalesce(p_name, ''));
begin
  if not public.is_back_office(public.current_user_role()) then
    raise exception 'create_worker: role not permitted' using errcode = '42501';
  end if;
  if length(v_name) = 0 or length(v_name) > 120 then
    raise exception 'create_worker: invalid name' using errcode = 'P0001';
  end if;
  if p_day_rate is null or p_day_rate < 0 then
    raise exception 'create_worker: invalid day rate' using errcode = 'P0001';
  end if;

  insert into public.workers (name, pay_type, employment_type, contractor_id, user_id,
                              day_rate, created_by, note,
                              phone, tax_id, bank_name, bank_account_number,
                              bank_account_name)
  values (v_name, p_pay_type, p_employment_type, p_contractor, p_user, p_day_rate, auth.uid(),
          nullif(btrim(p_note), ''),
          nullif(btrim(p_phone), ''), nullif(btrim(p_tax_id), ''),
          nullif(btrim(p_bank_name), ''), nullif(btrim(p_bank_account_number), ''),
          nullif(btrim(p_bank_account_name), ''))
  returning id into v_id;

  insert into public.audit_log (action, actor_id, actor_role, target_table,
                                target_id, payload)
  values ('worker_change', auth.uid(), public.current_user_role(), 'workers',
          v_id, jsonb_build_object('kind', 'create', 'name', v_name,
                                   'pay_type', p_pay_type,
                                   'day_rate', p_day_rate,
                                   'employment_type', p_employment_type));
  return v_id;
end;
$function$;
revoke all on function public.create_worker(text, public.pay_type, public.employment_type, numeric, uuid, uuid, text, text, text, text, text, text) from public, anon;
grant execute on function public.create_worker(text, public.pay_type, public.employment_type, numeric, uuid, uuid, text, text, text, text, text, text) to authenticated;

-- 5.2 update_worker — signature: drop p_arrangement, add p_pay_type/p_employment_type.
drop function public.update_worker(uuid, text, boolean, uuid, text, dc_arrangement, text, text, text, text, text);
create function public.update_worker(
  p_id                  uuid,
  p_name                text    default null,
  p_active              boolean default null,
  p_pay_type            public.pay_type        default null,
  p_employment_type     public.employment_type default null,
  p_contractor          uuid    default null,
  p_note                text    default null,
  p_phone               text    default null,
  p_tax_id              text    default null,
  p_bank_name           text    default null,
  p_bank_account_number text    default null,
  p_bank_account_name   text    default null)
 returns void
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_row public.workers%rowtype;
  v_name text := nullif(trim(coalesce(p_name, '')), '');
begin
  if not public.is_back_office(public.current_user_role()) then
    raise exception 'update_worker: role not permitted' using errcode = '42501';
  end if;
  select * into v_row from public.workers where id = p_id;
  if not found then
    raise exception 'update_worker: worker not found' using errcode = 'P0001';
  end if;
  if v_name is not null and length(v_name) > 120 then
    raise exception 'update_worker: invalid name' using errcode = 'P0001';
  end if;

  -- Coalesce semantics: omitted = preserved. Note case-preserves so an explicit
  -- '' can clear it; payee text fields coalesce (edit replaces, omit preserves).
  update public.workers
     set name                = coalesce(v_name, name),
         active              = coalesce(p_active, active),
         pay_type            = coalesce(p_pay_type, pay_type),
         employment_type     = coalesce(p_employment_type, employment_type),
         contractor_id       = coalesce(p_contractor, contractor_id),
         phone               = coalesce(nullif(btrim(p_phone), ''), phone),
         tax_id              = coalesce(nullif(btrim(p_tax_id), ''), tax_id),
         bank_name           = coalesce(nullif(btrim(p_bank_name), ''), bank_name),
         bank_account_number = coalesce(nullif(btrim(p_bank_account_number), ''), bank_account_number),
         bank_account_name   = coalesce(nullif(btrim(p_bank_account_name), ''), bank_account_name),
         note                = case
                                 when p_note is null then note
                                 else nullif(btrim(p_note), '')
                               end
   where id = p_id;

  insert into public.audit_log (action, actor_id, actor_role, target_table,
                                target_id, payload)
  values ('worker_change', auth.uid(), public.current_user_role(), 'workers',
          p_id, jsonb_build_object('kind', 'update', 'name', v_name,
                                   'active', p_active,
                                   'pay_type', p_pay_type,
                                   'employment_type', p_employment_type));
end;
$function$;
revoke all on function public.update_worker(uuid, text, boolean, public.pay_type, public.employment_type, uuid, text, text, text, text, text, text) from public, anon;
grant execute on function public.update_worker(uuid, text, boolean, public.pay_type, public.employment_type, uuid, text, text, text, text, text, text) to authenticated;

-- 5.3 record_wage_payment (was record_dc_payment) — wage_payments + pay_type_snapshot.
create function public.record_wage_payment(p_worker uuid, p_from date, p_to date, p_paid_amount numeric, p_paid_at date, p_method public.wage_payment_method, p_reference text, p_note text)
 returns uuid
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_amount numeric(12,2);
  v_days   numeric(6,1);
  v_id     uuid;
begin
  -- Money: pm/super/director/procurement only (site_admin refused).
  if not public.is_back_office(public.current_user_role()) then
    raise exception 'record_wage_payment: role not permitted' using errcode = '42501';
  end if;

  perform 1 from public.workers where id = p_worker;
  if not found then
    raise exception 'record_wage_payment: worker not found' using errcode = 'P0001';
  end if;

  if p_to < p_from then
    raise exception 'record_wage_payment: period_to before period_from' using errcode = 'P0001';
  end if;
  if p_paid_amount is null or p_paid_amount < 0 then
    raise exception 'record_wage_payment: paid_amount must be >= 0' using errcode = 'P0001';
  end if;

  perform pg_advisory_xact_lock(hashtext(p_worker::text || p_from::text || p_to::text));

  if exists (
    select 1 from public.wage_payments d
    where d.worker_id = p_worker
      and d.period_from = p_from
      and d.period_to = p_to
      and not exists (select 1 from public.wage_payments n where n.superseded_by = d.id)
  ) then
    raise exception 'record_wage_payment: a payment already exists for this worker and period'
      using errcode = 'P0001';
  end if;

  -- Σ over CURRENT (non-superseded, non-tombstone) DAILY labor logs for this worker
  -- in the window. MUST match src/lib/labor/payroll.ts aggregatePayroll.
  select
    coalesce(sum((case ll.day_fraction when 'full' then 1.0 else 0.5 end)), 0),
    coalesce(sum((case ll.day_fraction when 'full' then 1.0 else 0.5 end) * ll.day_rate_snapshot), 0)
  into v_days, v_amount
  from public.labor_logs ll
  where ll.pay_type_snapshot = 'daily'
    and ll.worker_id = p_worker
    and ll.work_date between p_from and p_to
    and ll.day_fraction is not null
    and not exists (select 1 from public.labor_logs newer where newer.superseded_by = ll.id);

  insert into public.wage_payments (
    worker_id, period_from, period_to, computed_amount, computed_days,
    paid_amount, paid_at, method, reference, note, paid_by)
  values (
    p_worker, p_from, p_to, v_amount, v_days,
    p_paid_amount, p_paid_at, p_method,
    nullif(btrim(p_reference), ''), nullif(btrim(p_note), ''), auth.uid())
  returning id into v_id;

  insert into public.audit_log (action, actor_id, actor_role, target_table,
                                target_id, payload)
  values ('dc_payment_recorded', auth.uid(), public.current_user_role(),
          'wage_payments', v_id,
          jsonb_build_object('worker_id', p_worker,
                             'period_from', p_from, 'period_to', p_to,
                             'computed_amount', v_amount, 'computed_days', v_days,
                             'paid_amount', p_paid_amount, 'method', p_method));
  return v_id;
end;
$function$;
revoke all on function public.record_wage_payment(uuid, date, date, numeric, date, public.wage_payment_method, text, text) from public, anon;
grant execute on function public.record_wage_payment(uuid, date, date, numeric, date, public.wage_payment_method, text, text) to authenticated;
drop function public.record_dc_payment(uuid, date, date, numeric, date, public.wage_payment_method, text, text);

-- 5.4 get_my_wage_payments (was get_my_dc_payments).
create function public.get_my_wage_payments()
 returns setof public.wage_payments
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  select d.*
  from public.wage_payments d
  where public.current_user_worker_id() is not null
    and d.worker_id = public.current_user_worker_id()
    and not exists (select 1 from public.wage_payments n where n.superseded_by = d.id);
$function$;
revoke all on function public.get_my_wage_payments() from public, anon;
grant execute on function public.get_my_wage_payments() to authenticated;
drop function public.get_my_dc_payments();

-- 5.5 post_wage_payment_to_gl (was post_dc_payment_to_gl). service_role-only ACL.
create function public.post_wage_payment_to_gl(p_source_id uuid)
 returns uuid
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
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
    from public.wage_payments where id = p_source_id;
  if not found then
    raise exception 'post_wage_payment_to_gl: payment not found' using errcode = 'P0001';
  end if;

  -- A superseding row voids the row it replaces: reverse that entry first.
  if v_superseded is not null then
    select e.id into v_old from public.journal_entries e
      where e.source_table = 'wage_payments' and e.source_id = v_superseded
        and e.source_event = 'wage_payment' and e.status = 'posted'
        and not exists (select 1 from public.journal_entries r where r.reversal_of = e.id)
      limit 1;
    if v_old is not null then
      perform public.reverse_journal_internal(v_old, v_actor, 'void: superseded wage payment');
    end if;
  end if;

  -- Reverse this row's own current entry (re-drain safety).
  select e.id into v_old from public.journal_entries e
    where e.source_table = 'wage_payments' and e.source_id = p_source_id
      and e.source_event = 'wage_payment' and e.status = 'posted'
      and not exists (select 1 from public.journal_entries r where r.reversal_of = e.id)
    limit 1;
  if v_old is not null then
    perform public.reverse_journal_internal(v_old, v_actor, 'auto-correct: wage payment re-posted');
  end if;

  -- A tombstone/void (no paid_amount) posts nothing new.
  if v_paid is null or v_paid = 0 then
    return null;
  end if;

  -- Re-drain guard: a row a newer row supersedes is NON-CURRENT — never (re)post it.
  if exists (select 1 from public.wage_payments n where n.superseded_by = p_source_id) then
    return null;
  end if;

  -- ADR 0073 (was 0062): the ช่าง payee is a worker, not a contractor; journal_lines
  -- has no worker dimension, so the wage-clearing line carries no party.
  v_lines := jsonb_build_array(
    jsonb_build_object('account_code', '2110', 'debit',  v_paid),
    jsonb_build_object('account_code', '1110', 'credit', v_paid));

  return public.post_journal_internal(
    v_paid_at, 'wage_payments', p_source_id, 'wage_payment', 'Wage payment', v_lines, null, v_actor);
end;
$function$;
revoke all on function public.post_wage_payment_to_gl(uuid) from public, anon, authenticated;
drop function public.post_dc_payment_to_gl(uuid);

-- 5.6 drain_gl_posting — swap the dc_payments CASE arm for wage_payments.
create or replace function public.drain_gl_posting(p_limit integer default 50)
 returns integer
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_job   public.gl_posting_outbox;
  v_entry uuid;
  v_done  integer := 0;
begin
  for v_job in
    select * from public.gl_posting_outbox
     where status = 'pending'
     order by created_at
     limit greatest(p_limit, 0)
  loop
    begin
      case v_job.source_table
        when 'purchase_requests'        then v_entry := public.post_purchase_to_gl(v_job.source_id);
        when 'wage_payments'            then v_entry := public.post_wage_payment_to_gl(v_job.source_id);
        when 'wp_labor_costs'           then v_entry := public.post_labor_freeze_to_gl(v_job.source_id);
        when 'equipment_rental_batches' then v_entry := public.post_rental_batch_to_gl(v_job.source_id);
        when 'client_billings'          then v_entry := public.post_client_billing_to_gl(v_job.source_id);
        when 'retention_receivables'    then v_entry := public.post_retention_release_to_gl(v_job.source_id);
        when 'wht_certificates'         then v_entry := public.post_wht_certificate_to_gl(v_job.source_id);
        when 'client_receipts'          then v_entry := public.post_client_receipt_to_gl(v_job.source_id);
        when 'stock_receipts'           then v_entry := public.post_stock_receipt_to_gl(v_job.source_id);
        when 'stock_issues'             then v_entry := public.post_stock_issue_to_gl(v_job.source_id);
        when 'stock_returns'            then v_entry := public.post_stock_return_to_gl(v_job.source_id);
        when 'stock_counts'             then v_entry := public.post_stock_count_to_gl(v_job.source_id);
        when 'stock_reversals'          then v_entry := public.post_stock_reversal_to_gl(v_job.source_id);
        when 'subcontract_payments'     then v_entry := public.post_subcontract_payment_to_gl(v_job.source_id);
        when 'purchase_order_charges'   then v_entry := public.post_purchase_order_charge_to_gl(v_job.source_id);
        else
          update public.gl_posting_outbox
             set status = 'skipped', last_error = 'unknown source_table'
           where id = v_job.id;
          continue;
      end case;

      update public.gl_posting_outbox
         set status = 'posted', journal_entry_id = v_entry, posted_at = now()
       where id = v_job.id;
      v_done := v_done + 1;
    exception when others then
      update public.gl_posting_outbox
         set status = 'failed', last_error = left(sqlerrm, 500), attempts = attempts + 1
       where id = v_job.id;
    end;
  end loop;

  return v_done;
end;
$function$;

-- 5.7 log_labor_day — pay_type_snapshot = worker.pay_type; drop contractor_id_snapshot.
create or replace function public.log_labor_day(p_wp uuid, p_worker uuid, p_date date, p_fraction day_fraction, p_note text DEFAULT NULL::text)
 returns uuid
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_worker public.workers%rowtype;
  v_wp_status public.work_package_status;
  v_id uuid;
begin
  if public.current_user_role() is null
     or public.current_user_role() not in ('site_admin', 'project_manager', 'super_admin', 'project_director') then
    raise exception 'log_labor_day: role not permitted' using errcode = '42501';
  end if;
  if p_fraction is null then
    raise exception 'log_labor_day: day fraction required' using errcode = 'P0001';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended(p_wp::text || '|' || p_worker::text || '|' || p_date::text, 0));

  select status into v_wp_status
    from public.work_packages where id = p_wp;
  if not found then
    raise exception 'log_labor_day: work package not found' using errcode = 'P0001';
  end if;
  if v_wp_status = 'complete' then
    raise exception 'log_labor_day: work package is complete'
      using errcode = 'P0001';
  end if;

  select * into v_worker from public.workers where id = p_worker;
  if not found then
    raise exception 'log_labor_day: worker not found' using errcode = 'P0001';
  end if;
  if not v_worker.active then
    raise exception 'log_labor_day: worker is inactive' using errcode = 'P0001';
  end if;

  if exists (
    select 1 from public.labor_logs ll
     where ll.work_package_id = p_wp
       and ll.worker_id = p_worker
       and ll.work_date = p_date
       and ll.day_fraction is not null
       and not exists (select 1 from public.labor_logs newer
                        where newer.superseded_by = ll.id)
  ) then
    raise exception 'log_labor_day: entry already exists for this worker and day'
      using errcode = 'P0001';
  end if;

  insert into public.labor_logs
    (work_package_id, worker_id, work_date, day_fraction,
     day_rate_snapshot, worker_name_snapshot, pay_type_snapshot,
     entered_by, self_logged, note)
  values
    (p_wp, p_worker, p_date, p_fraction,
     v_worker.day_rate, v_worker.name, v_worker.pay_type,
     auth.uid(),
     v_worker.user_id is not distinct from auth.uid()
       and v_worker.user_id is not null,
     nullif(btrim(p_note), ''))
  returning id into v_id;
  return v_id;
end;
$function$;

-- 5.8 correct_labor_log — carry pay_type_snapshot; drop contractor_id_snapshot.
create or replace function public.correct_labor_log(p_log uuid, p_reason text, p_fraction day_fraction DEFAULT NULL::day_fraction, p_tombstone boolean DEFAULT false, p_note text DEFAULT NULL::text)
 returns uuid
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_orig public.labor_logs%rowtype;
  v_worker_user uuid;
  v_reason text := nullif(trim(coalesce(p_reason, '')), '');
  v_id uuid;
begin
  if public.current_user_role() is null
     or public.current_user_role() not in ('site_admin', 'project_manager', 'super_admin', 'project_director') then
    raise exception 'correct_labor_log: role not permitted' using errcode = '42501';
  end if;
  if v_reason is null or length(v_reason) > 300 then
    raise exception 'correct_labor_log: reason required (max 300 chars)'
      using errcode = 'P0001';
  end if;
  if not p_tombstone and p_fraction is null then
    raise exception 'correct_labor_log: new fraction required unless removing'
      using errcode = 'P0001';
  end if;

  select * into v_orig from public.labor_logs where id = p_log;
  if not found then
    raise exception 'correct_labor_log: log not found' using errcode = 'P0001';
  end if;
  if v_orig.day_fraction is null then
    raise exception 'correct_labor_log: cannot correct a removal'
      using errcode = 'P0001';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended(v_orig.work_package_id::text || '|'
                     || v_orig.worker_id::text || '|'
                     || v_orig.work_date::text, 0));

  if exists (select 1 from public.labor_logs newer
              where newer.superseded_by = p_log) then
    raise exception 'correct_labor_log: log already superseded'
      using errcode = 'P0001';
  end if;

  select w.user_id into v_worker_user
    from public.workers w where w.id = v_orig.worker_id;

  insert into public.labor_logs
    (work_package_id, worker_id, work_date, day_fraction,
     day_rate_snapshot, worker_name_snapshot, pay_type_snapshot,
     entered_by, self_logged,
     superseded_by, correction_reason, note)
  values
    (v_orig.work_package_id, v_orig.worker_id, v_orig.work_date,
     case when p_tombstone then null else p_fraction end,
     v_orig.day_rate_snapshot, v_orig.worker_name_snapshot,
     v_orig.pay_type_snapshot,
     auth.uid(),
     v_worker_user is not distinct from auth.uid() and v_worker_user is not null,
     p_log, v_reason,
     case
       when p_tombstone then null
       when p_note is null then v_orig.note
       else nullif(btrim(p_note), '')
     end)
  returning id into v_id;
  return v_id;
end;
$function$;

-- 5.9 freeze_wp_labor_cost — split by pay_type_snapshot monthly(own)/daily(dc).
--     wp_labor_costs.own_cost/dc_cost column names kept (own = monthly labor,
--     dc = daily labor) — out of the spec's rename scope.
create or replace function public.freeze_wp_labor_cost(p_wp uuid)
 returns void
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_role    public.user_role := public.current_user_role();
  v_own     numeric(12,2);
  v_dc      numeric(12,2);
  v_old_own numeric(12,2);
  v_old_dc  numeric(12,2);
begin
  if v_role is null
       or v_role not in ('project_manager', 'super_admin', 'project_director') then
    raise exception 'freeze_wp_labor_cost: role not permitted' using errcode = '42501';
  end if;

  perform 1 from public.work_packages where id = p_wp;
  if not found then
    raise exception 'freeze_wp_labor_cost: work package not found' using errcode = 'P0001';
  end if;

  -- Σ over CURRENT labor logs. MUST match src/lib/labor/cost.ts aggregateLaborCost
  -- (monthly/daily subtotals shown in the PM cost view are computed the same way).
  select
    coalesce(sum(case when ll.pay_type_snapshot = 'monthly'
      then (case ll.day_fraction when 'full' then 1.0 else 0.5 end) * ll.day_rate_snapshot
      else 0 end), 0),
    coalesce(sum(case when ll.pay_type_snapshot = 'daily'
      then (case ll.day_fraction when 'full' then 1.0 else 0.5 end) * ll.day_rate_snapshot
      else 0 end), 0)
  into v_own, v_dc
  from public.labor_logs ll
  where ll.work_package_id = p_wp
    and ll.day_fraction is not null
    and not exists (select 1 from public.labor_logs newer where newer.superseded_by = ll.id);

  select own_cost, dc_cost into v_old_own, v_old_dc
    from public.wp_labor_costs where work_package_id = p_wp;

  insert into public.wp_labor_costs (work_package_id, own_cost, dc_cost, computed_at, frozen_by)
  values (p_wp, v_own, v_dc, now(), auth.uid())
  on conflict (work_package_id) do update
    set own_cost    = excluded.own_cost,
        dc_cost     = excluded.dc_cost,
        computed_at = excluded.computed_at,
        frozen_by   = excluded.frozen_by;

  insert into public.audit_log (action, actor_id, actor_role, target_table,
                                target_id, payload)
  values ('labor_cost_freeze', auth.uid(), v_role,
          'wp_labor_costs', p_wp,
          jsonb_build_object('own_cost', v_own, 'dc_cost', v_dc,
                             'old_own_cost', v_old_own, 'old_dc_cost', v_old_dc));
end;
$function$;

-- 5.10 wp_labor_sell — value only DAILY labor (was 'dc') at per-level sell rate.
create or replace function public.wp_labor_sell(p_wp uuid)
 returns numeric
 language plpgsql
 stable security definer
 set search_path to 'public'
as $function$
declare
  v_external boolean;
  v_sell     numeric;
begin
  if not public.is_manager(public.current_user_role())
     and public.current_user_role() is distinct from 'accounting' then
    raise exception 'wp_labor_sell: role not permitted' using errcode = '42501';
  end if;

  if not exists (select 1 from public.work_packages where id = p_wp) then
    raise exception 'wp_labor_sell: work package not found' using errcode = 'P0001';
  end if;

  v_external := coalesce(
    (select is_external from public.wp_economics where work_package_id = p_wp), false);

  -- Σ over CURRENT DAILY labor logs, valued at the worker's per-level sell rate.
  -- monthly labor is payroll overhead, not transfer-priced into the WP profit
  -- center (ADR §2 prices daily labor) → excluded by the pay_type_snapshot filter.
  select coalesce(sum(
    (case ll.day_fraction when 'full' then 1.0 else 0.5 end)
    * (case when v_external then srt.external_sell else srt.internal_sell end)
  ), 0)
  into v_sell
  from public.labor_logs ll
  join public.workers w on w.id = ll.worker_id
  join public.sell_rate_table srt on srt.level = w.level
  where ll.work_package_id = p_wp
    and ll.pay_type_snapshot = 'daily'
    and ll.day_fraction is not null
    and not exists (select 1 from public.labor_logs newer where newer.superseded_by = ll.id);

  return v_sell;
end;
$function$;

-- 5.11 distribute_project_coins — daily labor (was 'dc'); external = temporary
--      (was dc_arrangement). Return columns dc_distributed/dc_count kept (sig).
create or replace function public.distribute_project_coins(p_project uuid)
 returns TABLE(ht_coins numeric, dc_distributed numeric, dc_count integer, total_distributed numeric)
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_pool     numeric;
  v_code     text;
  v_ht       uuid;
  v_ht_cut   numeric;
  v_ht_coins numeric;
  v_dist     numeric;
  v_w_sen    numeric;
  v_w_mid    numeric;
  v_w_jun    numeric;
  v_w_app    numeric;
  v_ext      numeric;
  v_dc_total numeric := 0;
  v_dc_count integer := 0;
  v_coins    numeric;
  r          record;
begin
  if public.current_user_role() is distinct from 'super_admin' then
    raise exception 'distribute_project_coins: role not permitted' using errcode = '42501';
  end if;

  select code into v_code from public.projects where id = p_project;
  if not found then
    raise exception 'distribute_project_coins: project not found' using errcode = 'P0001';
  end if;
  select coin_pool into v_pool from public.project_settlements where project_id = p_project;
  if not found then
    raise exception 'distribute_project_coins: project not settled' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.project_coin_distributions where project_id = p_project) then
    raise exception 'distribute_project_coins: project already distributed' using errcode = 'P0001';
  end if;

  v_ht_cut := coalesce((select value from public.nova_dials where dial_key = 'ht_cut_pct'), 0);
  v_w_sen  := coalesce((select value from public.nova_dials where dial_key = 'level_weight_senior'), 0);
  v_w_mid  := coalesce((select value from public.nova_dials where dial_key = 'level_weight_mid'), 0);
  v_w_jun  := coalesce((select value from public.nova_dials where dial_key = 'level_weight_junior'), 0);
  v_w_app  := coalesce((select value from public.nova_dials where dial_key = 'level_weight_apprentice'), 0);
  v_ext    := coalesce((select value from public.nova_dials where dial_key = 'external_factor'), 0);

  v_ht := (select ht_worker_id from public.projects where id = p_project);

  v_ht_coins := round(v_pool * v_ht_cut, 4);
  if v_ht is not null and v_ht_coins > 0 then
    perform public.post_coins(v_ht, 'profit_share', v_ht_coins,
      'Profit-share HT cut, project ' || coalesce(v_code, ''), now(), p_project);
  else
    v_ht_coins := 0;
  end if;

  v_dist := v_pool - v_ht_coins;

  for r in
    with worker_days as (
      select ll.worker_id,
             sum(case ll.day_fraction when 'full' then 1.0 else 0.5 end) as days
        from public.labor_logs ll
        join public.work_packages wp on wp.id = ll.work_package_id
       where wp.project_id = p_project
         and ll.pay_type_snapshot = 'daily'
         and ll.day_fraction is not null
         and not exists (select 1 from public.labor_logs n where n.superseded_by = ll.id)
         and (v_ht is null or ll.worker_id <> v_ht)
       group by ll.worker_id
    ),
    weighted as (
      select wd.worker_id,
             -- ADR 0073 (was 0062 U2): external = the worker's ชั่วคราว employment.
             (case when w.employment_type = 'temporary'
                   then v_ext
                   else coalesce(case w.level
                          when 'senior'     then v_w_sen
                          when 'mid'        then v_w_mid
                          when 'junior'     then v_w_jun
                          when 'apprentice' then v_w_app
                          else 0 end, 0)
              end) * wd.days as weight
        from worker_days wd
        join public.workers w on w.id = wd.worker_id
    )
    select worker_id, weight,
           sum(weight) over ()                    as sumw,
           row_number() over (order by worker_id) as rn,
           count(*) over ()                       as cnt
      from weighted
     where weight > 0
  loop
    if r.sumw <= 0 then
      continue;
    end if;
    if r.rn = r.cnt then
      v_coins := round(v_dist - v_dc_total, 4);
    else
      v_coins := round(v_dist * r.weight / r.sumw, 4);
    end if;
    if v_coins > 0 then
      perform public.post_coins(r.worker_id, 'profit_share', v_coins,
        'Profit-share, project ' || coalesce(v_code, ''), now(), p_project);
      v_dc_total := v_dc_total + v_coins;
      v_dc_count := v_dc_count + 1;
    end if;
  end loop;

  insert into public.project_coin_distributions (project_id, coin_pool, ht_worker_id,
      ht_coins, dc_distributed, dc_count, distributed_by)
  values (p_project, v_pool, v_ht, v_ht_coins, v_dc_total, v_dc_count, auth.uid());

  insert into public.audit_log (action, actor_id, actor_role, target_table,
                                target_id, payload)
  values ('update', auth.uid(), public.current_user_role(), 'project_coin_distributions',
          p_project, jsonb_build_object('coin_pool', v_pool, 'ht_coins', v_ht_coins,
            'dc_distributed', v_dc_total, 'dc_count', v_dc_count));

  return query select v_ht_coins, v_dc_total, v_dc_count, v_ht_coins + v_dc_total;
end;
$function$;

-- 5.12 coin_unvested_balance — external = temporary employment (was dc_arrangement).
create or replace function public.coin_unvested_balance(p_worker uuid)
 returns numeric
 language plpgsql
 stable security definer
 set search_path to 'public'
as $function$
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

  -- External (ADR 0073: the worker's ชั่วคราว employment): the whole balance is
  -- locked/unvested until the worker becomes permanent.
  v_external := exists (
    select 1 from public.workers w
     where w.id = p_worker and w.employment_type = 'temporary');
  if v_external then
    return greatest(v_balance, 0);
  end if;

  v_tail := coalesce((select value from public.nova_dials where dial_key = 'vesting_tail_days'), 0);
  select coalesce(sum(amount), 0) into v_recent
    from public.coin_postings
   where worker_id = p_worker and amount > 0
     and occurred_at > now() - (v_tail || ' days')::interval;

  return least(greatest(v_balance, 0), v_recent);
end;
$function$;

-- 5.13 create_worker_invite — portal invites for DAILY workers (was 'dc').
--      (U7 may loosen this to all ช่าง; kept behavior-preserving for U1.)
create or replace function public.create_worker_invite(p_worker uuid)
 returns text
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_token text;
  v_pay   public.pay_type;
begin
  if not public.is_back_office(public.current_user_role()) then
    raise exception 'create_worker_invite: role not permitted' using errcode = '42501';
  end if;
  select pay_type into v_pay from public.workers where id = p_worker;
  if not found then
    raise exception 'create_worker_invite: worker not found' using errcode = 'P0001';
  end if;
  if v_pay <> 'daily' then
    raise exception 'create_worker_invite: portal invites are for daily workers' using errcode = 'P0001';
  end if;
  v_token := replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');
  insert into public.worker_invites (worker_id, token_hash, created_by, expires_at)
  values (p_worker, encode(extensions.digest(v_token, 'sha256'), 'hex'),
          auth.uid(), now() + interval '14 days');
  return v_token;
end;
$function$;

-- 5.14 get_my_worker_profile — return employment_type instead of dc_arrangement.
--      Return signature changes → DROP+CREATE + re-grant.
drop function public.get_my_worker_profile();
create function public.get_my_worker_profile()
 returns TABLE(name text, employment_type public.employment_type, phone text, email text, tax_id text, emergency_contact_name text, emergency_contact_relation text, emergency_contact_phone text, date_of_birth date, bank_name text, bank_account_number text, bank_account_name text)
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  select w.name, w.employment_type, w.phone, w.email, w.tax_id,
         w.emergency_contact_name, w.emergency_contact_relation,
         w.emergency_contact_phone, w.date_of_birth,
         w.bank_name, w.bank_account_number, w.bank_account_name
  from public.workers w
  where w.id = public.current_user_worker_id();
$function$;
revoke all on function public.get_my_worker_profile() from public, anon;
grant execute on function public.get_my_worker_profile() to authenticated;

-- 5.15 assign_project_ht — HT must be an active DAILY worker (was 'dc').
create or replace function public.assign_project_ht(p_project uuid, p_worker uuid)
 returns void
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_role   public.user_role := public.current_user_role();
  v_pay    public.pay_type;
  v_active boolean;
begin
  if v_role is null
       or v_role not in ('project_manager', 'project_director', 'super_admin') then
    raise exception 'assign_project_ht: role not permitted' using errcode = '42501';
  end if;
  if not exists (select 1 from public.projects where id = p_project) then
    raise exception 'assign_project_ht: project not found' using errcode = 'P0001';
  end if;
  select pay_type, active into v_pay, v_active
    from public.workers where id = p_worker;
  if not found then
    raise exception 'assign_project_ht: worker not found' using errcode = 'P0001';
  end if;
  -- The HT is a PROMOTED daily worker (ADR 0060 §1) and must be active.
  if v_pay <> 'daily' or not v_active then
    raise exception 'assign_project_ht: HT must be an active daily worker' using errcode = 'P0001';
  end if;

  update public.projects set ht_worker_id = p_worker where id = p_project;

  insert into public.audit_log (action, actor_id, actor_role, target_table,
                                target_id, payload)
  values ('update', auth.uid(), v_role, 'projects', p_project,
          jsonb_build_object('field', 'ht_worker_id', 'worker_id', p_worker));
end;
$function$;

-- 5.16 approve_staff_registration — field branch sets pay_type/employment_type
--      (default monthly/permanent; approver may override via new trailing params).
--      Signature widens → DROP+CREATE + re-grant.
drop function public.approve_staff_registration(uuid, user_role, uuid);
create function public.approve_staff_registration(p_id uuid, p_role user_role, p_project_id uuid default null, p_pay_type public.pay_type default 'monthly', p_employment_type public.employment_type default 'permanent')
 returns uuid
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_actor      uuid := auth.uid();
  v_actor_role public.user_role := public.current_user_role();
  v_reg        public.staff_registrations%rowtype;
  v_old_role   public.user_role;
  v_worker_id  uuid;
  v_name       text;
begin
  if v_actor_role is null
     or v_actor_role not in ('procurement_manager', 'project_director', 'super_admin') then
    raise exception 'approve_staff_registration: role not permitted'
      using errcode = '42501';
  end if;

  if p_role is null
     or p_role not in (
       'technician', 'procurement', 'procurement_manager', 'accounting', 'hr',
       'project_coordinator', 'site_admin', 'project_manager', 'project_director',
       'site_owner', 'subcon_manager', 'auditor'
     ) then
    raise exception 'approve_staff_registration: role % is not assignable through staff onboarding', coalesce(p_role::text, 'null')
      using errcode = '42501';
  end if;

  select * into v_reg from public.staff_registrations where id = p_id;
  if not found then
    raise exception 'approve_staff_registration: registration not found'
      using errcode = 'P0001';
  end if;
  if v_reg.status is distinct from 'pending' then
    raise exception 'approve_staff_registration: registration is not pending'
      using errcode = 'P0001';
  end if;

  v_name := nullif(btrim(coalesce(v_reg.full_name, '')), '');
  if v_name is null then
    raise exception 'approve_staff_registration: full_name required before approval'
      using errcode = 'P0001';
  end if;
  if not exists (
    select 1 from public.staff_registration_attachments a
     where a.registration_id = v_reg.id
       and a.purpose = 'id_card'
       and not exists (
         select 1 from public.staff_registration_attachments n
          where n.superseded_by = a.id
       )
  ) then
    raise exception 'approve_staff_registration: an id_card attachment is required before approval'
      using errcode = 'P0001';
  end if;
  if not exists (
    select 1 from public.staff_consents c
     where c.registration_id = v_reg.id
       and c.kind = 'pdpa_data'
       and c.revoked_at is null
  ) then
    raise exception 'approve_staff_registration: a PDPA consent record is required before approval'
      using errcode = 'P0001';
  end if;

  update public.staff_registrations
     set status      = 'approved',
         reviewed_by = v_actor,
         reviewed_at = now(),
         updated_at  = now()
   where id = v_reg.id;

  select role into v_old_role from public.users where id = v_reg.user_id;
  update public.users set role = p_role, updated_at = now()
   where id = v_reg.user_id;
  insert into public.audit_log
    (actor_id, actor_role, action, target_table, target_id, payload)
  values
    (v_actor, v_actor_role, 'role_change', 'users', v_reg.user_id,
     jsonb_build_object('from', v_old_role, 'to', p_role));

  -- Per-role side-effect. FIELD role (technician) → INSERT the authoritative
  -- worker WITH self-reported PII copied on, now as a ช่าง (pay_type/employment_type;
  -- default monthly/permanent = a salaried technician, approver may override).
  if p_role in ('technician') then
    insert into public.workers
      (name, pay_type, employment_type, user_id, employee_id, active, created_by, project_id,
       phone, date_of_birth,
       emergency_contact_name, emergency_contact_relation, emergency_contact_phone)
    values
      (v_name, p_pay_type, p_employment_type, v_reg.user_id, v_reg.employee_id, true, v_actor, p_project_id,
       v_reg.phone, v_reg.date_of_birth,
       v_reg.emergency_contact_name, v_reg.emergency_contact_relation, v_reg.emergency_contact_phone)
    returning id into v_worker_id;

    insert into public.audit_log
      (actor_id, actor_role, action, target_table, target_id, payload)
    values
      (v_actor, v_actor_role, 'worker_change', 'workers', v_worker_id,
       jsonb_build_object('kind', 'create', 'source', 'staff_registration',
                          'registration_id', v_reg.id, 'employee_id', v_reg.employee_id,
                          'role', p_role));
  end if;

  return v_worker_id;
end;
$function$;
revoke all on function public.approve_staff_registration(uuid, user_role, uuid, public.pay_type, public.employment_type) from public, anon;
grant execute on function public.approve_staff_registration(uuid, user_role, uuid, public.pay_type, public.employment_type) to authenticated;

-- ============================================================================
-- 6. Drop the now-unreferenced enums.
-- ============================================================================
drop type public.worker_type;
drop type public.dc_arrangement;

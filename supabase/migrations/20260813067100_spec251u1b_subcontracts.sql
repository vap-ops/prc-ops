-- Spec 251 U1b — subcontracts (agreed vs paid, ผู้รับเหมาช่วง): the lump-sum
-- deal entity Finance asked for ("ผู้รับเหมาสัญญาที่จ้างค่ะว่าเท่าไหร่ และจ่ายไปแล้วเท่าไหร่").
-- `contractors` today holds taxonomy/contact only; workers.day_rate + dc_payments
-- cover DAILY workers (ADR 0062). There was no entity for a lump-sum deal that
-- can span N work packages with advance/progress/final payments against it.
--
-- Three tables:
--   subcontracts         — the deal header (mutable: title/amount/status/note).
--   subcontract_wps      — which WPs a deal covers (M:N — a WP may appear in
--                          several deals, no exclusivity — real life has split
--                          trades). Trigger enforces same-project membership.
--   subcontract_payments — append-only, supersede-corrected (mirrors dc_payments'
--                          shape: superseded_by self-FK, no UPDATE/DELETE ever).
--
-- MONEY DOMAIN posture (house convention — verified against dc_payments,
-- client_billings, retention_receivables, client_receipts, journal_entries):
-- zero authenticated grant on all three tables, RLS enabled with NO policies.
-- Read only via the service-role admin client behind
-- requireRole([...PM_ROLES, 'accounting']); written only by the SECURITY
-- DEFINER RPCs below, gated by is_manager() (null-safe fail-closed, the
-- 20260813051000 wrapper).
--
-- GL (operator decision, 2026-07-03 night — corrects this spec's original
-- "no GL v1" premise, which assumed dc_payments posts no GL; it does, via a
-- 2-step accrual+settlement subcontracts has no trigger for). Subcontract
-- payments post DIRECT, one step, at payment time:
--   Dr WIP-construction (1400, project_id + contractor_id dimensioned,
--     work_package_id left NULL — a deal can span N WPs with no clean
--     per-payment split) / Cr Bank (1110).
-- New poster post_subcontract_payment_to_gl mirrors post_dc_payment_to_gl's
-- supersede + re-drain-guard shape exactly. Known gaps (accepted, follow-up):
-- no payable shows before payment (no accrual step); cost isn't attributed to
-- a specific WP for a multi-WP deal (wp_profit()'s work_package_id=p_wp filter
-- on account 1400 won't see it).

-- ----------------------------------------------------------------------------
-- 1. Enums.
create type public.subcontract_status as enum ('active', 'completed', 'cancelled');
create type public.subcontract_payment_kind as enum ('advance', 'progress', 'final');

-- ----------------------------------------------------------------------------
-- 2. subcontracts — the deal header.
create table public.subcontracts (
  id             uuid primary key default gen_random_uuid(),
  contractor_id  uuid not null references public.contractors(id),
  project_id     uuid not null references public.projects(id),
  title          text not null,
  agreed_amount  numeric(14,2) not null,
  sign_date      date null,
  status         public.subcontract_status not null default 'active',
  note           text null,
  document_path  text null,
  created_by     uuid not null references public.users(id),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  constraint subcontracts_title_nonblank check (length(btrim(title)) > 0),
  constraint subcontracts_title_len      check (length(title) <= 200),
  constraint subcontracts_amount_pos     check (agreed_amount > 0),
  constraint subcontracts_note_len       check (note is null or length(note) <= 500),
  constraint subcontracts_document_path_len check (document_path is null or length(document_path) <= 400)
);
create index subcontracts_contractor_idx on public.subcontracts (contractor_id);
create index subcontracts_project_idx    on public.subcontracts (project_id);

create trigger subcontracts_set_updated_at
  before update on public.subcontracts
  for each row execute function public.set_updated_at();

alter table public.subcontracts enable row level security;
revoke all on public.subcontracts from anon, authenticated;

comment on table public.subcontracts is
  'Subcontract deal header (spec 251) — lump-sum agreed value against a contractor+project, may span N WPs (subcontract_wps). MONEY DOMAIN — zero authenticated grant; admin-read behind requireRole([...PM_ROLES, accounting]); written only by create_/update_subcontract.';

-- ----------------------------------------------------------------------------
-- 3. subcontract_wps — which WPs a deal covers. M:N, no exclusivity (a WP may
-- appear in several deals — split trades are real). RESTRICT on WP delete: a
-- WP covered by a deal cannot be silently orphaned by deleting the WP.
create table public.subcontract_wps (
  subcontract_id  uuid not null references public.subcontracts(id) on delete cascade,
  work_package_id uuid not null references public.work_packages(id) on delete restrict,
  primary key (subcontract_id, work_package_id)
);
create index subcontract_wps_wp_idx on public.subcontract_wps (work_package_id);

-- Same-project guard: a deal may only cover WPs from its own project (mirrors
-- client_receipts_check_billing_project, spec 249).
create function public.subcontract_wps_check_project()
returns trigger language plpgsql as $$
begin
  if not exists (
    select 1 from public.subcontracts s
      join public.work_packages w on w.id = new.work_package_id
     where s.id = new.subcontract_id and w.project_id = s.project_id
  ) then
    raise exception 'subcontract_wps: work package belongs to another project' using errcode = '22023';
  end if;
  return new;
end;
$$;
create trigger subcontract_wps_project_guard
  before insert on public.subcontract_wps
  for each row execute function public.subcontract_wps_check_project();

alter table public.subcontract_wps enable row level security;
revoke all on public.subcontract_wps from anon, authenticated;

comment on table public.subcontract_wps is
  'Which WPs a subcontract deal covers (spec 251) — M:N, a WP may appear in several deals. Same-project enforced by trigger. MONEY-ADJACENT DOMAIN — zero authenticated grant; written only by set_subcontract_wps.';

-- ----------------------------------------------------------------------------
-- 4. subcontract_payments — append-only, supersede-corrected (mirrors
-- dc_payments' shape). Every row carries a full valid payload — no tombstone
-- (void) path in this spec; a mis-entered payment is corrected via supersede
-- with new valid values, never nulled out.
create table public.subcontract_payments (
  id             uuid primary key default gen_random_uuid(),
  subcontract_id uuid not null references public.subcontracts(id),
  kind           public.subcontract_payment_kind not null,
  amount         numeric(14,2) not null,
  paid_date      date not null,
  method         public.receipt_method not null,
  note           text null,
  created_by     uuid not null references public.users(id),
  created_at     timestamptz not null default now(),
  superseded_by  uuid null references public.subcontract_payments(id),
  constraint subcontract_payments_amount_pos check (amount > 0),
  constraint subcontract_payments_note_len   check (note is null or length(note) <= 500)
);
create index subcontract_payments_subcontract_idx on public.subcontract_payments (subcontract_id);
create index subcontract_payments_superseded_idx  on public.subcontract_payments (superseded_by)
  where superseded_by is not null;

alter table public.subcontract_payments enable row level security;
revoke all on public.subcontract_payments from anon, authenticated;

-- Append-only guard (dc_payments / client_receipts posture): blocks even
-- SECURITY DEFINER / service-role mutation. A correction is a supersede row.
create function public.subcontract_payments_block_mutation()
returns trigger language plpgsql as $$
begin
  raise exception 'subcontract_payments is append-only (correct via supersede, never mutate): no % allowed', tg_op
    using errcode = 'P0001';
end;
$$;
create trigger subcontract_payments_no_update_delete
  before update or delete on public.subcontract_payments
  for each row execute function public.subcontract_payments_block_mutation();
create trigger subcontract_payments_no_truncate
  before truncate on public.subcontract_payments
  for each statement execute function public.subcontract_payments_block_mutation();

-- GL enqueue: every recorded/superseding payment posts. AFTER INSERT only
-- (dc_payments' exact shape — append-only, no UPDATE branch needed).
create trigger subcontract_payments_enqueue_gl_posting
  after insert on public.subcontract_payments
  for each row
  execute function public.enqueue_gl_posting_tg('subcontract_payment', 'id');

comment on table public.subcontract_payments is
  'Payments against a subcontract deal (spec 251) — advance/progress/final. APPEND-ONLY + supersede (dc_payments posture, no tombstone/void path). MONEY DOMAIN — zero authenticated grant; written only by record_/supersede_subcontract_payment.';

-- ----------------------------------------------------------------------------
-- 5. RPCs — all SECURITY DEFINER, gated by is_manager() (null-safe fail-closed,
-- the 20260813051000 wrapper: project_manager/super_admin/project_director).

create function public.create_subcontract(
  p_contractor      uuid,
  p_project         uuid,
  p_title           text,
  p_agreed_amount   numeric,
  p_sign_date       date default null,
  p_note            text default null,
  p_document_path   text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id    uuid;
  v_title text := trim(coalesce(p_title, ''));
begin
  if not public.is_manager(public.current_user_role()) then
    raise exception 'create_subcontract: role not permitted' using errcode = '42501';
  end if;
  if not exists (select 1 from public.contractors where id = p_contractor) then
    raise exception 'create_subcontract: contractor not found' using errcode = 'P0001';
  end if;
  if not exists (select 1 from public.projects where id = p_project) then
    raise exception 'create_subcontract: project not found' using errcode = 'P0001';
  end if;
  if length(v_title) = 0 or length(v_title) > 200 then
    raise exception 'create_subcontract: invalid title' using errcode = 'P0001';
  end if;
  if p_agreed_amount is null or p_agreed_amount <= 0 then
    raise exception 'create_subcontract: agreed_amount must be > 0' using errcode = 'P0001';
  end if;

  insert into public.subcontracts
    (contractor_id, project_id, title, agreed_amount, sign_date, note, document_path, created_by)
  values
    (p_contractor, p_project, v_title, p_agreed_amount, p_sign_date,
     nullif(btrim(coalesce(p_note, '')), ''), nullif(btrim(coalesce(p_document_path, '')), ''),
     auth.uid())
  returning id into v_id;

  insert into public.audit_log (action, actor_id, actor_role, target_table, target_id, payload)
  values ('subcontract_create', auth.uid(), public.current_user_role(), 'subcontracts', v_id,
          jsonb_build_object('contractor_id', p_contractor, 'project_id', p_project,
                             'title', v_title, 'agreed_amount', p_agreed_amount));
  return v_id;
end;
$$;
revoke all on function public.create_subcontract(uuid, uuid, text, numeric, date, text, text) from public, anon;
grant execute on function public.create_subcontract(uuid, uuid, text, numeric, date, text, text) to authenticated;

-- ----------------------------------------------------------------------------
-- update_subcontract — coalesce semantics (omitted field preserved, matches
-- update_worker's precedent).
create function public.update_subcontract(
  p_id             uuid,
  p_title          text default null,
  p_agreed_amount  numeric default null,
  p_sign_date      date default null,
  p_status         public.subcontract_status default null,
  p_note           text default null,
  p_document_path  text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_title text := nullif(trim(coalesce(p_title, '')), '');
begin
  if not public.is_manager(public.current_user_role()) then
    raise exception 'update_subcontract: role not permitted' using errcode = '42501';
  end if;
  if not exists (select 1 from public.subcontracts where id = p_id) then
    raise exception 'update_subcontract: subcontract not found' using errcode = 'P0001';
  end if;
  if v_title is not null and length(v_title) > 200 then
    raise exception 'update_subcontract: invalid title' using errcode = 'P0001';
  end if;
  if p_agreed_amount is not null and p_agreed_amount <= 0 then
    raise exception 'update_subcontract: agreed_amount must be > 0' using errcode = 'P0001';
  end if;

  update public.subcontracts
     set title         = coalesce(v_title, title),
         agreed_amount = coalesce(p_agreed_amount, agreed_amount),
         sign_date     = coalesce(p_sign_date, sign_date),
         status        = coalesce(p_status, status),
         note          = coalesce(nullif(btrim(coalesce(p_note, '')), ''), note),
         document_path = coalesce(nullif(btrim(coalesce(p_document_path, '')), ''), document_path)
   where id = p_id;

  insert into public.audit_log (action, actor_id, actor_role, target_table, target_id, payload)
  values ('subcontract_update', auth.uid(), public.current_user_role(), 'subcontracts', p_id,
          jsonb_build_object('title', v_title, 'agreed_amount', p_agreed_amount,
                             'status', p_status));
end;
$$;
revoke all on function public.update_subcontract(uuid, text, numeric, date, public.subcontract_status, text, text)
  from public, anon;
grant execute on function public.update_subcontract(uuid, text, numeric, date, public.subcontract_status, text, text)
  to authenticated;

-- ----------------------------------------------------------------------------
-- set_subcontract_wps — reconcile the deal's WP set to exactly p_wp_ids
-- (add + remove, not additive). The subcontract_wps_project_guard trigger
-- rejects a WP from another project.
create function public.set_subcontract_wps(
  p_subcontract uuid,
  p_wp_ids      uuid[]
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_manager(public.current_user_role()) then
    raise exception 'set_subcontract_wps: role not permitted' using errcode = '42501';
  end if;
  if not exists (select 1 from public.subcontracts where id = p_subcontract) then
    raise exception 'set_subcontract_wps: subcontract not found' using errcode = 'P0001';
  end if;

  delete from public.subcontract_wps
   where subcontract_id = p_subcontract
     and work_package_id <> all (coalesce(p_wp_ids, array[]::uuid[]));

  insert into public.subcontract_wps (subcontract_id, work_package_id)
  select p_subcontract, wp
    from unnest(coalesce(p_wp_ids, array[]::uuid[])) as wp
   where not exists (
     select 1 from public.subcontract_wps
      where subcontract_id = p_subcontract and work_package_id = wp
   );

  insert into public.audit_log (action, actor_id, actor_role, target_table, target_id, payload)
  values ('subcontract_wps_set', auth.uid(), public.current_user_role(), 'subcontract_wps', p_subcontract,
          jsonb_build_object('subcontract_id', p_subcontract, 'work_package_ids', p_wp_ids));
end;
$$;
revoke all on function public.set_subcontract_wps(uuid, uuid[]) from public, anon;
grant execute on function public.set_subcontract_wps(uuid, uuid[]) to authenticated;

-- ----------------------------------------------------------------------------
-- record_subcontract_payment — append-only insert; the AFTER INSERT trigger
-- enqueues the GL job.
create function public.record_subcontract_payment(
  p_subcontract uuid,
  p_kind        public.subcontract_payment_kind,
  p_amount      numeric,
  p_paid_date   date,
  p_method      public.receipt_method,
  p_note        text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  if not public.is_manager(public.current_user_role()) then
    raise exception 'record_subcontract_payment: role not permitted' using errcode = '42501';
  end if;
  if not exists (select 1 from public.subcontracts where id = p_subcontract) then
    raise exception 'record_subcontract_payment: subcontract not found' using errcode = 'P0001';
  end if;
  if p_amount is null or p_amount <= 0 then
    raise exception 'record_subcontract_payment: amount must be > 0' using errcode = 'P0001';
  end if;
  if p_paid_date is null or p_method is null or p_kind is null then
    raise exception 'record_subcontract_payment: kind, date and method required' using errcode = 'P0001';
  end if;

  insert into public.subcontract_payments
    (subcontract_id, kind, amount, paid_date, method, note, created_by)
  values
    (p_subcontract, p_kind, p_amount, p_paid_date, p_method,
     nullif(btrim(coalesce(p_note, '')), ''), auth.uid())
  returning id into v_id;

  insert into public.audit_log (action, actor_id, actor_role, target_table, target_id, payload)
  values ('subcontract_payment_record', auth.uid(), public.current_user_role(), 'subcontract_payments', v_id,
          jsonb_build_object('subcontract_id', p_subcontract, 'kind', p_kind, 'amount', p_amount));
  return v_id;
end;
$$;
revoke all on function
  public.record_subcontract_payment(uuid, public.subcontract_payment_kind, numeric, date, public.receipt_method, text)
  from public, anon;
grant execute on function
  public.record_subcontract_payment(uuid, public.subcontract_payment_kind, numeric, date, public.receipt_method, text)
  to authenticated;

-- ----------------------------------------------------------------------------
-- supersede_subcontract_payment — a correction (dc_payments posture): every
-- replacement carries a full valid payload, no void/tombstone path.
create function public.supersede_subcontract_payment(
  p_payment_id uuid,
  p_kind       public.subcontract_payment_kind,
  p_amount     numeric,
  p_paid_date  date,
  p_method     public.receipt_method,
  p_note       text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_target public.subcontract_payments;
  v_id     uuid;
begin
  if not public.is_manager(public.current_user_role()) then
    raise exception 'supersede_subcontract_payment: role not permitted' using errcode = '42501';
  end if;

  select * into v_target from public.subcontract_payments where id = p_payment_id;
  if not found then
    raise exception 'supersede_subcontract_payment: payment not found' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.subcontract_payments n where n.superseded_by = p_payment_id) then
    raise exception 'supersede_subcontract_payment: payment already superseded' using errcode = 'P0001';
  end if;
  if p_amount is null or p_amount <= 0 then
    raise exception 'supersede_subcontract_payment: amount must be > 0' using errcode = 'P0001';
  end if;
  if p_paid_date is null or p_method is null or p_kind is null then
    raise exception 'supersede_subcontract_payment: kind, date and method required' using errcode = 'P0001';
  end if;

  insert into public.subcontract_payments
    (subcontract_id, kind, amount, paid_date, method, note, created_by, superseded_by)
  values
    (v_target.subcontract_id, p_kind, p_amount, p_paid_date, p_method,
     nullif(btrim(coalesce(p_note, '')), ''), auth.uid(), p_payment_id)
  returning id into v_id;

  insert into public.audit_log (action, actor_id, actor_role, target_table, target_id, payload)
  values ('subcontract_payment_supersede', auth.uid(), public.current_user_role(), 'subcontract_payments', v_id,
          jsonb_build_object('superseded', p_payment_id, 'kind', p_kind, 'amount', p_amount));
  return v_id;
end;
$$;
revoke all on function
  public.supersede_subcontract_payment(uuid, public.subcontract_payment_kind, numeric, date, public.receipt_method, text)
  from public, anon;
grant execute on function
  public.supersede_subcontract_payment(uuid, public.subcontract_payment_kind, numeric, date, public.receipt_method, text)
  to authenticated;

-- ----------------------------------------------------------------------------
-- 6. Poster (drain-called, owner context — no session grants). Mirrors
-- post_dc_payment_to_gl's supersede-reversal + re-drain-guard shape exactly,
-- but posts DIRECT (no accrual/clearing account — operator decision above):
-- Dr WIP-construction 1400 (project_id + contractor_id) / Cr Bank 1110.
create function public.post_subcontract_payment_to_gl(p_source_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row     public.subcontract_payments;
  v_project uuid;
  v_contr   uuid;
  v_old     uuid;
  v_lines   jsonb;
begin
  select * into v_row from public.subcontract_payments where id = p_source_id;
  if not found then
    raise exception 'post_subcontract_payment_to_gl: payment not found' using errcode = 'P0001';
  end if;

  select s.project_id, s.contractor_id into v_project, v_contr
    from public.subcontracts s where s.id = v_row.subcontract_id;

  -- A superseding row voids the row it replaces: reverse that entry first.
  if v_row.superseded_by is not null then
    select e.id into v_old from public.journal_entries e
      where e.source_table = 'subcontract_payments' and e.source_id = v_row.superseded_by
        and e.source_event = 'subcontract_payment' and e.status = 'posted'
        and not exists (select 1 from public.journal_entries r where r.reversal_of = e.id)
      limit 1;
    if v_old is not null then
      perform public.reverse_journal_internal(v_old, v_row.created_by, 'void: superseded subcontract payment');
    end if;
  end if;

  -- Reverse this row's own current entry (re-drain safety).
  select e.id into v_old from public.journal_entries e
    where e.source_table = 'subcontract_payments' and e.source_id = p_source_id
      and e.source_event = 'subcontract_payment' and e.status = 'posted'
      and not exists (select 1 from public.journal_entries r where r.reversal_of = e.id)
    limit 1;
  if v_old is not null then
    perform public.reverse_journal_internal(v_old, v_row.created_by, 'auto-correct: subcontract payment re-posted');
  end if;

  -- Re-drain guard: a row a newer row supersedes is NON-CURRENT — never
  -- (re)post it. Its successor's drain owns any reversal of its prior entry.
  if exists (select 1 from public.subcontract_payments n where n.superseded_by = p_source_id) then
    return null;
  end if;

  v_lines := jsonb_build_array(
    jsonb_build_object('account_code', '1400', 'debit', v_row.amount,
                       'project_id', v_project, 'contractor_id', v_contr),
    jsonb_build_object('account_code', '1110', 'credit', v_row.amount));

  return public.post_journal_internal(
    v_row.paid_date, 'subcontract_payments', p_source_id, 'subcontract_payment',
    'Subcontract payment', v_lines, null, v_row.created_by);
end;
$$;
revoke all on function public.post_subcontract_payment_to_gl(uuid) from public, anon, authenticated;

-- ----------------------------------------------------------------------------
-- 7. Drain re-source — body VERBATIM from LIVE (pg_get_functiondef, 2026-07-03,
-- confirmed byte-identical to the migration-file copy at 20260813065000) + ONE
-- new arm for subcontract_payments. Never sourced from a migration file
-- (GL-drain lesson — repeated house incident).
CREATE OR REPLACE FUNCTION public.drain_gl_posting(p_limit integer DEFAULT 50)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
        when 'dc_payments'              then v_entry := public.post_dc_payment_to_gl(v_job.source_id);
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
        -- Subcontract payments (spec 251) — direct Dr WIP 1400 / Cr Bank 1110,
        -- no accrual step.
        when 'subcontract_payments'     then v_entry := public.post_subcontract_payment_to_gl(v_job.source_id);
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

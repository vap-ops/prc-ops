-- Spec 249 U1 — client receipts (เงินรับจากลูกค้า): partial payments + ADVANCE
-- receipts (money arrives before the billing/contract exists — recurring real
-- case, operator directive: no document blocks money) + GL posting + the
-- billing paid/invoiced status flips.
--
-- Shape mirrors dc_payments: APPEND-ONLY + supersede (new row points at the row
-- it replaces via superseded_by; a VOID is a tombstone row with a NULL payload).
-- Current-state reads are anti-joins. MONEY DOMAIN posture: RLS on, zero
-- authenticated grant, writes only via is_manager()-gated SECURITY DEFINER RPCs.
--
-- GL (ADR 0057 outbox): every insert enqueues 'client_receipt'; the poster
--   billing-linked → Dr 1110 เงินฝากธนาคาร / Cr 1200 ลูกหนี้การค้า
--   advance       → Dr 1110                / Cr 2300 เงินรับล่วงหน้าจากลูกค้า (new account)
-- A superseding row reverses the entry of the row it replaces (dc_payments
-- pattern); a tombstone posts nothing new.
--
-- Status flips (the machine had NO write path past 'certified' until now):
--   mark_client_billing_invoiced: certified → invoiced (วางบิลแล้ว — Finance's
--   "วางบิลไปแล้วกี่บิล" is countable only if bills can be marked placed).
--   Coverage recompute after every receipt write: Σ(current linked receipts) ≥
--   net_receivable flips certified/invoiced → paid; losing coverage (a void)
--   downgrades paid → invoiced (the bill was necessarily placed; honest
--   approximation, display always recomputes from receipts).

-- ----------------------------------------------------------------------------
-- Customer-advance liability account (idempotent seed).
insert into public.gl_accounts
  (code, name_th, name_en, account_type, normal_side, is_postable, parent_id, sort_order)
values
  ('2300', 'เงินรับล่วงหน้าจากลูกค้า', 'Advances from customers', 'liability', 'credit', true,
   (select id from public.gl_accounts where code = '2000'), 60)
on conflict (code) do nothing;

-- ----------------------------------------------------------------------------
create table public.client_receipts (
  id                uuid primary key default gen_random_uuid(),
  project_id        uuid not null references public.projects(id),
  client_billing_id uuid null references public.client_billings(id),
  amount            numeric(14,2) null,
  received_date     date null,
  method            public.receipt_method null,
  note              text null,
  created_by        uuid not null references public.users(id),
  created_at        timestamptz not null default now(),
  superseded_by     uuid null references public.client_receipts(id),
  -- A real receipt carries the full payload; a tombstone (void) carries none and
  -- MUST point at the row it voids.
  constraint client_receipts_payload check (
    (amount is not null and amount > 0 and received_date is not null and method is not null)
    or (amount is null and received_date is null and method is null and superseded_by is not null)
  ),
  constraint client_receipts_note_len check (note is null or length(note) <= 500)
);
create index client_receipts_project_idx  on public.client_receipts (project_id);
create index client_receipts_billing_idx  on public.client_receipts (client_billing_id)
  where client_billing_id is not null;
create index client_receipts_superseded_idx on public.client_receipts (superseded_by)
  where superseded_by is not null;

alter table public.client_receipts enable row level security;
revoke all on public.client_receipts from anon, authenticated;

comment on table public.client_receipts is
  'Cash received from clients (spec 249). APPEND-ONLY + supersede (void = tombstone). client_billing_id NULL = advance (เงินรับล่วงหน้า). MONEY DOMAIN — zero grant; written only by record_/supersede_client_receipt.';

-- Append-only guard (ERD-audit M7 pattern): even owner-context definer code
-- cannot UPDATE/DELETE; corrections are supersede rows.
create function public.client_receipts_block_mutation()
returns trigger language plpgsql as $$
begin
  raise exception 'client_receipts is append-only (correct via supersede, never mutate): no % allowed', tg_op;
end;
$$;
create trigger client_receipts_no_update_delete
  before update or delete on public.client_receipts
  for each row execute function public.client_receipts_block_mutation();
create trigger client_receipts_no_truncate
  before truncate on public.client_receipts
  for each statement execute function public.client_receipts_block_mutation();

-- Same-project guard: a receipt may only link a billing of its own project.
create function public.client_receipts_check_billing_project()
returns trigger language plpgsql as $$
begin
  if new.client_billing_id is not null then
    if not exists (select 1 from public.client_billings b
                    where b.id = new.client_billing_id and b.project_id = new.project_id) then
      raise exception 'client_receipts: billing belongs to another project' using errcode = '22023';
    end if;
  end if;
  return new;
end;
$$;
create trigger client_receipts_billing_project
  before insert on public.client_receipts
  for each row execute function public.client_receipts_check_billing_project();

-- GL enqueue: every insert (incl. tombstones — the poster handles reversal-only).
create trigger client_receipts_enqueue_gl_posting
  after insert on public.client_receipts
  for each row
  execute function public.enqueue_gl_posting_tg('client_receipt', 'id');

-- ----------------------------------------------------------------------------
-- Coverage recompute — internal (no grants; called by the receipt RPCs).
create function public.recompute_billing_receipt_status(p_billing_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_net    numeric(14,2);
  v_status public.client_billing_status;
  v_cov    numeric(14,2);
begin
  if p_billing_id is null then return; end if;
  select net_receivable, status into v_net, v_status
    from public.client_billings where id = p_billing_id;
  if not found or v_net is null then return; end if;

  select coalesce(sum(r.amount), 0) into v_cov
    from public.client_receipts r
   where r.client_billing_id = p_billing_id
     and r.amount is not null
     and not exists (select 1 from public.client_receipts n where n.superseded_by = r.id);

  if v_cov >= v_net and v_status in ('certified', 'invoiced') then
    update public.client_billings set status = 'paid' where id = p_billing_id;
  elsif v_cov < v_net and v_status = 'paid' then
    -- Losing coverage (void/re-allocation): back to invoiced — the bill was
    -- necessarily placed before money came. Display always recomputes anyway.
    update public.client_billings set status = 'invoiced' where id = p_billing_id;
  end if;
end;
$$;
revoke all on function public.recompute_billing_receipt_status(uuid) from public, anon, authenticated;

-- ----------------------------------------------------------------------------
create function public.record_client_receipt(
  p_project_id    uuid,
  p_amount        numeric,
  p_received_date date,
  p_method        public.receipt_method,
  p_billing_id    uuid default null,
  p_note          text default null
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
    raise exception 'record_client_receipt: role not permitted' using errcode = '42501';
  end if;
  if not exists (select 1 from public.projects where id = p_project_id) then
    raise exception 'record_client_receipt: project not found' using errcode = 'P0001';
  end if;
  if p_amount is null or p_amount <= 0 then
    raise exception 'record_client_receipt: amount must be > 0' using errcode = 'P0001';
  end if;
  if p_received_date is null or p_method is null then
    raise exception 'record_client_receipt: date and method required' using errcode = 'P0001';
  end if;

  insert into public.client_receipts
    (project_id, client_billing_id, amount, received_date, method, note, created_by)
  values
    (p_project_id, p_billing_id, p_amount, p_received_date, p_method,
     nullif(btrim(coalesce(p_note,'')),''), auth.uid())
  returning id into v_id;

  perform public.recompute_billing_receipt_status(p_billing_id);

  insert into public.audit_log (action, actor_id, actor_role, target_table, target_id, payload)
  values ('client_receipt_record', auth.uid(), public.current_user_role(), 'client_receipts', v_id,
          jsonb_build_object('project_id', p_project_id, 'amount', p_amount,
                             'billing_id', p_billing_id, 'method', p_method));
  return v_id;
end;
$$;
revoke all on function public.record_client_receipt(uuid, numeric, date, public.receipt_method, uuid, text) from public, anon;
grant execute on function public.record_client_receipt(uuid, numeric, date, public.receipt_method, uuid, text) to authenticated;

-- Full-replacement semantics: a NULL p_amount voids (tombstone); a non-null
-- amount inserts a replacement carrying EXACTLY the passed fields (billing NULL
-- = back to unallocated). The new row inherits the target's project.
create function public.supersede_client_receipt(
  p_receipt_id    uuid,
  p_amount        numeric,
  p_received_date date,
  p_method        public.receipt_method,
  p_billing_id    uuid,
  p_note          text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_target      public.client_receipts;
  v_id          uuid;
begin
  if not public.is_manager(public.current_user_role()) then
    raise exception 'supersede_client_receipt: role not permitted' using errcode = '42501';
  end if;

  select * into v_target from public.client_receipts where id = p_receipt_id;
  if not found then
    raise exception 'supersede_client_receipt: receipt not found' using errcode = 'P0001';
  end if;
  if v_target.amount is null then
    raise exception 'supersede_client_receipt: cannot supersede a tombstone' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.client_receipts n where n.superseded_by = p_receipt_id) then
    raise exception 'supersede_client_receipt: receipt already superseded' using errcode = 'P0001';
  end if;
  if p_amount is not null and (p_amount <= 0 or p_received_date is null or p_method is null) then
    raise exception 'supersede_client_receipt: replacement needs amount > 0, date and method' using errcode = 'P0001';
  end if;

  insert into public.client_receipts
    (project_id, client_billing_id, amount, received_date, method, note, created_by, superseded_by)
  values
    (v_target.project_id,
     case when p_amount is null then null else p_billing_id end,
     p_amount,
     case when p_amount is null then null else p_received_date end,
     case when p_amount is null then null else p_method end,
     nullif(btrim(coalesce(p_note,'')),''),
     auth.uid(),
     p_receipt_id)
  returning id into v_id;

  -- Both sides can change coverage: the billing the old row fed and the one the
  -- replacement feeds.
  perform public.recompute_billing_receipt_status(v_target.client_billing_id);
  if p_amount is not null and p_billing_id is distinct from v_target.client_billing_id then
    perform public.recompute_billing_receipt_status(p_billing_id);
  end if;

  insert into public.audit_log (action, actor_id, actor_role, target_table, target_id, payload)
  values ('client_receipt_supersede', auth.uid(), public.current_user_role(), 'client_receipts', v_id,
          jsonb_build_object('superseded', p_receipt_id, 'amount', p_amount,
                             'billing_id', p_billing_id));
  return v_id;
end;
$$;
revoke all on function public.supersede_client_receipt(uuid, numeric, date, public.receipt_method, uuid, text) from public, anon;
grant execute on function public.supersede_client_receipt(uuid, numeric, date, public.receipt_method, uuid, text) to authenticated;

-- certified → invoiced (วางบิลแล้ว). The paid flip is coverage-driven above.
create function public.mark_client_billing_invoiced(p_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_status public.client_billing_status;
begin
  if not public.is_manager(public.current_user_role()) then
    raise exception 'mark_client_billing_invoiced: role not permitted' using errcode = '42501';
  end if;
  select status into v_status from public.client_billings where id = p_id;
  if not found then
    raise exception 'mark_client_billing_invoiced: billing not found' using errcode = 'P0001';
  end if;
  if v_status <> 'certified' then
    raise exception 'mark_client_billing_invoiced: only a certified billing can be marked invoiced' using errcode = 'P0001';
  end if;

  update public.client_billings set status = 'invoiced' where id = p_id;

  insert into public.audit_log (action, actor_id, actor_role, target_table, target_id, payload)
  values ('client_billing_invoiced', auth.uid(), public.current_user_role(), 'client_billings', p_id,
          jsonb_build_object('id', p_id));
  return p_id;
end;
$$;
revoke all on function public.mark_client_billing_invoiced(uuid) from public, anon;
grant execute on function public.mark_client_billing_invoiced(uuid) to authenticated;

-- ----------------------------------------------------------------------------
-- Poster (drain-called, owner context — no session grants). Mirrors
-- post_dc_payment_to_gl: supersede reverses the replaced row's entry; re-drain
-- reverses own; a tombstone posts nothing new.
create function public.post_client_receipt_to_gl(p_source_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row   public.client_receipts;
  v_old   uuid;
  v_lines jsonb;
begin
  select * into v_row from public.client_receipts where id = p_source_id;
  if not found then
    raise exception 'post_client_receipt_to_gl: receipt not found' using errcode = 'P0001';
  end if;

  if v_row.superseded_by is not null then
    select e.id into v_old from public.journal_entries e
      where e.source_table = 'client_receipts' and e.source_id = v_row.superseded_by
        and e.source_event = 'client_receipt' and e.status = 'posted'
        and not exists (select 1 from public.journal_entries r where r.reversal_of = e.id)
      limit 1;
    if v_old is not null then
      perform public.reverse_journal_internal(v_old, v_row.created_by, 'void: superseded client receipt');
    end if;
  end if;

  select e.id into v_old from public.journal_entries e
    where e.source_table = 'client_receipts' and e.source_id = p_source_id
      and e.source_event = 'client_receipt' and e.status = 'posted'
      and not exists (select 1 from public.journal_entries r where r.reversal_of = e.id)
    limit 1;
  if v_old is not null then
    perform public.reverse_journal_internal(v_old, v_row.created_by, 'auto-correct: client receipt re-posted');
  end if;

  if v_row.amount is null then
    return null;
  end if;

  v_lines := jsonb_build_array(
    jsonb_build_object('account_code', '1110', 'debit', v_row.amount,
                       'project_id', v_row.project_id),
    jsonb_build_object('account_code',
                       case when v_row.client_billing_id is null then '2300' else '1200' end,
                       'credit', v_row.amount, 'project_id', v_row.project_id));

  return public.post_journal_internal(
    v_row.received_date, 'client_receipts', p_source_id, 'client_receipt',
    'Client receipt', v_lines, null, v_row.created_by);
end;
$$;
revoke all on function public.post_client_receipt_to_gl(uuid) from public, anon, authenticated;

-- ----------------------------------------------------------------------------
-- Drain re-source — body VERBATIM from LIVE (pg_get_functiondef, 2026-07-03,
-- after migration 061000) + ONE new arm for client_receipts. Never sourced from
-- a migration file (GL-drain lesson ×3).
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
        -- Client receipts (spec 249).
        when 'client_receipts'          then v_entry := public.post_client_receipt_to_gl(v_job.source_id);
        -- Store movements (spec 178 B6a/B6b + 209 U1). receive/issue/return survived
        -- the spec-209 re-source; count/reversal were the dropped arms restored here.
        when 'stock_receipts'           then v_entry := public.post_stock_receipt_to_gl(v_job.source_id);
        when 'stock_issues'             then v_entry := public.post_stock_issue_to_gl(v_job.source_id);
        when 'stock_returns'            then v_entry := public.post_stock_return_to_gl(v_job.source_id);
        when 'stock_counts'             then v_entry := public.post_stock_count_to_gl(v_job.source_id);
        when 'stock_reversals'          then v_entry := public.post_stock_reversal_to_gl(v_job.source_id);
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

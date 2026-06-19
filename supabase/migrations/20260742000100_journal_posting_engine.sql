-- Spec 149 U4b / ADR 0057 — the posting engine, made drainer-ready:
--   * post_journal_internal gains p_posted_by (attribute to the source actor; NULL
--     ok now that posted_by is nullable) + per-line party columns.
--   * reverse logic split into reverse_journal_internal(entry, posted_by, memo) so
--     the U4b posters can reverse-and-repost; reverse_journal_entry (human,
--     pm/super) delegates to it.
--   * resolve_posting_period DE-GATED to pure plumbing (ADR 0057 decision 12 — the
--     service-role drainer has a NULL role) + granted to service_role.

-- ----------------------------------------------------------------------------
-- post_journal_internal — add p_posted_by + party. Signature change → DROP+CREATE
-- (the plpgsql callers post_journal_entry / reverse_* are not hard-dependent on it
-- and resolve the new 8-arg signature with the added default).
drop function if exists public.post_journal_internal(date, text, uuid, text, text, jsonb, uuid);

create function public.post_journal_internal(
  p_entry_date   date,
  p_source_table text,
  p_source_id    uuid,
  p_source_event text,
  p_memo         text,
  p_lines        jsonb,
  p_reversal_of  uuid default null,
  p_posted_by    uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor     uuid := coalesce(p_posted_by, auth.uid());
  v_period_id uuid;
  v_entry_id  uuid;
  v_entry_no  bigint;
  v_line      jsonb;
  v_ord       integer := 0;
  v_code      text;
  v_debit     numeric(14,2);
  v_credit    numeric(14,2);
  v_acc_id    uuid;
  v_postable  boolean;
  v_active    boolean;
  v_sum_d     numeric(14,2) := 0;
  v_sum_c     numeric(14,2) := 0;
begin
  if p_lines is null or jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) < 2 then
    raise exception 'post_journal_internal: at least two lines required' using errcode = 'P0001';
  end if;

  v_period_id := public.resolve_posting_period(p_entry_date);

  insert into public.journal_entries
    (entry_date, period_id, source_table, source_id, source_event, memo, status, reversal_of, posted_by)
  values
    (p_entry_date, v_period_id, p_source_table, p_source_id, p_source_event,
     nullif(btrim(coalesce(p_memo, '')), ''), 'posted', p_reversal_of, v_actor)
  returning id, entry_no into v_entry_id, v_entry_no;

  for v_line in select value from jsonb_array_elements(p_lines)
  loop
    v_ord    := v_ord + 1;
    v_code   := btrim(coalesce(v_line->>'account_code', ''));
    v_debit  := coalesce(nullif(v_line->>'debit', ''),  '0')::numeric;
    v_credit := coalesce(nullif(v_line->>'credit', ''), '0')::numeric;

    select id, is_postable, active into v_acc_id, v_postable, v_active
      from public.gl_accounts where code = v_code;
    if v_acc_id is null then
      raise exception 'post_journal_internal: unknown account %', v_code using errcode = 'P0001';
    end if;
    if not v_postable or not v_active then
      raise exception 'post_journal_internal: account % is not postable', v_code using errcode = 'P0001';
    end if;
    if not ((v_debit > 0 and v_credit = 0) or (v_credit > 0 and v_debit = 0)) then
      raise exception 'post_journal_internal: line % must be one-sided', v_ord using errcode = 'P0001';
    end if;

    insert into public.journal_lines
      (entry_id, line_no, account_id, debit, credit, project_id, work_package_id,
       supplier_id, contractor_id, client_id, equipment_owner_id, memo)
    values
      (v_entry_id, v_ord, v_acc_id, v_debit, v_credit,
       nullif(v_line->>'project_id', '')::uuid,
       nullif(v_line->>'work_package_id', '')::uuid,
       nullif(v_line->>'supplier_id', '')::uuid,
       nullif(v_line->>'contractor_id', '')::uuid,
       nullif(v_line->>'client_id', '')::uuid,
       nullif(v_line->>'equipment_owner_id', '')::uuid,
       nullif(btrim(coalesce(v_line->>'memo', '')), ''));

    v_sum_d := v_sum_d + v_debit;
    v_sum_c := v_sum_c + v_credit;
  end loop;

  if v_sum_d <> v_sum_c then
    raise exception 'post_journal_internal: unbalanced (debit % <> credit %)', v_sum_d, v_sum_c using errcode = 'P0001';
  end if;
  if v_sum_d = 0 then
    raise exception 'post_journal_internal: zero-total entry' using errcode = 'P0001';
  end if;

  insert into public.audit_log (action, actor_id, actor_role, target_table, target_id, payload)
  values ('journal_posted', v_actor, public.current_user_role(),
          'journal_entries', v_entry_id,
          jsonb_build_object('entry_no', v_entry_no, 'source_table', p_source_table,
                             'source_event', p_source_event, 'amount', v_sum_d,
                             'line_count', v_ord, 'reversal_of', p_reversal_of));
  return v_entry_id;
end;
$$;
revoke all on function public.post_journal_internal(date, text, uuid, text, text, jsonb, uuid, uuid)
  from public, anon, authenticated;

-- ----------------------------------------------------------------------------
-- reverse_journal_internal — the core append-only correction (no role gate;
-- internal, called by the human wrapper + the U4b posters). Mirrors lines
-- (debit<->credit, keeping dims + party), posts into the current open period with
-- reversal_of set, attributed to p_posted_by.
create function public.reverse_journal_internal(
  p_entry_id uuid,
  p_posted_by uuid,
  p_memo text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_no     bigint;
  v_status public.journal_entry_status;
  v_lines  jsonb;
begin
  select entry_no, status into v_no, v_status
    from public.journal_entries where id = p_entry_id;
  if v_no is null then
    raise exception 'reverse_journal_internal: entry not found' using errcode = 'P0001';
  end if;
  if v_status <> 'posted' then
    raise exception 'reverse_journal_internal: only a posted entry can be reversed' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.journal_entries where reversal_of = p_entry_id) then
    raise exception 'reverse_journal_internal: entry already reversed' using errcode = 'P0001';
  end if;

  select jsonb_agg(
           jsonb_build_object(
             'account_code', a.code,
             'debit',  l.credit,
             'credit', l.debit,
             'project_id', l.project_id,
             'work_package_id', l.work_package_id,
             'supplier_id', l.supplier_id,
             'contractor_id', l.contractor_id,
             'client_id', l.client_id,
             'equipment_owner_id', l.equipment_owner_id,
             'memo', l.memo)
           order by l.line_no)
    into v_lines
    from public.journal_lines l
    join public.gl_accounts a on a.id = l.account_id
   where l.entry_id = p_entry_id;

  return public.post_journal_internal(
    current_date, 'journal_reversal', p_entry_id, 'reversal',
    coalesce(nullif(btrim(coalesce(p_memo, '')), ''), 'reversal of #' || v_no),
    v_lines, p_entry_id, p_posted_by);
end;
$$;
revoke all on function public.reverse_journal_internal(uuid, uuid, text) from public, anon, authenticated;

-- ----------------------------------------------------------------------------
-- reverse_journal_entry (human, pm/super) now delegates to the internal core.
create or replace function public.reverse_journal_entry(
  p_entry_id uuid,
  p_memo     text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
begin
  if public.current_user_role() not in ('project_manager', 'super_admin') then
    raise exception 'reverse_journal_entry: role not permitted' using errcode = '42501';
  end if;
  return public.reverse_journal_internal(p_entry_id, auth.uid(), p_memo);
end;
$$;

-- ----------------------------------------------------------------------------
-- resolve_posting_period — DE-GATED (ADR 0057 decision 12): pure internal
-- plumbing now (the human gates live on post_journal_entry / open_accounting_period
-- / set_accounting_period_status). Still period-guards (P0002) + auto-opens.
-- Granted to service_role for the U4c drainer.
create or replace function public.resolve_posting_period(p_date date)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_month  date := date_trunc('month', p_date)::date;
  v_id     uuid;
  v_status public.accounting_period_status;
begin
  select id, status into v_id, v_status
    from public.accounting_periods where period_month = v_month;

  if v_id is not null then
    if v_status in ('closed', 'locked') then
      raise exception 'resolve_posting_period: period % is closed', v_month using errcode = 'P0002';
    end if;
    return v_id;
  end if;

  insert into public.accounting_periods (period_month, status)
  values (v_month, 'open')
  on conflict (period_month) do nothing
  returning id into v_id;
  if v_id is null then
    select id into v_id from public.accounting_periods where period_month = v_month;
  end if;
  return v_id;
end;
$$;
grant execute on function public.resolve_posting_period(date) to service_role;

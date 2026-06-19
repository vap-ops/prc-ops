-- Spec 149 U3 / ADR 0057 decision 3 — the journal write path:
--   post_journal_internal — the SINGLE insert path. Resolves+guards the period
--     (P0002 if closed), resolves each line's account by code (must exist +
--     is_postable + active), enforces one-sided non-negative lines, asserts
--     Σdebit = Σcredit (> 0), inserts header + lines, audits 'journal_posted'.
--     Internal — revoked from authenticated; reachable only via the definer
--     wrappers below (and the U4 posters).
--   post_journal_entry — human-facing manual/closing entry (pm/super).
--   reverse_journal_entry — append-only correction: a balanced mirror (dr<->cr)
--     linked via reversal_of, posted into the CURRENT open period (decision 7).
-- All SECURITY DEFINER on the AUTHENTICATED session.

-- ----------------------------------------------------------------------------
create function public.post_journal_internal(
  p_entry_date   date,
  p_source_table text,
  p_source_id    uuid,
  p_source_event text,
  p_memo         text,
  p_lines        jsonb,
  p_reversal_of  uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
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
  if p_lines is null or jsonb_typeof(p_lines) <> 'array'
     or jsonb_array_length(p_lines) < 2 then
    raise exception 'post_journal_internal: at least two lines required' using errcode = 'P0001';
  end if;

  -- Period guard (P0002 if closed/locked; auto-opens an absent month).
  v_period_id := public.resolve_posting_period(p_entry_date);

  insert into public.journal_entries
    (entry_date, period_id, source_table, source_id, source_event, memo, status, reversal_of, posted_by)
  values
    (p_entry_date, v_period_id, p_source_table, p_source_id, p_source_event,
     nullif(btrim(coalesce(p_memo, '')), ''), 'posted', p_reversal_of, auth.uid())
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
      raise exception 'post_journal_internal: line % must be one-sided (debit XOR credit)', v_ord
        using errcode = 'P0001';
    end if;

    insert into public.journal_lines
      (entry_id, line_no, account_id, debit, credit, project_id, work_package_id, memo)
    values
      (v_entry_id, v_ord, v_acc_id, v_debit, v_credit,
       nullif(v_line->>'project_id', '')::uuid,
       nullif(v_line->>'work_package_id', '')::uuid,
       nullif(btrim(coalesce(v_line->>'memo', '')), ''));

    v_sum_d := v_sum_d + v_debit;
    v_sum_c := v_sum_c + v_credit;
  end loop;

  if v_sum_d <> v_sum_c then
    raise exception 'post_journal_internal: unbalanced (debit % <> credit %)', v_sum_d, v_sum_c
      using errcode = 'P0001';
  end if;
  if v_sum_d = 0 then
    raise exception 'post_journal_internal: zero-total entry' using errcode = 'P0001';
  end if;

  insert into public.audit_log (action, actor_id, actor_role, target_table, target_id, payload)
  values ('journal_posted', auth.uid(), public.current_user_role(),
          'journal_entries', v_entry_id,
          jsonb_build_object('entry_no', v_entry_no, 'source_table', p_source_table,
                             'source_event', p_source_event, 'amount', v_sum_d,
                             'line_count', v_ord, 'reversal_of', p_reversal_of));
  return v_entry_id;
end;
$$;
-- Internal: not reachable directly by any session role — only via the definer
-- wrappers below (and the U4 posters), whose owner has execute.
revoke all on function public.post_journal_internal(date, text, uuid, text, text, jsonb, uuid)
  from public, anon, authenticated;

-- ----------------------------------------------------------------------------
create function public.post_journal_entry(
  p_entry_date date,
  p_memo       text,
  p_lines      jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
begin
  if public.current_user_role() not in ('project_manager', 'super_admin') then
    raise exception 'post_journal_entry: role not permitted' using errcode = '42501';
  end if;
  return public.post_journal_internal(
    p_entry_date, 'manual', null, 'manual', p_memo, p_lines, null);
end;
$$;
revoke all on function public.post_journal_entry(date, text, jsonb) from public, anon;
grant execute on function public.post_journal_entry(date, text, jsonb) to authenticated;

-- ----------------------------------------------------------------------------
create function public.reverse_journal_entry(
  p_entry_id uuid,
  p_memo     text default null
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
  if public.current_user_role() not in ('project_manager', 'super_admin') then
    raise exception 'reverse_journal_entry: role not permitted' using errcode = '42501';
  end if;

  select entry_no, status into v_no, v_status
    from public.journal_entries where id = p_entry_id;
  if v_no is null then
    raise exception 'reverse_journal_entry: entry not found' using errcode = 'P0001';
  end if;
  if v_status <> 'posted' then
    raise exception 'reverse_journal_entry: only a posted entry can be reversed' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.journal_entries where reversal_of = p_entry_id) then
    raise exception 'reverse_journal_entry: entry already reversed' using errcode = 'P0001';
  end if;

  -- Mirror lines: swap debit <-> credit, keep account + dimensions.
  select jsonb_agg(
           jsonb_build_object(
             'account_code', a.code,
             'debit',  l.credit,
             'credit', l.debit,
             'project_id', l.project_id,
             'work_package_id', l.work_package_id,
             'memo', l.memo)
           order by l.line_no)
    into v_lines
    from public.journal_lines l
    join public.gl_accounts a on a.id = l.account_id
   where l.entry_id = p_entry_id;

  -- Reversal posts into the CURRENT open period (decision 7), never by reopening
  -- the original's (possibly closed) period.
  return public.post_journal_internal(
    current_date, 'journal_reversal', p_entry_id, 'reversal',
    coalesce(nullif(btrim(coalesce(p_memo, '')), ''), 'reversal of #' || v_no),
    v_lines, p_entry_id);
end;
$$;
revoke all on function public.reverse_journal_entry(uuid, text) from public, anon;
grant execute on function public.reverse_journal_entry(uuid, text) to authenticated;

-- Spec 373 §5 follow-up (fresh-eyes 🔵 on mig 075871): the verified-check took
-- no lock, so a review flipping verified→flagged (flag_money_event, which takes
-- FOR UPDATE on the row) or verified→pending (the correct_office_expense stale
-- trigger) committing between the check and the UPDATE could let a payment land
-- on a now-unverified review. The check becomes PERFORM … FOR SHARE: it blocks
-- against flag_money_event's FOR UPDATE until this txn commits, closing the
-- window. Everything else is byte-identical to 075871 (a NEW migration because
-- editing an applied one is a silent no-op).

create or replace function public.mark_expense_reimbursed(p_expense_id uuid)
 returns void
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_role public.user_role := public.current_user_role();
  v_target uuid;
  v_already timestamptz;
begin
  if v_role is null or v_role not in ('super_admin','accounting') then
    raise exception 'mark_expense_reimbursed: role not permitted' using errcode = '42501';
  end if;
  select reimburse_to_user_id, reimbursed_at into v_target, v_already
    from public.office_expenses where id = p_expense_id;
  if not found then
    raise exception 'mark_expense_reimbursed: expense not found' using errcode = 'P0001';
  end if;
  if v_target is null then
    raise exception 'mark_expense_reimbursed: expense has no reimburse target' using errcode = 'P0001';
  end if;
  if v_already is not null then
    raise exception 'mark_expense_reimbursed: already reimbursed' using errcode = 'P0001';
  end if;
  -- Spec 373 §5 hard pay-gate: money leaves only after the document review
  -- verified this expense. Absent review row = not reviewed = refused. FOR
  -- SHARE holds the verified row against a concurrent un-verify
  -- (flag_money_event takes FOR UPDATE) until this txn commits.
  perform 1 from public.money_event_reviews r
   where r.source_table = 'office_expenses'
     and r.source_id = p_expense_id
     and r.status = 'verified'
   for share;
  if not found then
    raise exception 'mark_expense_reimbursed: expense not verified' using errcode = 'P0001';
  end if;
  -- The conditional UPDATE is the atomic guard against a concurrent double-mark:
  -- the SELECT above does not lock, so two racing calls both read a null
  -- reimbursed_at; the loser's UPDATE then re-reads it as non-null (READ
  -- COMMITTED) and matches 0 rows -> not found -> raise, so audit_log gets ONE row.
  update public.office_expenses
     set reimbursed_at = now(), reimbursed_by = auth.uid()
   where id = p_expense_id and reimbursed_at is null;
  if not found then
    raise exception 'mark_expense_reimbursed: already reimbursed' using errcode = 'P0001';
  end if;
  insert into public.audit_log (action, actor_id, actor_role, target_table, target_id, payload)
  values ('office_expense_reimburse', auth.uid(), v_role, 'office_expenses', p_expense_id,
          jsonb_build_object('reimburse_to', v_target));
end;
$function$;

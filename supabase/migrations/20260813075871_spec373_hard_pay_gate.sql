-- Spec 373 §5 — the hard validate-before-pay gate (operator decision 2026-07-29).
-- mark_expense_reimbursed now REFUSES unless the expense's spec-345 review row
-- is status='verified' (absent row = unverified — office_expenses is an
-- allowlisted money-review source, so "no row yet" means "not reviewed yet").
--
-- Body-only CREATE OR REPLACE, sourced from the LIVE definition (never a
-- migration file — prc-ops-db-migration-lessons); same signature, so existing
-- grants and the in-body 42501 role gate are unchanged. The new arm sits AFTER
-- the target/already guards and BEFORE the atomic UPDATE, with its own pinned
-- message so P0001 here is never confused with the already-reimbursed guard
-- (pgTAP 373-expense-pay-gate pins the message on every refusal).

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
  -- verified this expense. Absent review row = not reviewed = refused.
  if not exists (
    select 1 from public.money_event_reviews r
     where r.source_table = 'office_expenses'
       and r.source_id = p_expense_id
       and r.status = 'verified'
  ) then
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

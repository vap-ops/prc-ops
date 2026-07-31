-- Feedback 41cd07d9 (PD, 2026-07-13): "ลงวันที่ผิด, บันทึกโครงการผิด ขอให้สามารถลบ
-- หรือ แก้ไข ได้ครับ" — office expenses gain an edit + delete path.
--
-- office_expenses is a plain mutable table with NO update/delete policies and
-- RPC-only writes; the money_review_stale trigger already anticipated edits
-- (it marks the spec-345 review stale when money-material columns change).
-- This migration adds the missing pair, mirroring record_office_expense's
-- validation exactly, with three gates:
--   authz  : the submitter, or finance (super_admin/accounting) — 42501.
--   lock   : a reimbursed row is immutable for EVERYONE — P0001 (money left;
--            corrections after payment are an accounting event, not an edit).
--   re-derive: reimburse_to_user_id recomputed from the NEW payment source.
--            own_money maps to the row's SUBMITTER — never auth.uid(), which
--            would silently steal the target when finance edits (the record
--            RPC may use auth.uid() only because recorder == submitter there).
-- Delete also clears the row's money_event_reviews entries (polymorphic
-- source_table/source_id — no FK does it) and audits a full snapshot; the
-- attachment rows go via FK cascade (storage bytes are left for the bucket
-- lifecycle — same posture as other deletes).
-- The stale trigger's WHEN gains project_id + category_id: both change which
-- review lens the row appears under, so a verified review must re-verify.

alter type public.audit_action add value if not exists 'office_expense_update';
alter type public.audit_action add value if not exists 'office_expense_delete';

drop trigger if exists office_expenses_money_review_stale on public.office_expenses;
create trigger office_expenses_money_review_stale
  after update on public.office_expenses
  for each row
  when (
    new.amount is distinct from old.amount
    or new.expense_date is distinct from old.expense_date
    or new.payment_source is distinct from old.payment_source
    or new.project_id is distinct from old.project_id
    or new.category_id is distinct from old.category_id
  )
  execute function public.money_review_mark_stale_tg('office_expenses', 'id');

create or replace function public.update_office_expense(
  p_expense_id uuid,
  p_category_id uuid,
  p_description text,
  p_amount numeric,
  p_expense_date date,
  p_payment_source public.payment_source,
  p_project_id uuid default null,
  p_company_card_id uuid default null
)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_role public.user_role := public.current_user_role();
  v_row public.office_expenses%rowtype;
  v_reimburse uuid;
begin
  select * into v_row from public.office_expenses where id = p_expense_id for update;
  if not found then
    raise exception 'update_office_expense: expense not found' using errcode = 'P0001';
  end if;

  -- authz first: outsiders get 42501 regardless of row state.
  if not (v_row.submitted_by = auth.uid()
          or coalesce(v_role in ('super_admin','accounting'), false)) then
    raise exception 'update_office_expense: not permitted' using errcode = '42501';
  end if;

  if v_row.reimbursed_at is not null then
    raise exception 'update_office_expense: already reimbursed — locked' using errcode = 'P0001';
  end if;

  -- validations mirror record_office_expense exactly.
  if coalesce(length(btrim(p_description)), 0) = 0 then
    raise exception 'update_office_expense: description required' using errcode = 'P0001';
  end if;
  if p_amount is null or p_amount <= 0 then
    raise exception 'update_office_expense: amount must be positive' using errcode = 'P0001';
  end if;
  if not exists (select 1 from public.office_expense_categories where id = p_category_id and is_active) then
    raise exception 'update_office_expense: unknown category' using errcode = 'P0001';
  end if;

  if p_payment_source = 'company_card' then
    if p_company_card_id is null then
      raise exception 'update_office_expense: card required for company_card source' using errcode = 'P0001';
    end if;
    select holder_user_id into v_reimburse
      from public.company_cards where id = p_company_card_id and is_active;
    if v_reimburse is null then
      raise exception 'update_office_expense: unknown or inactive card' using errcode = 'P0001';
    end if;
  elsif p_payment_source = 'own_money' then
    -- The SUBMITTER stays the target — auth.uid() here may be a finance editor.
    v_reimburse := v_row.submitted_by;
    if p_company_card_id is not null then
      raise exception 'update_office_expense: card not allowed for this source' using errcode = 'P0001';
    end if;
  else  -- company_direct
    v_reimburse := null;
    if p_company_card_id is not null then
      raise exception 'update_office_expense: card not allowed for this source' using errcode = 'P0001';
    end if;
  end if;

  update public.office_expenses
     set category_id = p_category_id,
         description = btrim(p_description),
         amount = p_amount,
         expense_date = p_expense_date,
         payment_source = p_payment_source,
         company_card_id = case when p_payment_source = 'company_card' then p_company_card_id else null end,
         project_id = p_project_id,
         reimburse_to_user_id = v_reimburse
   where id = p_expense_id;

  insert into public.audit_log (action, actor_id, actor_role, target_table, target_id, payload)
  values ('office_expense_update', auth.uid(), v_role, 'office_expenses', p_expense_id,
          jsonb_build_object(
            'old_amount', v_row.amount, 'new_amount', p_amount,
            'old_source', v_row.payment_source, 'new_source', p_payment_source,
            'old_project', v_row.project_id, 'new_project', p_project_id,
            'old_expense_date', v_row.expense_date, 'new_expense_date', p_expense_date));
end;
$function$;

create or replace function public.delete_office_expense(p_expense_id uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_role public.user_role := public.current_user_role();
  v_row public.office_expenses%rowtype;
begin
  select * into v_row from public.office_expenses where id = p_expense_id for update;
  if not found then
    raise exception 'delete_office_expense: expense not found' using errcode = 'P0001';
  end if;

  if not (v_row.submitted_by = auth.uid()
          or coalesce(v_role in ('super_admin','accounting'), false)) then
    raise exception 'delete_office_expense: not permitted' using errcode = '42501';
  end if;

  if v_row.reimbursed_at is not null then
    raise exception 'delete_office_expense: already reimbursed — locked' using errcode = 'P0001';
  end if;

  -- Polymorphic review entries have no FK to cascade — clear them or the
  -- review queue keeps a dangling row pointing at nothing.
  delete from public.money_event_reviews
   where source_table = 'office_expenses' and source_id = p_expense_id;

  delete from public.office_expenses where id = p_expense_id;

  insert into public.audit_log (action, actor_id, actor_role, target_table, target_id, payload)
  values ('office_expense_delete', auth.uid(), v_role, 'office_expenses', p_expense_id,
          jsonb_build_object(
            'amount', v_row.amount, 'expense_date', v_row.expense_date,
            'payment_source', v_row.payment_source, 'project_id', v_row.project_id,
            'category_id', v_row.category_id, 'description', v_row.description,
            'submitted_by', v_row.submitted_by,
            'reimburse_to', v_row.reimburse_to_user_id));
end;
$function$;

revoke all on function public.update_office_expense(uuid, uuid, text, numeric, date, public.payment_source, uuid, uuid) from public, anon;
revoke all on function public.delete_office_expense(uuid) from public, anon;
grant execute on function public.update_office_expense(uuid, uuid, text, numeric, date, public.payment_source, uuid, uuid) to authenticated;
grant execute on function public.delete_office_expense(uuid) to authenticated;

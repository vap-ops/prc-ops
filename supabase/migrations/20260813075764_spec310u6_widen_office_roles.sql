-- Spec 310 U6 (operator 2026-07-13) — widen who may record an office expense:
-- add project_manager / project_director / site_owner / site_admin / auditor to
-- the record_office_expense gate + the expense-attachments upload policy. They
-- record + see their OWN (the SELECT policy's submitter clause already covers
-- them); finance-see-all + mark_expense_reimbursed stay accounting/super_admin.
-- create-or-replace preserves the existing grants.

create or replace function public.record_office_expense(
  p_category_id uuid,
  p_description text,
  p_amount numeric,
  p_expense_date date,
  p_payment_source public.payment_source,
  p_project_id uuid default null,
  p_company_card_id uuid default null
) returns uuid
language plpgsql security definer set search_path = public
as $$
declare
  v_role public.user_role := public.current_user_role();
  v_reimburse uuid;
  v_id uuid;
begin
  if v_role is null
     or v_role not in ('super_admin','procurement','procurement_manager','accounting',
                       'project_manager','project_director','site_owner','site_admin','auditor') then
    raise exception 'record_office_expense: role not permitted' using errcode = '42501';
  end if;
  if coalesce(length(btrim(p_description)), 0) = 0 then
    raise exception 'record_office_expense: description required' using errcode = 'P0001';
  end if;
  if p_amount is null or p_amount <= 0 then
    raise exception 'record_office_expense: amount must be positive' using errcode = 'P0001';
  end if;
  if not exists (select 1 from public.office_expense_categories where id = p_category_id and is_active) then
    raise exception 'record_office_expense: unknown category' using errcode = 'P0001';
  end if;

  if p_payment_source = 'company_card' then
    if p_company_card_id is null then
      raise exception 'record_office_expense: card required for company_card source' using errcode = 'P0001';
    end if;
    select holder_user_id into v_reimburse
      from public.company_cards where id = p_company_card_id and is_active;
    if v_reimburse is null then
      raise exception 'record_office_expense: unknown or inactive card' using errcode = 'P0001';
    end if;
  elsif p_payment_source = 'own_money' then
    v_reimburse := auth.uid();
    if p_company_card_id is not null then
      raise exception 'record_office_expense: card not allowed for this source' using errcode = 'P0001';
    end if;
  else  -- company_direct
    v_reimburse := null;
    if p_company_card_id is not null then
      raise exception 'record_office_expense: card not allowed for this source' using errcode = 'P0001';
    end if;
  end if;

  insert into public.office_expenses
    (project_id, category_id, description, amount, expense_date, payment_source,
     company_card_id, reimburse_to_user_id, submitted_by)
  values
    (p_project_id, p_category_id, btrim(p_description), p_amount, p_expense_date, p_payment_source,
     case when p_payment_source = 'company_card' then p_company_card_id else null end,
     v_reimburse, auth.uid())
  returning id into v_id;

  insert into public.audit_log (action, actor_id, actor_role, target_table, target_id, payload)
  values ('office_expense_record', auth.uid(), v_role, 'office_expenses', v_id,
          jsonb_build_object('amount', p_amount, 'payment_source', p_payment_source,
                             'reimburse_to', v_reimburse, 'project_id', p_project_id));
  return v_id;
end;
$$;

-- Widen the receipt-upload storage policy's role gate to the same set (the exists
-- clause keys on submitted_by = the uploader, so it already covers the new roles).
drop policy if exists "expense receipt uploads by office roles" on storage.objects;
create policy "expense receipt uploads by office roles"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'expense-attachments'
    and coalesce(public.current_user_role() in
         ('super_admin','procurement','procurement_manager','accounting',
          'project_manager','project_director','site_owner','site_admin','auditor'), false)
    and array_length(storage.foldername(objects.name), 1) = 1
    and exists (
      select 1 from public.office_expenses e
       where e.id::text = (storage.foldername(objects.name))[1]
         and (e.submitted_by = auth.uid()
              or coalesce(public.current_user_role() in ('super_admin','accounting'), false))
    )
  );

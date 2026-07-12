-- Spec 310 U4 — the receipt uploader's authenticated client writes the metadata
-- row (bytes already went to the expense-attachments bucket via its storage
-- policy). U1 granted this table SELECT-only; grant INSERT + a scoped policy that
-- mirrors the pr-attachments pattern: the caller may attach only to an expense
-- they can see (submitter or finance), and created_by must be themselves.
-- auth.uid()/current_user_role() wrapped in a scalar subselect (40-rls-eval-once).

grant insert on public.office_expense_attachments to authenticated;

create policy "expense attachment insert by office roles"
  on public.office_expense_attachments
  for insert to authenticated
  with check (
    created_by = (select auth.uid())
    and exists (
      select 1 from public.office_expenses e
       where e.id = office_expense_id
         and (
           e.submitted_by = (select auth.uid())
           or coalesce((select public.current_user_role()) in ('super_admin', 'accounting'), false)
         )
    )
  );

-- Spec 149 U4c — one more skeleton account the labor-freeze poster needs: the
-- own-staff payroll clearing liability (the DC side already has 2110 DC-clearing).
-- Idempotent (the skeleton-COA convention); the accountant's real COA refines it.

insert into public.gl_accounts (code, name_th, name_en, account_type, normal_side, is_postable, parent_id, sort_order)
values
  ('2130', 'เจ้าหนี้ค่าแรงพนักงาน (พักจ่าย)', 'Payroll clearing (own staff)',
   'liability', 'credit', true,
   (select id from public.gl_accounts where code = '2000'), 35)
on conflict (code) do nothing;

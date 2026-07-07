-- Spec 275 U3b — seed the deposit-prepaid asset account (1320).
--
-- The rental deposit is a REFUNDABLE prepaid asset (ADR 0078 decision 7): Dr 1320
-- when PRC pays it (fired off the agreement's deposit_paid_date), released at
-- settlement (refunded → Dr Bank / Cr 1320; forfeited → Dr expense / Cr 1320). It
-- is NEVER netted into the rental cost. The seam sweep confirmed 1320 is absent
-- from the skeleton chart (20260738000200 seeds 1110/1200/1210/1300/1310/1400 but
-- no 1320) — seed it here, matching that seed's shape (asset, debit-normal,
-- postable leaf under the 1000 Assets heading). Idempotent (on conflict do
-- nothing) so the accountant's real-COA migration can coexist, same as the
-- skeleton seed.
insert into public.gl_accounts (code, name_th, name_en, account_type, normal_side, is_postable, parent_id, sort_order)
values
  ('1320', 'เงินมัดจำค่าเช่า (จ่ายล่วงหน้า)', 'Rental deposit - prepaid', 'asset', 'debit', true,
     (select id from public.gl_accounts where code = '1000'), 55)
on conflict (code) do nothing;

-- Spec 149 U1 / ADR 0057 — construction-standard SKELETON chart of accounts.
-- A placeholder structure (the accountant's real COA + codes + peak_account_code
-- map replaces/extends this via a later idempotent migration — ADR 0057 open
-- question). Idempotent (on conflict (code) do nothing) so the real-COA migration
-- runs alongside without collision. Contains the headings + the postable leaves
-- the U4/U5/U6 posters need, incl. the per-subledger CONTROL accounts that the
-- U7 reconciliation invariant anchors on (AP - DC clearing, AP - intercompany,
-- Retention receivable, the VAT + WHT pairs).
--
-- Direct INSERT (not via the RPC) — this is owner-run seed data, not an audited
-- user action; no audit_log row (the RPC is the audited human path).

-- Class headings (is_postable = false; they group, never post).
insert into public.gl_accounts (code, name_th, name_en, account_type, normal_side, is_postable, sort_order)
values
  ('1000', 'สินทรัพย์',            'Assets',          'asset',     'debit',  false, 10),
  ('2000', 'หนี้สิน',              'Liabilities',     'liability', 'credit', false, 20),
  ('3000', 'ส่วนของเจ้าของ',       'Equity',          'equity',    'credit', false, 30),
  ('4000', 'รายได้',               'Income',          'income',    'credit', false, 40),
  ('5000', 'ต้นทุนและค่าใช้จ่าย',  'Cost & expense',  'expense',   'debit',  false, 50)
on conflict (code) do nothing;

-- Assets (debit-normal leaves).
insert into public.gl_accounts (code, name_th, name_en, account_type, normal_side, is_postable, parent_id, sort_order)
values
  ('1110', 'เงินฝากธนาคาร',               'Bank',                  'asset', 'debit', true,
     (select id from public.gl_accounts where code = '1000'), 10),
  ('1200', 'ลูกหนี้การค้า',               'AR - trade',            'asset', 'debit', true,
     (select id from public.gl_accounts where code = '1000'), 20),
  ('1210', 'ลูกหนี้เงินประกันผลงาน',      'Retention receivable',  'asset', 'debit', true,
     (select id from public.gl_accounts where code = '1000'), 30),
  ('1300', 'ภาษีซื้อ',                    'Input VAT',             'asset', 'debit', true,
     (select id from public.gl_accounts where code = '1000'), 40),
  ('1310', 'ภาษีเงินได้ถูกหัก ณ ที่จ่าย', 'WHT prepaid (suffered)','asset', 'debit', true,
     (select id from public.gl_accounts where code = '1000'), 50),
  ('1400', 'งานระหว่างก่อสร้าง',          'WIP - construction',    'asset', 'debit', true,
     (select id from public.gl_accounts where code = '1000'), 60)
on conflict (code) do nothing;

-- Liabilities (credit-normal leaves; the subledger CONTROL accounts live here).
insert into public.gl_accounts (code, name_th, name_en, account_type, normal_side, is_postable, parent_id, sort_order)
values
  ('2100', 'เจ้าหนี้การค้า',                    'AP - trade',                'liability', 'credit', true,
     (select id from public.gl_accounts where code = '2000'), 10),
  ('2110', 'เจ้าหนี้ค่าแรง DC (พักรอจ่าย)',     'AP - DC clearing',          'liability', 'credit', true,
     (select id from public.gl_accounts where code = '2000'), 20),
  ('2120', 'เจ้าหนี้ระหว่างกัน-ค่าเช่าอุปกรณ์', 'AP - intercompany equip',   'liability', 'credit', true,
     (select id from public.gl_accounts where code = '2000'), 30),
  ('2200', 'ภาษีขาย',                           'Output VAT',                'liability', 'credit', true,
     (select id from public.gl_accounts where code = '2000'), 40),
  ('2210', 'ภาษีหัก ณ ที่จ่ายค้างนำส่ง',        'WHT payable (deducted)',    'liability', 'credit', true,
     (select id from public.gl_accounts where code = '2000'), 50),
  ('2220', 'เงินประกันผลงานค้างจ่าย',           'Retention payable (AP, p2)','liability', 'credit', true,
     (select id from public.gl_accounts where code = '2000'), 60)
on conflict (code) do nothing;

-- Equity (credit-normal leaves).
insert into public.gl_accounts (code, name_th, name_en, account_type, normal_side, is_postable, parent_id, sort_order)
values
  ('3100', 'ทุนจดทะเบียน', 'Owner capital',      'equity', 'credit', true,
     (select id from public.gl_accounts where code = '3000'), 10),
  ('3200', 'กำไรสะสม',     'Retained earnings',  'equity', 'credit', true,
     (select id from public.gl_accounts where code = '3000'), 20)
on conflict (code) do nothing;

-- Income (credit-normal leaf).
insert into public.gl_accounts (code, name_th, name_en, account_type, normal_side, is_postable, parent_id, sort_order)
values
  ('4100', 'รายได้งานก่อสร้าง', 'Construction revenue', 'income', 'credit', true,
     (select id from public.gl_accounts where code = '4000'), 10)
on conflict (code) do nothing;

-- Cost & expense (debit-normal leaves; the WIP-relief / COGS targets).
insert into public.gl_accounts (code, name_th, name_en, account_type, normal_side, is_postable, parent_id, sort_order)
values
  ('5100', 'ต้นทุนงานก่อสร้าง-วัสดุ',         'COGS - materials', 'expense', 'debit', true,
     (select id from public.gl_accounts where code = '5000'), 10),
  ('5110', 'ต้นทุนงานก่อสร้าง-ค่าแรง',        'COGS - labor',     'expense', 'debit', true,
     (select id from public.gl_accounts where code = '5000'), 20),
  ('5120', 'ต้นทุนงานก่อสร้าง-ค่าแรง DC',     'COGS - DC',        'expense', 'debit', true,
     (select id from public.gl_accounts where code = '5000'), 30),
  ('5130', 'ต้นทุนงานก่อสร้าง-ค่าเช่าอุปกรณ์','COGS - equipment', 'expense', 'debit', true,
     (select id from public.gl_accounts where code = '5000'), 40)
on conflict (code) do nothing;

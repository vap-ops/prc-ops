begin;
select plan(30);

-- ============================================================================
-- Spec 266 / ADR 0073 — worker identity merge: DC → ช่าง. Pins the greenfield
-- rebuild: pay_type × employment_type replace worker_type + dc_arrangement; the
-- dc_payments → wage_payments rename (+ method enum + the three RPCs); the
-- labor_logs snapshot rename; the two dropped enums; a create_worker smoke test.
-- ============================================================================

insert into auth.users (id, email, raw_user_meta_data) values
  ('11111111-1111-1111-1111-111111110266', 'pm@merge.local', '{}'::jsonb),
  ('22222222-2222-2222-2222-222222220266', 'sa@merge.local', '{}'::jsonb);
update public.users set role = 'project_manager' where id = '11111111-1111-1111-1111-111111110266';
update public.users set role = 'site_admin'      where id = '22222222-2222-2222-2222-222222220266';

grant insert on _tap_buf to authenticated, anon;
grant select on _tap_buf to authenticated, anon;
grant usage  on sequence _tap_buf_ord_seq to authenticated, anon;

-- A. New orthogonal enums replace the old.
select has_type('public', 'pay_type', 'pay_type enum exists');
select has_type('public', 'employment_type', 'employment_type enum exists');
select enum_has_labels('public', 'pay_type', array['monthly', 'daily'], 'pay_type labels');
select enum_has_labels('public', 'employment_type', array['permanent', 'temporary'], 'employment_type labels');
select hasnt_type('public', 'worker_type', 'worker_type enum dropped');
select hasnt_type('public', 'dc_arrangement', 'dc_arrangement enum dropped');

-- B. workers — the two orthogonal fields; old columns gone; contractor_id kept.
select has_column('public', 'workers', 'pay_type', 'workers.pay_type');
select has_column('public', 'workers', 'employment_type', 'workers.employment_type');
select col_not_null('public', 'workers', 'pay_type', 'pay_type is NOT NULL');
select col_not_null('public', 'workers', 'employment_type', 'employment_type is NOT NULL');
select hasnt_column('public', 'workers', 'worker_type', 'workers.worker_type dropped');
select hasnt_column('public', 'workers', 'dc_arrangement', 'workers.dc_arrangement dropped');
select has_column('public', 'workers', 'contractor_id', 'workers.contractor_id kept (nullable, ADR 0073 §6)');

-- C. labor_logs snapshot rename.
select has_column('public', 'labor_logs', 'pay_type_snapshot', 'labor_logs.pay_type_snapshot');
select hasnt_column('public', 'labor_logs', 'worker_type_snapshot', 'worker_type_snapshot renamed away');
select hasnt_column('public', 'labor_logs', 'contractor_id_snapshot', 'contractor_id_snapshot dropped');

-- D. dc_payments → wage_payments (+ method enum). The hasnt_* assert the OLD
--    names are gone (do NOT let a global rename flip these to the new names).
select has_table('public', 'wage_payments', 'wage_payments exists');
select hasnt_table('public', 'dc_payments', 'dc_payments renamed away');
select has_type('public', 'wage_payment_method', 'wage_payment_method enum exists');
select hasnt_type('public', 'dc_payment_method', 'dc_payment_method renamed away');

-- E. RPC renames (hasnt_* assert the OLD RPC names are gone).
select has_function('public', 'record_wage_payment', 'record_wage_payment exists');
select hasnt_function('public', 'record_dc_payment', 'record_dc_payment gone');
select has_function('public', 'get_my_wage_payments', 'get_my_wage_payments exists');
select hasnt_function('public', 'get_my_dc_payments', 'get_my_dc_payments gone');
select has_function('public', 'post_wage_payment_to_gl', 'post_wage_payment_to_gl exists');
select hasnt_function('public', 'post_dc_payment_to_gl', 'post_dc_payment_to_gl gone');

-- F. authenticated may read the two new (non-money) fields.
select ok(
  has_column_privilege('authenticated', 'public.workers', 'pay_type', 'SELECT'),
  'authenticated may SELECT workers.pay_type');

-- G. create_worker (new signature) builds a ช่าง with the two orthogonal fields.
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "11111111-1111-1111-1111-111111110266"}';
select lives_ok(
  $$ select public.create_worker('ช่าง เอ', 'daily', 'temporary', 400) $$,
  'create_worker(name, daily, temporary, rate) succeeds for back-office');
reset role;
select is(
  (select pay_type::text from public.workers where name = 'ช่าง เอ'),
  'daily', 'created worker pay_type = daily');
select is(
  (select employment_type::text from public.workers where name = 'ช่าง เอ'),
  'temporary', 'created worker employment_type = temporary');

select * from finish();
rollback;

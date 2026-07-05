-- Data-architecture hardening (rank 5): pin that the worker/labor mutation
-- RPCs are EXECUTE-able by authenticated only, never anon/PUBLIC
-- (20260625000200). Catches a future DROP+CREATE that silently resets the
-- grant back to the PUBLIC default.
-- ADR 0073 (spec 266): create_worker/update_worker signatures changed to
-- pay_type + employment_type; the lockdown is re-applied for the new sigs here.

begin;
select plan(10);

-- anon must NOT have execute on any of the five.
select is(
  has_function_privilege('anon',
    'public.log_labor_day(uuid, uuid, date, public.day_fraction, text)', 'EXECUTE'),
  false, 'anon cannot execute log_labor_day');
select is(
  has_function_privilege('anon',
    'public.correct_labor_log(uuid, text, public.day_fraction, boolean, text)', 'EXECUTE'),
  false, 'anon cannot execute correct_labor_log');
select is(
  has_function_privilege('anon',
    'public.create_worker(text, public.pay_type, public.employment_type, numeric, uuid, uuid, text, text, text, text, text, text)', 'EXECUTE'),
  false, 'anon cannot execute create_worker');
select is(
  has_function_privilege('anon',
    'public.update_worker(uuid, text, boolean, public.pay_type, public.employment_type, uuid, text, text, text, text, text, text)', 'EXECUTE'),
  false, 'anon cannot execute update_worker');
select is(
  has_function_privilege('anon',
    'public.set_worker_day_rate(uuid, numeric)', 'EXECUTE'),
  false, 'anon cannot execute set_worker_day_rate');

-- authenticated MUST retain execute (the app's call path).
select is(
  has_function_privilege('authenticated',
    'public.log_labor_day(uuid, uuid, date, public.day_fraction, text)', 'EXECUTE'),
  true, 'authenticated can execute log_labor_day');
select is(
  has_function_privilege('authenticated',
    'public.correct_labor_log(uuid, text, public.day_fraction, boolean, text)', 'EXECUTE'),
  true, 'authenticated can execute correct_labor_log');
select is(
  has_function_privilege('authenticated',
    'public.create_worker(text, public.pay_type, public.employment_type, numeric, uuid, uuid, text, text, text, text, text, text)', 'EXECUTE'),
  true, 'authenticated can execute create_worker');
select is(
  has_function_privilege('authenticated',
    'public.update_worker(uuid, text, boolean, public.pay_type, public.employment_type, uuid, text, text, text, text, text, text)', 'EXECUTE'),
  true, 'authenticated can execute update_worker');
select is(
  has_function_privilege('authenticated',
    'public.set_worker_day_rate(uuid, numeric)', 'EXECUTE'),
  true, 'authenticated can execute set_worker_day_rate');

select * from finish();
rollback;

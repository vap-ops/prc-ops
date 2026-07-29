-- Spec 374 U2 — public_holidays: shape, read-only posture, seed properties.
-- Property asserts only (contains-key-dates + floor count) — never exact
-- equality on rows a future migration or operator request may extend
-- (the 119-item-catalog exact-string lesson).
begin;

-- Role-switch asserts below need the collector visible to `authenticated`
-- (the run-pgtap transform writes assertions into _tap_buf).
grant insert on _tap_buf to authenticated;
grant select on _tap_buf to authenticated;
grant usage on sequence _tap_buf_ord_seq to authenticated;

select plan(16);

-- 1) shape
select has_table('public', 'public_holidays', 'public_holidays exists');
select col_is_pk('public', 'public_holidays', 'holiday_date', 'holiday_date is the PK');
select col_not_null('public', 'public_holidays', 'name_th', 'name_th not null');

-- 2) RLS on, and the ONLY policy is the authenticated SELECT — no write
--    policy may ever appear (writes are migration-only by design).
select ok(
  (select relrowsecurity from pg_class where oid = 'public.public_holidays'::regclass),
  'RLS enabled'
);
select is(
  (select count(*)::int from pg_policy where polrelid = 'public.public_holidays'::regclass),
  1,
  'exactly one policy'
);
select is(
  (select polcmd::text from pg_policy where polrelid = 'public.public_holidays'::regclass),
  'r',
  'the single policy is SELECT-only'
);
-- polcmd alone would pass a policy rewritten `to public` — pin the role arm.
select is(
  (select polroles from pg_policy where polrelid = 'public.public_holidays'::regclass),
  array['authenticated'::regrole::oid],
  'the policy is scoped to authenticated, not public'
);

-- 3) grants: authenticated read yes / write no; anon nothing. Resolved
--    through role inheritance (has_table_privilege), not a catalog-view scan
--    that can lack the arm it is looking for.
select ok(
  has_table_privilege('authenticated', 'public.public_holidays', 'SELECT'),
  'authenticated may SELECT'
);
select ok(
  not has_table_privilege('authenticated', 'public.public_holidays', 'INSERT')
  and not has_table_privilege('authenticated', 'public.public_holidays', 'UPDATE')
  and not has_table_privilege('authenticated', 'public.public_holidays', 'DELETE'),
  'authenticated cannot write'
);
select ok(
  not has_table_privilege('anon', 'public.public_holidays', 'SELECT')
  and not has_table_privilege('anon', 'public.public_holidays', 'INSERT')
  and not has_table_privilege('anon', 'public.public_holidays', 'UPDATE')
  and not has_table_privilege('anon', 'public.public_holidays', 'DELETE'),
  'anon can neither read nor write'
);

-- 3b) POSITIVE control: a real authenticated session actually receives rows —
--     without this, a grant/policy combination that returns zero rows to every
--     user reads as "safe" (the absence-assert-needs-a-positive-control rule).
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "00000000-0000-0000-0000-000000000001"}';
select ok(
  (select count(*) from public.public_holidays) > 0,
  'authenticated actually reads holiday rows'
);
reset role;

-- 4) seed properties: the two dates that motivated the spec + the full 2026
--    government-calendar floor. Writes are migration-only (no UI), so the
--    tight floor cannot be tripped by an operator edit — a deliberate future
--    migration that changes the list updates this file alongside.
select ok(
  exists (select 1 from public.public_holidays where holiday_date = '2026-07-28'),
  'seed contains 2026-07-28 (ร.10 birthday — the day the gap was found)'
);
select ok(
  exists (select 1 from public.public_holidays where holiday_date = '2026-07-29'),
  'seed contains 2026-07-29 (อาสาฬหบูชา — worked live the day U2 shipped)'
);
select ok(
  (select count(*) from public.public_holidays
    where holiday_date >= '2026-01-01' and holiday_date < '2027-01-01') >= 23,
  'the full 2026 seed is present (23 rows)'
);
-- Substitution days travel as PAIRS with the weekend holiday they observe.
select ok(
  exists (select 1 from public.public_holidays where holiday_date = '2026-05-31')
  and exists (select 1 from public.public_holidays where holiday_date = '2026-06-01'),
  'Visakha Bucha (Sun) + its ชดเชย Monday both seeded'
);
select ok(
  exists (select 1 from public.public_holidays where holiday_date = '2026-12-05')
  and exists (select 1 from public.public_holidays where holiday_date = '2026-12-07'),
  'Father''s Day (Sat) + its ชดเชย Monday both seeded'
);

select * from finish();

rollback;

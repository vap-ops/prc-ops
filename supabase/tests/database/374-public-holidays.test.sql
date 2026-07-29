-- Spec 374 U2 — public_holidays: shape, read-only posture, seed properties.
-- Property asserts only (contains-key-dates + floor count) — never exact
-- equality on rows a future migration or operator request may extend
-- (the 119-item-catalog exact-string lesson).
begin;

select plan(11);

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
  not has_table_privilege('anon', 'public.public_holidays', 'SELECT'),
  'anon cannot read'
);

-- 4) seed properties: the two dates that motivated the spec + a 2026 floor.
select ok(
  exists (select 1 from public.public_holidays where holiday_date = '2026-07-28'),
  'seed contains 2026-07-28 (ร.10 birthday — the day the gap was found)'
);
select ok(
  (select count(*) from public.public_holidays
    where holiday_date >= '2026-01-01' and holiday_date < '2027-01-01') >= 20,
  'at least 20 seeded 2026 holidays'
);

select * from finish();

rollback;

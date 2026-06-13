-- Data-architecture hardening (rank 3): pin that no public RLS policy calls
-- current_user_role() / auth.uid() BARE — all must be wrapped in a scalar
-- subselect so the planner evaluates them once per query, not per row
-- (20260625000600/000700/000800).
--
-- Detection: Postgres renders a wrapped call as "( SELECT current_user_role()
-- AS current_user_role)", so a literal-string check gives false positives. Use
-- regexp_count: a policy has a BARE call when the total count of the call
-- exceeds the count of its wrapped (SELECT-prefixed) form.
--
-- photo_markups is EXCEPTED: its INSERT policy self-references the table, and
-- wrapping either of its policies triggers 42P17 recursion (20260625000700/
-- 000800). It stays bare by design until the tombstone check moves to a
-- SECURITY DEFINER helper.

begin;
select plan(2);

select is(
  (select count(*)::int from pg_policies
     where schemaname = 'public'
       and tablename <> 'photo_markups'
       and regexp_count(coalesce(qual, '') || ' ' || coalesce(with_check, ''),
                        'current_user_role\(', 1, 'i')
         > regexp_count(coalesce(qual, '') || ' ' || coalesce(with_check, ''),
                        'select\s+current_user_role\(', 1, 'i')),
  0, 'no public policy (except photo_markups) calls current_user_role() bare'
);

select is(
  (select count(*)::int from pg_policies
     where schemaname = 'public'
       and tablename <> 'photo_markups'
       and regexp_count(coalesce(qual, '') || ' ' || coalesce(with_check, ''),
                        'auth\.uid\(', 1, 'i')
         > regexp_count(coalesce(qual, '') || ' ' || coalesce(with_check, ''),
                        'select\s+auth\.uid\(', 1, 'i')),
  0, 'no public policy (except photo_markups) calls auth.uid() bare'
);

select * from finish();
rollback;

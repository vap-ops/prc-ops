-- Data-architecture hardening (rank 3) — the headline scale fix. Every RLS
-- policy called current_user_role() / auth.uid() BARE, so Postgres evaluated
-- them in the per-row Filter on every authenticated scan (verified via EXPLAIN:
-- "Filter: (current_user_role() = ANY (...))" on a labor_logs index scan). The
-- documented Supabase fix is to wrap each in a scalar subselect — (select f())
-- — which the planner hoists to a one-per-query InitPlan. Semantics are
-- identical (a scalar subquery returns the same value); only the evaluation
-- count changes, from O(rows) to O(1) on the app's most common operation.
--
-- Done programmatically from the authoritative pg_get_expr text (pg_policies)
-- rather than hand-reproducing ~100 policies, so there is zero transcription
-- risk: each policy's exact USING/WITH CHECK is re-issued with only the two
-- function calls wrapped. Public schema only (storage policies untouched —
-- lower traffic, separate blast radius). Idempotent: already-wrapped policies
-- are skipped. Atomic: any malformed ALTER rolls back the whole migration.

do $$
declare
  r record;
  v_using text;
  v_check text;
  v_sql   text;
  v_count integer := 0;
begin
  for r in
    select tablename, policyname, qual, with_check
      from pg_policies
     where schemaname = 'public'
       and (
         (qual ~ 'current_user_role\(\)|auth\.uid\(\)'
            and qual !~ 'select current_user_role|select auth\.uid')
         or (with_check ~ 'current_user_role\(\)|auth\.uid\(\)'
            and with_check !~ 'select current_user_role|select auth\.uid')
       )
  loop
    v_using := r.qual;
    v_check := r.with_check;

    if v_using is not null then
      v_using := regexp_replace(v_using, 'current_user_role\(\)',
                                '(select current_user_role())', 'g');
      v_using := regexp_replace(v_using, 'auth\.uid\(\)',
                                '(select auth.uid())', 'g');
    end if;
    if v_check is not null then
      v_check := regexp_replace(v_check, 'current_user_role\(\)',
                                '(select current_user_role())', 'g');
      v_check := regexp_replace(v_check, 'auth\.uid\(\)',
                                '(select auth.uid())', 'g');
    end if;

    v_sql := format('alter policy %I on public.%I', r.policyname, r.tablename);
    if v_using is not null then
      v_sql := v_sql || format(' using (%s)', v_using);
    end if;
    if v_check is not null then
      v_sql := v_sql || format(' with check (%s)', v_check);
    end if;

    execute v_sql;
    v_count := v_count + 1;
  end loop;

  raise notice 'rls_eval_once: wrapped % policies', v_count;
end;
$$;

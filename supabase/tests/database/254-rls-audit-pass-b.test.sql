begin;
select plan(11);

-- ============================================================================
-- rls-audit-2026-07 Pass B — null-safe SECURITY DEFINER role gates (F1).
--   T-F1a (behavioral): under a null-role JWT — an authenticated principal whose
--     sub has NO public.users row (roleless: the offboarded-token path) —
--     current_user_role() is NULL, so a null-unsafe gate falls through and OPENS.
--     After the fix each gate raises 42501. These FAIL on the pre-fix schema
--     (gl_trial_balance returned rows live; the money setters reached post-gate
--     errors) and pass after M-B1..M-B5.
--   T-F1b (structural invariant, durable): ZERO callable SECURITY DEFINER public
--     functions carry a null-unsafe role gate — a statement-level scan of prosrc
--     mirroring the audit's detector. A future DROP+CREATE that reintroduces a
--     bare `not in (...)` gate fails this immediately.
-- ============================================================================

grant insert on _tap_buf to authenticated;
grant select on _tap_buf to authenticated;
grant usage  on sequence _tap_buf_ord_seq to authenticated;

-- The roleless principal: a sub with NO row in public.users. current_user_role()
-- resolves to NULL (per the audit's F1 reachability path).
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "7fffffff-ffff-4fff-8fff-ffffffffffff"}';

-- Guard: prove the fixture really is roleless (nothing up our sleeve).
select is(
  (select public.current_user_role()),
  null,
  'the test JWT sub maps to a NULL role (roleless principal)');

-- T-F1a — six representative gates across money READ, price, bank-payout,
-- accounting, and reconciliation. All must fail closed.
select throws_ok(
  $$ select * from public.gl_trial_balance('2026-01-01'::date, '2026-12-31'::date) $$,
  '42501', null, 'F1: gl_trial_balance denies a null-role caller');

select throws_ok(
  $$ select public.set_item_sell_rate('dddddddd-dddd-4ddd-8ddd-dddddddddddd'::uuid, 10) $$,
  '42501', null, 'F1: set_item_sell_rate denies a null-role caller');

select throws_ok(
  $$ select public.record_wage_payment('dddddddd-dddd-4ddd-8ddd-dddddddddddd'::uuid,
       current_date, current_date, 100, current_date, 'bank_transfer', null, null) $$,
  '42501', null, 'F1: record_wage_payment denies a null-role caller (wrapper gate)');

select throws_ok(
  $$ select public.decide_worker_bank_change('dddddddd-dddd-4ddd-8ddd-dddddddddddd'::uuid, true) $$,
  '42501', null, 'F1: decide_worker_bank_change denies a null-role caller (wrapper gate)');

select throws_ok(
  $$ select public.open_accounting_period(current_date) $$,
  '42501', null, 'F1: open_accounting_period denies a null-role caller');

select throws_ok(
  $$ select * from public.gl_reconciliation() $$,
  '42501', null, 'F1: gl_reconciliation denies a null-role caller');

reset role;

-- T-F1a extra — the wrapper helpers are null-safe at the root (F1 root fix).
select is(public.is_back_office(null::user_role), false, 'F1: is_back_office(null) = false');
select is(public.is_manager(null::user_role),     false, 'F1: is_manager(null) = false');
select is(public.is_site_staff(null::user_role),  false, 'F1: is_site_staff(null) = false');

-- T-F1b — structural invariant. Split each callable definer function's prosrc
-- into statements (whitespace-normalised, on ';'); a statement is a null-unsafe
-- gate when it names a role literal, lacks a null/coalesce guard, and matches a
-- gate shape (bare/var not-in, <>/!= a role, not(role in ...), := role in (...),
-- not(role = any ...), or (select role) = 'super_admin'/'project_director').
select is(
  (
    with stmts as (
      select p.oid,
             unnest(string_to_array(regexp_replace(p.prosrc, '\s+', ' ', 'g'), ';')) as stmt
        from pg_proc p
        join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public'
         and p.prosecdef
         and p.prorettype <> 'pg_catalog.trigger'::regtype
    )
    select count(*)::int from stmts
     where stmt !~* 'is null|is distinct from|coalesce'
       and stmt ~* '''(site_admin|project_manager|super_admin|project_director|procurement|accounting|hr|technician|subcon_manager|visitor|client|contractor)''(''|,|\)| )'
       and (
            stmt ~* '(current_user_role\(\)(::text)?|\mv_\w+)\s+not\s+in\s*\('
         or stmt ~* '(current_user_role\(\)(::text)?|\mv_\w+)\s*(<>|!=)\s*''(site_admin|project_manager|super_admin|project_director|procurement|accounting|visitor|client|contractor)'''
         or stmt ~* 'not\s*\(\s*((public\.)?current_user_role\(\)(::text)?|\mv_\w+)\s+in\s*\('
         or stmt ~* ':=\s*(public\.)?current_user_role\(\)\s*(::text)?\s+in\s*\('
         or stmt ~* 'not\s*\(\s*((public\.)?current_user_role\(\)(::text)?|\mv_\w+)\s*=\s*any'
         or stmt ~* '\(\s*select\s+(public\.)?current_user_role\(\)\s*\)\s*=\s*''(super_admin|project_director)'''
       )
  ),
  0,
  'F1: no callable SECURITY DEFINER public function has a null-unsafe role gate');

select * from finish();
rollback;

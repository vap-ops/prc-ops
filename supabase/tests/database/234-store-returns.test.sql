begin;
select plan(16);

-- ============================================================================
-- Spec 209 U1 — WP→store RETURN (distinct from the mistake-undo). A return is a
-- real, PARTIAL, repeatable movement of issued material back to the store, at the
-- ISSUE cost. return_stock_to_store (SITE_STAFF + member) records it, rolls
-- stock_on_hand, and enqueues Dr 1500 / Cr 1400. wp_profit nets returns out of the
-- WP's store-transfer material term. Cannot return more than issued (net of prior
-- returns), nor return a reversed (voided) issue.
-- ============================================================================

insert into auth.users (id, email, raw_user_meta_data) values
  ('51510000-0000-0000-0000-000000000234', 'sa@ret.local',    '{}'::jsonb),
  ('13130000-0000-0000-0000-000000000234', 'proc@ret.local',  '{}'::jsonb),
  ('19190000-0000-0000-0000-000000000234', 'super@ret.local', '{}'::jsonb);
update public.users set role='site_admin'  where id='51510000-0000-0000-0000-000000000234';
update public.users set role='procurement' where id='13130000-0000-0000-0000-000000000234';
update public.users set role='super_admin' where id='19190000-0000-0000-0000-000000000234';

insert into public.projects (id, code, name) values
  ('a2340000-0000-0000-0000-000000000234', 'RET-234', 'store returns 234');
insert into public.work_packages (id, project_id, code, name) values
  ('c2340000-0000-0000-0000-000000000234', 'a2340000-0000-0000-0000-000000000234', 'WP-234', 'wp 234');
insert into public.catalog_items (id, category, base_item, unit, is_active) values
  ('e2340000-0000-0000-0000-000000000234', 'steel_fixing', 'เหล็ก 234', 'เส้น', true);
insert into public.project_members (project_id, user_id, added_by) values
  ('a2340000-0000-0000-0000-000000000234', '51510000-0000-0000-0000-000000000234',
   '19190000-0000-0000-0000-000000000234');
-- on-hand 100 @ avg 10; issue1 (10) to reverse-FROM via returns; issue2 (5) to be voided.
insert into public.stock_on_hand (project_id, catalog_item_id, qty_on_hand, total_value) values
  ('a2340000-0000-0000-0000-000000000234', 'e2340000-0000-0000-0000-000000000234', 100, 1000);
insert into public.stock_issues (id, project_id, catalog_item_id, work_package_id, qty, unit, unit_cost) values
  ('12340000-0000-0000-0000-000000000234', 'a2340000-0000-0000-0000-000000000234',
   'e2340000-0000-0000-0000-000000000234', 'c2340000-0000-0000-0000-000000000234', 10, 'เส้น', 10),
  ('12340000-0000-0000-0000-0000000002b2', 'a2340000-0000-0000-0000-000000000234',
   'e2340000-0000-0000-0000-000000000234', 'c2340000-0000-0000-0000-000000000234', 5, 'เส้น', 10);

grant insert on _tap_buf to authenticated;
grant select on _tap_buf to authenticated;
grant usage  on sequence _tap_buf_ord_seq to authenticated;

-- A. Structure.
select has_table('public', 'stock_returns', 'stock_returns table exists');
select is((select relrowsecurity from pg_class where oid='public.stock_returns'::regclass),
  true, 'RLS enabled on stock_returns');
select ok(to_regprocedure('public.return_stock_to_store(uuid, numeric, text)') is not null,
  'return_stock_to_store exists');
select ok(to_regprocedure('public.post_stock_return_to_gl(uuid)') is not null,
  'post_stock_return_to_gl exists');
select is(has_function_privilege('anon', 'public.return_stock_to_store(uuid, numeric, text)', 'EXECUTE'),
  false, 'anon cannot execute return_stock_to_store');

set local role authenticated;

-- B. site_admin member returns 4 of the 10 issued → row + on-hand +4 (100→104).
set local "request.jwt.claims" = '{"sub": "51510000-0000-0000-0000-000000000234"}';
select isnt(
  (select public.return_stock_to_store('12340000-0000-0000-0000-000000000234', 4, 'เหลือคืน')),
  null, 'site_admin returns 4 — returns id');
select is(
  (select qty from public.stock_returns where issue_id='12340000-0000-0000-0000-000000000234'),
  4::numeric, 'stock_returns row qty = 4');
select is(
  (select qty_on_hand from public.stock_on_hand
     where project_id='a2340000-0000-0000-0000-000000000234'
       and catalog_item_id='e2340000-0000-0000-0000-000000000234'),
  104::numeric, 'on-hand 100 → 104 after the return (re-entered at issue cost)');

-- C. wp_profit nets the return: store term 100 (10*10) − 4*10 = 60. No budget → profit NULL.
set local "request.jwt.claims" = '{"sub": "19190000-0000-0000-0000-000000000234"}';
select is(
  (select materials_cost from public.wp_profit('c2340000-0000-0000-0000-000000000234')),
  60::numeric, 'wp_profit materials nets the partial return (100 − 40 = 60)');

-- D. Guards (back as site_admin).
set local "request.jwt.claims" = '{"sub": "51510000-0000-0000-0000-000000000234"}';
select throws_ok(
  $$ select public.return_stock_to_store('12340000-0000-0000-0000-000000000234', 7, null) $$,
  '22023', null, 'cannot return more than issued − returned (4+7 > 10) → 22023');
select isnt(
  (select public.return_stock_to_store('12340000-0000-0000-0000-000000000234', 6, null)),
  null, 'a second partial return is allowed up to the issued qty (4+6 = 10)');
select throws_ok(
  $$ select public.return_stock_to_store('12340000-0000-0000-0000-000000000234', 1, null) $$,
  '22023', null, 'nothing left to return once fully returned (10/10) → 22023');

-- E. Cannot return a reversed (voided) issue: void issue2, then a return is blocked.
select isnt(
  (select public.reverse_stock_issue('12340000-0000-0000-0000-0000000002b2', null)),
  null, 'issue2 voided via the mistake-undo');
select throws_ok(
  $$ select public.return_stock_to_store('12340000-0000-0000-0000-0000000002b2', 1, null) $$,
  '22023', null, 'a return on a reversed issue is blocked → 22023');

-- F. Role denial: procurement (not site-staff custody) cannot return.
set local "request.jwt.claims" = '{"sub": "13130000-0000-0000-0000-000000000234"}';
select throws_ok(
  $$ select public.return_stock_to_store('12340000-0000-0000-0000-000000000234', 1, null) $$,
  '42501', null, 'procurement cannot return (site-staff custody only) → 42501');

reset role;

-- G. GL: post the first return (qty 4 @ 10 = 40) → Dr 1500 40 / Cr 1400 40 (the
--    inverse of the issue). Posted synchronously (the poster is VOLATILE).
do $$
declare v_rid uuid;
begin
  select id into v_rid from public.stock_returns
    where issue_id='12340000-0000-0000-0000-000000000234' and qty=4 limit 1;
  perform public.post_stock_return_to_gl(v_rid);
end $$;
select is(
  (select coalesce(sum(jl.debit),0) from public.journal_lines jl
     join public.gl_accounts a on a.id=jl.account_id
     join public.journal_entries e on e.id=jl.entry_id
    where a.code='1500' and e.source_table='stock_returns' and e.status='posted'
      and e.source_id=(select id from public.stock_returns
                         where issue_id='12340000-0000-0000-0000-000000000234' and qty=4 limit 1)),
  40::numeric, 'return books Dr 1500 Inventory = 40 (qty 4 × issue cost 10)');
select is(
  (select coalesce(sum(jl.credit),0) from public.journal_lines jl
     join public.gl_accounts a on a.id=jl.account_id
     join public.journal_entries e on e.id=jl.entry_id
    where a.code='1400' and jl.work_package_id='c2340000-0000-0000-0000-000000000234'
      and e.source_table='stock_returns' and e.status='posted'
      and e.source_id=(select id from public.stock_returns
                         where issue_id='12340000-0000-0000-0000-000000000234' and qty=4 limit 1)),
  40::numeric, 'return books Cr 1400 WP-WIP = 40 (cost off the WP, back to the store)');

select * from finish();
rollback;

begin;
select plan(25);

-- ============================================================================
-- Spec 344 U1 — merge_catalog_items(p_keep, p_drop).
--
-- The spec-208 U5 store-first backfill minted a fresh catalog item per free-text
-- purchase_requests.item_description instead of matching the structured row that
-- already existed, leaving 27 duplicate pairs live (2026-07-23). The exact-string
-- catalog_items_identity_uniq cannot see them: `เหล็กเส้นกลมRB` + `6 มิล 10 เมตร`
-- and `เหล็กเส้นกลมRB 6 มิล 10 เมตร` + null hash to different keys.
--
-- A merge CANNOT repoint the ledger. stock_receipts/returns/reversals/counts
-- carry BEFORE DELETE OR UPDATE triggers raising P0001 ("append-only, correct via
-- reversal, never mutate"); stock_issues freezes catalog_item_id by name; a
-- purchase_requests UPDATE fires GL-posting and notification triggers. So this is
-- a FOLD-AND-RETIRE: the operational balance moves, the historical record does
-- not, and `merged_into` is what lets a reader put them back together.
--
-- Assertion 21 pins the ledger staying put ON PURPOSE — a future "improvement"
-- that repoints stock_receipts must red here rather than discover the trigger in
-- production.
-- ============================================================================

insert into auth.users (id, email, raw_user_meta_data) values
  ('11111111-1111-1111-1111-000000034410', 'proc@d344.local',     '{}'::jsonb),
  ('22222222-2222-2222-2222-000000034410', 'procmgr@d344.local',  '{}'::jsonb),
  ('33333333-3333-3333-3333-000000034410', 'super@d344.local',    '{}'::jsonb);
update public.users set role='procurement',         full_name='จัดซื้อ'          where id='11111111-1111-1111-1111-000000034410';
update public.users set role='procurement_manager', full_name='หัวหน้าฝ่ายจัดซื้อ' where id='22222222-2222-2222-2222-000000034410';
update public.users set role='super_admin',         full_name='ผู้ดูแลระบบ'       where id='33333333-3333-3333-3333-000000034410';

insert into public.projects (id, code, name) values
  ('aa000000-0000-0000-0000-000000034410', 'D344-A', 'โครงการทดสอบรวมรายการ ก'),
  ('bb000000-0000-0000-0000-000000034410', 'D344-B', 'โครงการทดสอบรวมรายการ ข');

insert into public.catalog_categories (id, code, name) values
  ('cc000000-0000-0000-0000-000000034410', '97', 'หมวดทดสอบ 344');

--   KEEP = the structured row the add form produces
--   DROP = the flat backfill row (spec baked into the name, spec_attrs null)
--   OPEN = a second flat row still named by a non-terminal purchase_request
--   ASM  = an unrelated item used as an assembly parent
insert into public.catalog_items (id, category_id, base_item, spec_attrs, unit) values
  ('11000000-0000-0000-0000-000000034410', 'cc000000-0000-0000-0000-000000034410', 'ทดสอบ344เหล็กกลม', '6 มิล 10 เมตร', 'เส้น'),
  ('22000000-0000-0000-0000-000000034410', 'cc000000-0000-0000-0000-000000034410', 'ทดสอบ344เหล็กกลม 6 มิล 10 เมตร', null, 'เส้น'),
  ('33000000-0000-0000-0000-000000034410', 'cc000000-0000-0000-0000-000000034410', 'ทดสอบ344เหล็กกลม 9 มิล 10 เมตร', null, 'เส้น'),
  ('44000000-0000-0000-0000-000000034410', 'cc000000-0000-0000-0000-000000034410', 'ทดสอบ344ชุดประกอบ', null, 'ชุด');

insert into public.catalog_item_categories (catalog_item_id, category_id, is_primary) values
  ('11000000-0000-0000-0000-000000034410', 'cc000000-0000-0000-0000-000000034410', true),
  ('22000000-0000-0000-0000-000000034410', 'cc000000-0000-0000-0000-000000034410', true);

-- Project A stocks BOTH sides (the fold); project B stocks only the loser (the move).
insert into public.stock_on_hand (project_id, catalog_item_id, qty_on_hand, total_value) values
  ('aa000000-0000-0000-0000-000000034410', '11000000-0000-0000-0000-000000034410', 158, 6478),
  ('aa000000-0000-0000-0000-000000034410', '22000000-0000-0000-0000-000000034410', 158, 6478),
  ('bb000000-0000-0000-0000-000000034410', '22000000-0000-0000-0000-000000034410',  40, 1600);

-- The immutable record the merge must NOT touch.
insert into public.stock_receipts (id, project_id, catalog_item_id, qty, unit, unit_cost) values
  ('e1000000-0000-0000-0000-000000034410', 'aa000000-0000-0000-0000-000000034410',
   '22000000-0000-0000-0000-000000034410', 158, 'เส้น', 41);

-- A delivered PR on the loser is fine; an open one on OPEN is the N3b refusal.
insert into public.purchase_requests (id, project_id, catalog_item_id, item_description, quantity, unit, status, requested_by) values
  ('d1000000-0000-0000-0000-000000034410', 'aa000000-0000-0000-0000-000000034410',
   '22000000-0000-0000-0000-000000034410', 'ทดสอบ344 เหล็กกลม 6 มิล', 158, 'เส้น', 'delivered',
   '11111111-1111-1111-1111-000000034410'),
  ('d2000000-0000-0000-0000-000000034410', 'aa000000-0000-0000-0000-000000034410',
   '33000000-0000-0000-0000-000000034410', 'ทดสอบ344 เหล็กกลม 9 มิล',  64, 'เส้น', 'approved',
   '11111111-1111-1111-1111-000000034410');

-- One plan holds BOTH sides at the same identity (collision → the loser's line is
-- dropped); the other holds only the loser (free → repointed).
insert into public.supply_plans (id, project_id) values
  ('50000000-0000-0000-0000-000000034410', 'aa000000-0000-0000-0000-000000034410'),
  ('60000000-0000-0000-0000-000000034410', 'bb000000-0000-0000-0000-000000034410');
insert into public.supply_plan_lines (id, supply_plan_id, catalog_item_id, qty) values
  ('51000000-0000-0000-0000-000000034410', '50000000-0000-0000-0000-000000034410', '11000000-0000-0000-0000-000000034410', 10),
  ('52000000-0000-0000-0000-000000034410', '50000000-0000-0000-0000-000000034410', '22000000-0000-0000-0000-000000034410', 25),
  ('61000000-0000-0000-0000-000000034410', '60000000-0000-0000-0000-000000034410', '22000000-0000-0000-0000-000000034410', 12);

-- The keeper already has a sell rate, so the loser's must lose and be deleted.
insert into public.item_sell_rates (catalog_item_id, sell_rate) values
  ('11000000-0000-0000-0000-000000034410', 55),
  ('22000000-0000-0000-0000-000000034410', 99);

insert into public.boq_template (id, code, name) values
  ('70000000-0000-0000-0000-000000034410', 'D344-TPL', 'แม่แบบทดสอบ 344');
insert into public.boq_line (id, boq_template_id, catalog_item_id, description, qty, unit) values
  ('71000000-0000-0000-0000-000000034410', '70000000-0000-0000-0000-000000034410',
   '22000000-0000-0000-0000-000000034410', 'เหล็กเส้นกลม 6 มิล', 3, 'เส้น');

-- cac_unique_component (assembly_id, component_item_id) makes BOTH repoints
-- collide-able, and the two items sitting on opposite ends of one assembly would
-- mint a (keep, keep) row meaning "contains itself".
insert into public.catalog_assembly_components (assembly_id, component_item_id, qty_per) values
  ('44000000-0000-0000-0000-000000034410', '22000000-0000-0000-0000-000000034410', 2),  -- collides…
  ('44000000-0000-0000-0000-000000034410', '11000000-0000-0000-0000-000000034410', 3),  -- …with this
  ('22000000-0000-0000-0000-000000034410', '44000000-0000-0000-0000-000000034410', 1),  -- assembly side
  ('22000000-0000-0000-0000-000000034410', '11000000-0000-0000-0000-000000034410', 1);  -- → (keep, keep)

create temp table d344_before on commit drop as
  select coalesce(sum(total_value), 0) as v, coalesce(sum(qty_on_hand), 0) as q
    from public.stock_on_hand;

grant insert on _tap_buf to authenticated;
grant select on _tap_buf to authenticated;
grant usage  on sequence _tap_buf_ord_seq to authenticated;

-- ============================================================================
-- A. The gate — super_admin only. Merging moves inventory between catalog rows;
--    it is a repair tool, not a procurement affordance.
-- ============================================================================
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "11111111-1111-1111-1111-000000034410"}';

select throws_ok(
  $$select public.merge_catalog_items(
      '11000000-0000-0000-0000-000000034410','22000000-0000-0000-0000-000000034410')$$,
  '42501', 'merge_catalog_items: role not permitted',
  'procurement is refused the merge');

set local "request.jwt.claims" = '{"sub": "22222222-2222-2222-2222-000000034410"}';

select throws_ok(
  $$select public.merge_catalog_items(
      '11000000-0000-0000-0000-000000034410','22000000-0000-0000-0000-000000034410')$$,
  '42501', 'merge_catalog_items: role not permitted',
  'procurement_manager is refused too — curating the catalog is not repairing it');

-- ============================================================================
-- B. As super_admin — the refusals that come before any write.
-- ============================================================================
set local "request.jwt.claims" = '{"sub": "33333333-3333-3333-3333-000000034410"}';

select throws_ok(
  $$select public.merge_catalog_items(
      '11000000-0000-0000-0000-000000034410','11000000-0000-0000-0000-000000034410')$$,
  '22023', 'merge_catalog_items: keep and drop must differ',
  'an item cannot be merged into itself');

select throws_ok(
  $$select public.merge_catalog_items(
      '11000000-0000-0000-0000-000000034410','99000000-0000-0000-0000-000000034499')$$,
  '22023', 'merge_catalog_items: item not found',
  'an unknown id is refused, not silently ignored');

select throws_ok(
  $$select public.merge_catalog_items(
      '11000000-0000-0000-0000-000000034410','33000000-0000-0000-0000-000000034410')$$,
  '22023', 'merge_catalog_items: drop item still has open purchase requests',
  'a loser still named by a non-terminal purchase request is refused');

-- ============================================================================
-- C. The merge itself.
-- ============================================================================
select lives_ok(
  $$select public.merge_catalog_items(
      '11000000-0000-0000-0000-000000034410','22000000-0000-0000-0000-000000034410')$$,
  'super_admin merges the flat backfill row into the structured one');

select throws_ok(
  $$select public.merge_catalog_items(
      '11000000-0000-0000-0000-000000034410','22000000-0000-0000-0000-000000034410')$$,
  '22023', 'merge_catalog_items: drop item is already retired',
  'merging the same pair twice is refused rather than folding the balance again');

reset role;

select is(
  (select qty_on_hand from public.stock_on_hand
    where project_id='aa000000-0000-0000-0000-000000034410'
      and catalog_item_id='11000000-0000-0000-0000-000000034410'),
  316::numeric,
  'both sides stocked project A, so the keeper carries the SUM (158+158)');

select is(
  (select total_value from public.stock_on_hand
    where project_id='aa000000-0000-0000-0000-000000034410'
      and catalog_item_id='11000000-0000-0000-0000-000000034410'),
  12956::numeric,
  'value sums with the quantity — the operator ruled these are two real deliveries');

select is(
  (select qty_on_hand from public.stock_on_hand
    where project_id='bb000000-0000-0000-0000-000000034410'
      and catalog_item_id='11000000-0000-0000-0000-000000034410'),
  40::numeric,
  'a project only the loser stocked moves wholesale to the keeper');

select is(
  (select count(*) from public.stock_on_hand
    where catalog_item_id='22000000-0000-0000-0000-000000034410'),
  0::bigint,
  'the loser holds no balance anywhere afterwards');

select ok(
  (select coalesce(sum(total_value),0) = (select v from d344_before)
      and coalesce(sum(qty_on_hand),0) = (select q from d344_before)
     from public.stock_on_hand),
  'global on-hand quantity and value are unchanged — the inventory_1500 tie stays green');

select is(
  (select catalog_item_id from public.supply_plan_lines
    where id='61000000-0000-0000-0000-000000034410'),
  '11000000-0000-0000-0000-000000034410'::uuid,
  'a plan line with no competing identity is repointed to the keeper');

select is(
  (select count(*) from public.supply_plan_lines
    where supply_plan_id='50000000-0000-0000-0000-000000034410'),
  1::bigint,
  'where the keeper already held that plan identity the loser line is dropped, not duplicated');

select is(
  (select sell_rate from public.item_sell_rates
    where catalog_item_id='11000000-0000-0000-0000-000000034410'),
  55::numeric,
  'the keeper keeps its own sell rate');

select is(
  (select count(*) from public.item_sell_rates
    where catalog_item_id='22000000-0000-0000-0000-000000034410'),
  0::bigint,
  'the loser sell rate is removed rather than left orphaned');

select is(
  (select catalog_item_id from public.boq_line
    where id='71000000-0000-0000-0000-000000034410'),
  '11000000-0000-0000-0000-000000034410'::uuid,
  'BOQ template lines follow the keeper');

select is(
  (select string_agg(component_item_id::text, ',') from public.catalog_assembly_components
    where assembly_id='44000000-0000-0000-0000-000000034410'),
  '11000000-0000-0000-0000-000000034410',
  'assembly components follow the keeper, and the duplicate component row is dropped not 23505d');

select is(
  (select assembly_id from public.catalog_assembly_components
    where component_item_id='44000000-0000-0000-0000-000000034410'),
  '11000000-0000-0000-0000-000000034410'::uuid,
  'the assembly SIDE repoints too — the first cut only deduped the component side');

select is(
  (select count(*) from public.catalog_assembly_components
    where assembly_id='11000000-0000-0000-0000-000000034410'
      and component_item_id='11000000-0000-0000-0000-000000034410'),
  0::bigint,
  'merging the two ends of one assembly never mints a "contains itself" row');

select is(
  (select count(*) from public.catalog_item_categories
    where catalog_item_id='22000000-0000-0000-0000-000000034410'),
  0::bigint,
  'the loser category memberships are dropped (one_primary would reject a repoint)');

select is(
  (select is_active from public.catalog_items
    where id='22000000-0000-0000-0000-000000034410'),
  false,
  'the loser is retired, never hard-deleted');

select is(
  (select merged_into from public.catalog_items
    where id='22000000-0000-0000-0000-000000034410'),
  '11000000-0000-0000-0000-000000034410'::uuid,
  'merged_into records where the retired row went, so readers can union its history');

select is(
  (select catalog_item_id from public.stock_receipts
    where id='e1000000-0000-0000-0000-000000034410'),
  '22000000-0000-0000-0000-000000034410'::uuid,
  'the append-only ledger STILL points at the loser — history is not rewritten');

select is(
  (select count(*) from public.audit_log
    where target_table='catalog_items'
      and target_id='22000000-0000-0000-0000-000000034410'
      and action = 'other'
      and payload->>'event' = 'catalog_item_merged'
      and (payload->>'keep_id')::uuid = '11000000-0000-0000-0000-000000034410'),
  1::bigint,
  'one audit row names both sides of the merge');

select * from finish();
rollback;

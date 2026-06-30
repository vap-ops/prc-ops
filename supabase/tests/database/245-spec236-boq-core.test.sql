begin;
select plan(99);

-- ============================================================================
-- Spec 236 — BOQ estimate core (ADR 0066 / S10-U1, decision D6). The estimate
-- grain: boq_template (firm-wide reusable, D3) + boq_line with rates ON THE LINE
-- (material_rate/labor_rate). The THREE-GRAIN invariant: the catalog stays
-- price-free, boq_line is priced, supply_plan_lines stays qty-only. boq_line's
-- catalog_item_id is NULLABLE + a required free-text description (D1); status
-- enums boq_line_status (draft/frozen/superseded) + boq_variation_type
-- (standard/added/omitted/provisional_sum) + nullable exclusivity_group (D2).
-- Posture follows ADR 0066 D8 / spec 221 U2: grant SELECT to authenticated, NO
-- direct write/delete grant, writes via null-safe SECURITY DEFINER RPCs gated
-- pm/super/procurement/director (the catalog/material-side set — estimating is
-- procurement-adjacent, matching Relation R / spec 227).
-- ============================================================================

insert into auth.users (id, email, raw_user_meta_data) values
  ('33333333-3333-3333-3333-333333333236', 'pm@boq236.local',     '{}'::jsonb),
  ('77777777-7777-7777-7777-777777777236', 'proc@boq236.local',   '{}'::jsonb),
  ('44444444-4444-4444-4444-444444444236', 'vis@boq236.local',    '{}'::jsonb);
update public.users set role='project_manager' where id='33333333-3333-3333-3333-333333333236';
update public.users set role='procurement'     where id='77777777-7777-7777-7777-777777777236';
-- the visitor user keeps the default 'visitor' role from the auth.users trigger.
-- (sub 55555555-…-5236 is NEVER inserted → current_user_role() is null for it.)

grant insert on _tap_buf to authenticated;
grant select on _tap_buf to authenticated;
grant usage  on sequence _tap_buf_ord_seq to authenticated;

-- A. Structure — boq_template ------------------------------------------------
select has_table('public', 'boq_template', 'boq_template table exists');
select has_column('public', 'boq_template', 'id', 'boq_template has id');
select has_column('public', 'boq_template', 'code', 'boq_template has code');
select has_column('public', 'boq_template', 'name', 'boq_template has name');
select has_column('public', 'boq_template', 'description', 'boq_template has description');
select has_column('public', 'boq_template', 'is_active', 'boq_template has is_active');
select has_column('public', 'boq_template', 'sort_order', 'boq_template has sort_order');
select has_column('public', 'boq_template', 'created_by', 'boq_template has created_by');
select has_column('public', 'boq_template', 'created_at', 'boq_template has created_at');
select has_column('public', 'boq_template', 'updated_at', 'boq_template has updated_at');
select ok((select relrowsecurity from pg_class where oid='public.boq_template'::regclass),
  'RLS enabled on boq_template');
select ok(has_table_privilege('authenticated', 'public.boq_template', 'select'),
  'authenticated may SELECT boq_template');
select ok(not has_table_privilege('anon', 'public.boq_template', 'select'),
  'anon may NOT SELECT boq_template');
select ok(not has_table_privilege('authenticated', 'public.boq_template', 'delete'),
  'authenticated may NOT DELETE boq_template (deactivate-not-delete)');
select col_is_unique('public', 'boq_template', 'code', 'boq_template.code is unique (stable key)');

-- B. Structure — boq_line ----------------------------------------------------
select has_table('public', 'boq_line', 'boq_line table exists');
select has_column('public', 'boq_line', 'id', 'boq_line has id');
select has_column('public', 'boq_line', 'boq_template_id', 'boq_line has boq_template_id');
select has_column('public', 'boq_line', 'catalog_item_id', 'boq_line has catalog_item_id');
select has_column('public', 'boq_line', 'description', 'boq_line has description');
select has_column('public', 'boq_line', 'work_category_id', 'boq_line has work_category_id');
select has_column('public', 'boq_line', 'qty', 'boq_line has qty');
select has_column('public', 'boq_line', 'unit', 'boq_line has unit');
select has_column('public', 'boq_line', 'material_rate', 'boq_line has material_rate');
select has_column('public', 'boq_line', 'labor_rate', 'boq_line has labor_rate');
select has_column('public', 'boq_line', 'is_standard', 'boq_line has is_standard');
select has_column('public', 'boq_line', 'variation_type', 'boq_line has variation_type');
select has_column('public', 'boq_line', 'line_status', 'boq_line has line_status');
select has_column('public', 'boq_line', 'exclusivity_group', 'boq_line has exclusivity_group');
select has_column('public', 'boq_line', 'sort_order', 'boq_line has sort_order');
select has_column('public', 'boq_line', 'created_by', 'boq_line has created_by');
select has_column('public', 'boq_line', 'created_at', 'boq_line has created_at');
select has_column('public', 'boq_line', 'updated_at', 'boq_line has updated_at');
select ok((select relrowsecurity from pg_class where oid='public.boq_line'::regclass),
  'RLS enabled on boq_line');
select ok(has_table_privilege('authenticated', 'public.boq_line', 'select'),
  'authenticated may SELECT boq_line');
select ok(not has_table_privilege('anon', 'public.boq_line', 'select'),
  'anon may NOT SELECT boq_line');
select ok(not has_table_privilege('authenticated', 'public.boq_line', 'delete'),
  'authenticated may NOT DELETE boq_line (RPC-sole-writer)');
select col_is_null('public', 'boq_line', 'catalog_item_id',
  'boq_line.catalog_item_id is NULLABLE (D1 — estimate line need not be a catalog item)');
select col_not_null('public', 'boq_line', 'description',
  'boq_line.description is NOT NULL (D1 — required free-text label)');
select fk_ok('public', 'boq_line', 'boq_template_id', 'public', 'boq_template', 'id');
select fk_ok('public', 'boq_line', 'catalog_item_id', 'public', 'catalog_items', 'id');
select fk_ok('public', 'boq_line', 'work_category_id', 'public', 'work_categories', 'id');

-- C. Status enums (D2) -------------------------------------------------------
select is(
  (select array_agg(e.enumlabel::text order by e.enumsortorder)
     from pg_enum e where e.enumtypid = 'public.boq_line_status'::regtype),
  array['draft','frozen','superseded'],
  'boq_line_status enum = draft/frozen/superseded (D2)');
select is(
  (select array_agg(e.enumlabel::text order by e.enumsortorder)
     from pg_enum e where e.enumtypid = 'public.boq_variation_type'::regtype),
  array['standard','added','omitted','provisional_sum'],
  'boq_variation_type enum = standard/added/omitted/provisional_sum (D2)');

-- E. THREE-GRAIN INVARIANT (D6 headline) -------------------------------------
select has_column('public', 'boq_line', 'material_rate', '3-grain: boq_line IS priced (material_rate)');
select has_column('public', 'boq_line', 'labor_rate',    '3-grain: boq_line IS priced (labor_rate)');
select hasnt_column('public', 'catalog_items', 'material_rate',
  '3-grain: catalog stays PRICE-FREE (no material_rate)');
select hasnt_column('public', 'catalog_items', 'labor_rate',
  '3-grain: catalog stays PRICE-FREE (no labor_rate)');
select hasnt_column('public', 'supply_plan_lines', 'material_rate',
  '3-grain: supply_plan_lines stays QTY-ONLY (no material_rate)');
select hasnt_column('public', 'supply_plan_lines', 'labor_rate',
  '3-grain: supply_plan_lines stays QTY-ONLY (no labor_rate)');
select has_column('public', 'supply_plan_lines', 'qty', '3-grain: supply_plan_lines keeps qty');
select has_column('public', 'boq_line', 'qty', '3-grain: boq_line carries qty');

-- F. RPC posture — SECURITY DEFINER + anon revoked + authenticated execute ----
select is((select prosecdef from pg_proc
  where oid='public.create_boq_template(text,text,text)'::regprocedure),
  true, 'create_boq_template is SECURITY DEFINER');
select ok(not has_function_privilege('anon',
  'public.create_boq_template(text,text,text)', 'execute'),
  'anon may NOT execute create_boq_template');
select ok(has_function_privilege('authenticated',
  'public.create_boq_template(text,text,text)', 'execute'),
  'authenticated may execute create_boq_template');

select is((select prosecdef from pg_proc
  where oid='public.update_boq_template(uuid,text,text)'::regprocedure),
  true, 'update_boq_template is SECURITY DEFINER');
select ok(not has_function_privilege('anon',
  'public.update_boq_template(uuid,text,text)', 'execute'),
  'anon may NOT execute update_boq_template');
select ok(has_function_privilege('authenticated',
  'public.update_boq_template(uuid,text,text)', 'execute'),
  'authenticated may execute update_boq_template');

select is((select prosecdef from pg_proc
  where oid='public.set_boq_template_active(uuid,boolean)'::regprocedure),
  true, 'set_boq_template_active is SECURITY DEFINER');
select ok(not has_function_privilege('anon',
  'public.set_boq_template_active(uuid,boolean)', 'execute'),
  'anon may NOT execute set_boq_template_active');
select ok(has_function_privilege('authenticated',
  'public.set_boq_template_active(uuid,boolean)', 'execute'),
  'authenticated may execute set_boq_template_active');

select is((select prosecdef from pg_proc
  where oid='public.add_boq_line(uuid,text,numeric,text,uuid,uuid,numeric,numeric,boolean,boq_variation_type,text)'::regprocedure),
  true, 'add_boq_line is SECURITY DEFINER');
select ok(not has_function_privilege('anon',
  'public.add_boq_line(uuid,text,numeric,text,uuid,uuid,numeric,numeric,boolean,boq_variation_type,text)', 'execute'),
  'anon may NOT execute add_boq_line');
select ok(has_function_privilege('authenticated',
  'public.add_boq_line(uuid,text,numeric,text,uuid,uuid,numeric,numeric,boolean,boq_variation_type,text)', 'execute'),
  'authenticated may execute add_boq_line');

select is((select prosecdef from pg_proc
  where oid='public.update_boq_line(uuid,text,numeric,text,uuid,uuid,numeric,numeric,boolean,boq_variation_type,text)'::regprocedure),
  true, 'update_boq_line is SECURITY DEFINER');
select ok(not has_function_privilege('anon',
  'public.update_boq_line(uuid,text,numeric,text,uuid,uuid,numeric,numeric,boolean,boq_variation_type,text)', 'execute'),
  'anon may NOT execute update_boq_line');
select ok(has_function_privilege('authenticated',
  'public.update_boq_line(uuid,text,numeric,text,uuid,uuid,numeric,numeric,boolean,boq_variation_type,text)', 'execute'),
  'authenticated may execute update_boq_line');

select is((select prosecdef from pg_proc
  where oid='public.remove_boq_line(uuid)'::regprocedure),
  true, 'remove_boq_line is SECURITY DEFINER');
select ok(not has_function_privilege('anon',
  'public.remove_boq_line(uuid)', 'execute'),
  'anon may NOT execute remove_boq_line');
select ok(has_function_privilege('authenticated',
  'public.remove_boq_line(uuid)', 'execute'),
  'authenticated may execute remove_boq_line');

-- G. Behaviour as a back-office PM -------------------------------------------
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "33333333-3333-3333-3333-333333333236"}';

-- template CRUD
select lives_ok(
  $$ select public.create_boq_template('BT-TEST', 'ร้านมาตรฐาน 308 ตร.ม.', 'เทมเพลตทดสอบ') $$,
  'create_boq_template adds a reusable template');
select throws_ok(
  $$ select public.create_boq_template('BT-TEST', 'ซ้ำ', null) $$,
  '23505', null, 'a duplicate template code is rejected (23505)');
select throws_ok(
  $$ select public.create_boq_template('BT-X', '   ', null) $$,
  '22023', null, 'a blank template name is rejected (22023)');
select throws_ok(
  $$ select public.create_boq_template('   ', 'ชื่อ', null) $$,
  '22023', null, 'a blank template code is rejected (22023)');
select lives_ok(
  $$ select public.update_boq_template(
       (select id from public.boq_template where code='BT-TEST'), 'ร้านแก้ไข', 'desc2') $$,
  'update_boq_template renames the template');
select is(
  (select name from public.boq_template where code='BT-TEST'), 'ร้านแก้ไข',
  'the template rename applied');
select throws_ok(
  $$ select public.update_boq_template('00000000-0000-0000-0000-0000000000c3'::uuid, 'x', null) $$,
  '22023', null, 'updating an unknown template id is rejected (22023)');
select lives_ok(
  $$ select public.set_boq_template_active(
       (select id from public.boq_template where code='BT-TEST'), false) $$,
  'set_boq_template_active deactivates the template');
select is(
  (select is_active from public.boq_template where code='BT-TEST'), false,
  'the template is now inactive (deactivate-not-delete)');

-- line CRUD: a FREE-TEXT line (D1 — no catalog item), defaults draft/standard
select lives_ok(
  $$ select public.add_boq_line(
       (select id from public.boq_template where code='BT-TEST'),
       'งานเทพื้นคอนกรีต', 10, 'ตร.ม.',
       null, (select id from public.work_categories where code='W02'),
       250, 120) $$,
  'add_boq_line adds a free-text estimate line (nullable catalog_item_id, D1)');
select is(
  (select line_status from public.boq_line where description='งานเทพื้นคอนกรีต' limit 1), 'draft',
  'a new line defaults to line_status=draft (D2)');
select is(
  (select variation_type from public.boq_line where description='งานเทพื้นคอนกรีต' limit 1), 'standard',
  'a new line defaults to variation_type=standard (D2)');
select is(
  (select catalog_item_id from public.boq_line where description='งานเทพื้นคอนกรีต' limit 1), null,
  'the free-text line has a NULL catalog_item_id (D1)');
-- a line linked to a real catalog item + work category
select lives_ok(
  $$ select public.add_boq_line(
       (select id from public.boq_template where code='BT-TEST'),
       'งานติดตั้งโครงเหล็ก', 5, 'ชุด',
       (select id from public.catalog_items where is_active order by created_at limit 1),
       (select id from public.work_categories where code='W02'),
       1000, 500, true, 'added', 'ALT-A') $$,
  'add_boq_line links a catalog item + work-category + variation/exclusivity');
select throws_ok(
  $$ select public.add_boq_line('00000000-0000-0000-0000-0000000000c3'::uuid,
       'x', 1, 'ชุด') $$,
  '22023', null, 'adding a line to an unknown template is rejected (22023)');
select throws_ok(
  $$ select public.add_boq_line(
       (select id from public.boq_template where code='BT-TEST'), 'x', 0, 'ชุด') $$,
  '22023', null, 'a non-positive qty is rejected (22023)');
select throws_ok(
  $$ select public.add_boq_line(
       (select id from public.boq_template where code='BT-TEST'), '   ', 1, 'ชุด') $$,
  '22023', null, 'a blank description is rejected (22023)');
select throws_ok(
  $$ select public.add_boq_line(
       (select id from public.boq_template where code='BT-TEST'), 'x', 1, 'ชุด',
       null, null, -1, 0) $$,
  '22023', null, 'a negative material_rate is rejected (22023)');
select throws_ok(
  $$ select public.add_boq_line(
       (select id from public.boq_template where code='BT-TEST'), 'x', 1, 'ชุด',
       null, '00000000-0000-0000-0000-0000000000c1'::uuid) $$,
  '22023', null, 'an unknown work_category_id is rejected (22023)');
select throws_ok(
  $$ select public.add_boq_line(
       (select id from public.boq_template where code='BT-TEST'), 'x', 1, 'ชุด',
       '00000000-0000-0000-0000-0000000000c2'::uuid) $$,
  '22023', null, 'an unknown catalog_item_id is rejected (22023)');
select lives_ok(
  $$ select public.update_boq_line(
       (select id from public.boq_line where description='งานเทพื้นคอนกรีต' limit 1),
       'งานเทพื้นคอนกรีต', 12, 'ตร.ม.') $$,
  'update_boq_line edits a line');
select is(
  (select qty from public.boq_line where description='งานเทพื้นคอนกรีต' limit 1), 12::numeric,
  'the line qty was updated to 12');
select throws_ok(
  $$ select public.update_boq_line('00000000-0000-0000-0000-0000000000c4'::uuid, 'x', 1, 'ชุด') $$,
  '22023', null, 'updating an unknown line id is rejected (22023)');
select lives_ok(
  $$ select public.remove_boq_line(
       (select id from public.boq_line where description='งานเทพื้นคอนกรีต' limit 1)) $$,
  'remove_boq_line deletes a line');
select is(
  (select count(*)::int from public.boq_line where description='งานเทพื้นคอนกรีต'), 0,
  'the removed line is gone');
select throws_ok(
  $$ select public.remove_boq_line('00000000-0000-0000-0000-0000000000c5'::uuid) $$,
  '22023', null, 'removing an unknown line id is rejected (22023)');

-- H. Role gates --------------------------------------------------------------
-- null/unbound role → 42501 (null-safe gate).
set local "request.jwt.claims" = '{"sub": "55555555-5555-5555-5555-555555555236"}';
select throws_ok(
  $$ select public.create_boq_template('DENYNULL', 'x', null) $$,
  '42501', null, 'a null/unbound role cannot create a template (null-safe gate)');
-- visitor → 42501.
set local "request.jwt.claims" = '{"sub": "44444444-4444-4444-4444-444444444236"}';
select throws_ok(
  $$ select public.create_boq_template('DENYVIS', 'x', null) $$,
  '42501', null, 'a disallowed role (visitor) cannot create a template');
-- procurement IS admitted (the 4-role catalog/material-side set, ADR D8).
set local "request.jwt.claims" = '{"sub": "77777777-7777-7777-7777-777777777236"}';
select lives_ok(
  $$ select public.create_boq_template('BT-PROC', 'โดยฝ่ายจัดซื้อ', null) $$,
  'procurement may create a template (4-role set incl. procurement)');

reset role;
select * from finish();
rollback;

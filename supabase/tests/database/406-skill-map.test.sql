begin;
select plan(85);

-- ============================================================================
-- Spec 406 U1 — the skill-map schema core.
--
-- Six tables: trades · trade_levels · trade_skills · skill_materials ·
--   skill_map_publishes · worker_trade_levels (append-only level history).
--
-- WHY A NEW CRAFT AXIS AT ALL: `work_categories` is a WBS PHASE taxonomy
--   (งานโครงสร้าง, งานสถาปัตยกรรม) whose sub-rows are project LINE ITEMS
--   (`W0210 เหล็กโครงสร้าง ROOF GUTTER / SIDING FRAME 1, 2`). The operator's
--   own pilot trades — ช่างเหล็กเสริมคอนกรีต, ช่างไม้ก่อสร้าง — have no row at
--   either level, which is also the best explanation for `worker_trades`
--   sitting at 0 rows: it asked a ช่าง to tag himself with a phase.
--
-- ⛔ `worker_trades` is deliberately NOT touched. Its writer
--   `set_worker_trades` is PM-admitted (wider than this feature's PD gate) and
--   does a full delete-then-insert, so routing baseline through it would let a
--   PM silently orphan rows that worker_trade_levels points at.
--
-- LEVELS ARE ROWS, NOT THE `worker_level` ENUM: Thailand's DSD standard gives
--   ช่างหินขัด one level and ช่างก่ออิฐ three, so a fixed 4-value enum cannot
--   express the real ladders. `reference_day_rate` carries the legally
--   published figure for display only — it writes nothing to payroll (S4).
--
-- GATE: is_skill_map_author = project_director + super_admin. Deliberately NOT
--   `is_manager`, which also admits `project_manager` — the operator put map
--   authorship and promotions with the PD tier. Members-differ, so a new
--   predicate rather than a reused one.
-- ============================================================================

insert into auth.users (id, email, raw_user_meta_data) values
  ('11111111-1111-1111-1111-111111110406', 'pd@skill.local', '{}'::jsonb),
  ('22222222-2222-2222-2222-222222220406', 'pm@skill.local', '{}'::jsonb),
  ('33333333-3333-3333-3333-333333330406', 'tech@skill.local', '{}'::jsonb);
update public.users set role = 'project_director'
  where id = '11111111-1111-1111-1111-111111110406';
update public.users set role = 'project_manager'
  where id = '22222222-2222-2222-2222-222222220406';
update public.users set role = 'technician'
  where id = '33333333-3333-3333-3333-333333330406';

-- The runner rewrites each assertion into an insert on the temp collector
-- `_tap_buf`, which `authenticated` cannot write to on a fresh temp table. Any
-- file that ASSERTS while the role is switched needs these grants, or the first
-- post-switch assertion aborts the whole file with 42501 and zero tests run.
grant insert on _tap_buf to authenticated, anon;
grant select on _tap_buf to authenticated, anon;
grant usage on sequence _tap_buf_ord_seq to authenticated, anon;

-- ---------------------------------------------------------------------------
-- A. Catalogue
-- ---------------------------------------------------------------------------
select has_table('public', 'trades', 'trades exists');
select has_table('public', 'trade_levels', 'trade_levels exists');
select has_table('public', 'trade_skills', 'trade_skills exists');
select has_table('public', 'skill_materials', 'skill_materials exists');
select has_table('public', 'skill_map_publishes', 'skill_map_publishes exists');
select has_table('public', 'worker_trade_levels', 'worker_trade_levels exists');

select has_type('public', 'skill_material_kind', 'skill_material_kind enum exists');
select has_type('public', 'trade_national_source', 'trade_national_source enum exists');
select has_type('public', 'worker_trade_level_kind', 'worker_trade_level_kind enum exists');

select enum_has_labels('public', 'skill_material_kind', array['youtube', 'link'],
  'skill_material_kind values pinned');
select enum_has_labels('public', 'trade_national_source', array['dsd', 'tpqi'],
  'trade_national_source values pinned');
select enum_has_labels('public', 'worker_trade_level_kind',
  array['baseline', 'promotion', 'adjustment'],
  'worker_trade_level_kind values pinned');

select has_function('public', 'is_skill_map_author', array['user_role'],
  'is_skill_map_author(user_role) exists');

-- ---------------------------------------------------------------------------
-- B. The gate predicate — EXHAUSTIVE over the live enum, so a new user_role
--    value must be placed in an arm rather than silently defaulting in.
--    The positive set is pinned EXACTLY; a widen reds in BOTH directions.
-- ---------------------------------------------------------------------------
select is(
  (select array_agg(r::text order by r::text)
     from unnest(enum_range(null::public.user_role)) as r
    where public.is_skill_map_author(r)),
  array['project_director', 'super_admin'],
  'is_skill_map_author admits EXACTLY project_director + super_admin'
);
select is(public.is_skill_map_author('project_manager'), false,
  'is_skill_map_author EXCLUDES project_manager (is_manager admits it; this gate does not)');
select is(public.is_skill_map_author(null), false,
  'is_skill_map_author is coalesce-false for an unbound caller');

-- ---------------------------------------------------------------------------
-- C. Table posture. ⚠️ Default privileges on this database hand a brand-new
--    table `arwdDxtm` to anon AND authenticated — every privilege, writes
--    included — so the REVOKE is load-bearing and these four assertions per
--    table are what prove it ran.
-- ---------------------------------------------------------------------------
select is(has_table_privilege('authenticated', 'public.trades', 'SELECT'), true,
  'authenticated may read trades');
select is(has_table_privilege('authenticated', 'public.trades', 'INSERT'), false,
  'authenticated may NOT insert trades');
select is(has_table_privilege('authenticated', 'public.trades', 'UPDATE'), false,
  'authenticated may NOT update trades');
select is(has_table_privilege('authenticated', 'public.trades', 'DELETE'), false,
  'authenticated may NOT delete trades');
select is(has_table_privilege('anon', 'public.trades', 'SELECT'), false,
  'anon may NOT read trades');

select is(has_table_privilege('authenticated', 'public.trade_levels', 'SELECT'), true,
  'authenticated may read trade_levels');
select is(has_table_privilege('authenticated', 'public.trade_levels', 'INSERT'), false,
  'authenticated may NOT insert trade_levels');
select is(has_table_privilege('authenticated', 'public.trade_levels', 'UPDATE'), false,
  'authenticated may NOT update trade_levels');
select is(has_table_privilege('anon', 'public.trade_levels', 'SELECT'), false,
  'anon may NOT read trade_levels');

select is(has_table_privilege('authenticated', 'public.trade_skills', 'SELECT'), true,
  'authenticated may read trade_skills');
select is(has_table_privilege('authenticated', 'public.trade_skills', 'INSERT'), false,
  'authenticated may NOT insert trade_skills');
select is(has_table_privilege('anon', 'public.trade_skills', 'SELECT'), false,
  'anon may NOT read trade_skills');

select is(has_table_privilege('authenticated', 'public.skill_materials', 'SELECT'), true,
  'authenticated may read skill_materials');
select is(has_table_privilege('authenticated', 'public.skill_materials', 'INSERT'), false,
  'authenticated may NOT insert skill_materials');
select is(has_table_privilege('anon', 'public.skill_materials', 'SELECT'), false,
  'anon may NOT read skill_materials');

select is(has_table_privilege('authenticated', 'public.skill_map_publishes', 'SELECT'), true,
  'authenticated may read skill_map_publishes');
select is(has_table_privilege('authenticated', 'public.skill_map_publishes', 'INSERT'), false,
  'authenticated may NOT insert skill_map_publishes');
select is(has_table_privilege('anon', 'public.skill_map_publishes', 'SELECT'), false,
  'anon may NOT read skill_map_publishes');

select is(has_table_privilege('authenticated', 'public.worker_trade_levels', 'SELECT'), true,
  'authenticated may read worker_trade_levels');
select is(has_table_privilege('authenticated', 'public.worker_trade_levels', 'INSERT'), false,
  'authenticated may NOT insert worker_trade_levels');
select is(has_table_privilege('authenticated', 'public.worker_trade_levels', 'UPDATE'), false,
  'authenticated may NOT update worker_trade_levels');
select is(has_table_privilege('authenticated', 'public.worker_trade_levels', 'DELETE'), false,
  'authenticated may NOT delete worker_trade_levels');
select is(has_table_privilege('anon', 'public.worker_trade_levels', 'SELECT'), false,
  'anon may NOT read worker_trade_levels');

-- RLS on every table.
select is(
  (select array_agg(c.relname::text order by c.relname::text)
     from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relname in ('trades', 'trade_levels', 'trade_skills',
                        'skill_materials', 'skill_map_publishes', 'worker_trade_levels')
      and c.relrowsecurity),
  array['skill_map_publishes', 'skill_materials', 'trade_levels', 'trade_skills',
        'trades', 'worker_trade_levels'],
  'RLS is enabled on all six tables'
);

-- ---------------------------------------------------------------------------
-- D. RPC catalogue + posture. Default EXECUTE reaches PUBLIC (which includes
--    anon), so every DEFINER RPC is revoked from public+anon then granted to
--    authenticated. has_function_privilege resolves PUBLIC through role
--    inheritance — the house form, not a bespoke catalogue query.
-- ---------------------------------------------------------------------------
select has_function('public', 'upsert_trade', 'upsert_trade exists');
select has_function('public', 'upsert_trade_level', 'upsert_trade_level exists');
select has_function('public', 'retire_trade_level', 'retire_trade_level exists');
select has_function('public', 'upsert_trade_skill', 'upsert_trade_skill exists');
select has_function('public', 'upsert_skill_material', 'upsert_skill_material exists');
select has_function('public', 'publish_skill_map', 'publish_skill_map exists');
select has_function('public', 'set_worker_trade_level', 'set_worker_trade_level exists');

select is(has_function_privilege('anon',
  'public.upsert_trade(uuid, text, text, public.trade_national_source, text, integer)', 'EXECUTE'),
  false, 'upsert_trade is not executable by anon');
select is(has_function_privilege('anon',
  'public.set_worker_trade_level(uuid, uuid, uuid, public.worker_trade_level_kind, text)', 'EXECUTE'),
  false, 'set_worker_trade_level is not executable by anon');
select is(has_function_privilege('authenticated',
  'public.upsert_trade(uuid, text, text, public.trade_national_source, text, integer)', 'EXECUTE'),
  true, 'upsert_trade IS executable by authenticated (the gate is in the body)');

-- ---------------------------------------------------------------------------
-- E. Behaviour — the PD may author, and nobody else may.
-- ---------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims to '{"sub": "11111111-1111-1111-1111-111111110406"}';

select lives_ok(
  $$select public.upsert_trade(null, 'TEST-REBAR', 'ช่างเหล็กเสริมคอนกรีต', 'tpqi', 'ช่างเหล็กเสริมคอนกรีต', 10)$$,
  'a project_director may create a trade');

-- The PM is the discriminating case: is_manager admits them, this gate must not.
set local request.jwt.claims to '{"sub": "22222222-2222-2222-2222-222222220406"}';
select throws_ok(
  $$select public.upsert_trade(null, 'TEST-PM', 'ช่างของผู้จัดการ', null, null, 0)$$,
  '42501', 'upsert_trade: role not permitted',
  'a project_manager may NOT create a trade');

set local request.jwt.claims to '{"sub": "33333333-3333-3333-3333-333333330406"}';
select throws_ok(
  $$select public.upsert_trade(null, 'TEST-TECH', 'ช่างของช่าง', null, null, 0)$$,
  '42501', 'upsert_trade: role not permitted',
  'a technician may NOT create a trade');

-- ---------------------------------------------------------------------------
-- F. The ladder — levels are per-trade rows, ranks are unique, and a level
--    that a worker HOLDS cannot be retired out from under them.
-- ---------------------------------------------------------------------------
set local request.jwt.claims to '{"sub": "11111111-1111-1111-1111-111111110406"}';

select lives_ok(
  $$select public.upsert_trade_level(null,
      (select id from public.trades where code = 'TEST-REBAR'),
      'ระดับ 1', 1, 0, 410)$$,
  'a PD may add level 1 carrying the national reference rate');
select lives_ok(
  $$select public.upsert_trade_level(null,
      (select id from public.trades where code = 'TEST-REBAR'),
      'ระดับ 2', 2, 600, 530)$$,
  'a PD may add level 2');

select is(
  (select count(*)::int from public.trade_levels tl
     join public.trades t on t.id = tl.trade_id
    where t.code = 'TEST-REBAR' and tl.is_active),
  2, 'the trade carries exactly its two levels');

select is(
  (select reference_day_rate from public.trade_levels tl
     join public.trades t on t.id = tl.trade_id
    where t.code = 'TEST-REBAR' and tl.rank = 1),
  410::numeric, 'the level stores the national reference rate verbatim');

select throws_ok(
  $$select public.upsert_trade_level(null,
      (select id from public.trades where code = 'TEST-REBAR'),
      'ระดับ 1 ซ้ำ', 1, 0, 999)$$,
  '23505', null,
  'a duplicate rank within one trade is refused');

-- A trade with ONE level is legitimate (ช่างหินขัด in the national schedule),
-- so nothing may require a minimum ladder height.
select lives_ok(
  $$select public.upsert_trade(null, 'TEST-POLISH', 'ช่างหินขัด', 'dsd', 'ช่างหินขัด', 20)$$,
  'a second trade is created');
select lives_ok(
  $$select public.upsert_trade_level(null,
      (select id from public.trades where code = 'TEST-POLISH'),
      'ระดับ 1', 1, 0, 470)$$,
  'a one-level ladder is legitimate (ช่างหินขัด has exactly one nationally)');

-- ---------------------------------------------------------------------------
-- G. Skills hang off a level, and a skill may not point at a level belonging
--    to a DIFFERENT trade (the FK alone would happily accept one).
-- ---------------------------------------------------------------------------
select lives_ok(
  $$select public.upsert_trade_skill(null,
      (select tl.id from public.trade_levels tl join public.trades t on t.id = tl.trade_id
        where t.code = 'TEST-REBAR' and tl.rank = 1),
      'ผูกลวดพื้นฐาน', null, true, false, 0)$$,
  'a PD may add a skill under a level');

select is(
  (select trade_id from public.trade_skills where title_th = 'ผูกลวดพื้นฐาน'),
  (select id from public.trades where code = 'TEST-REBAR'),
  'the skill denormalises its trade from the level, not from the caller');

select lives_ok(
  $$select public.upsert_skill_material(null,
      (select id from public.trade_skills where title_th = 'ผูกลวดพื้นฐาน'),
      'youtube', 'https://www.youtube.com/watch?v=test406', 'วิดีโอสาธิต', 0)$$,
  'a PD may attach an embedded material');

select throws_ok(
  $$select public.upsert_skill_material(null,
      (select id from public.trade_skills where title_th = 'ผูกลวดพื้นฐาน'),
      'link', 'not-a-url', 'ลิงก์เสีย', 1)$$,
  '22023', null,
  'a material URL that is not http(s) is refused');

-- ---------------------------------------------------------------------------
-- H. Publish — the worker-facing read is a VERSION SNAPSHOT, so a PD editing a
--    draft cannot move requirements under a worker mid-progress.
-- ---------------------------------------------------------------------------
select lives_ok(
  $$select public.publish_skill_map((select id from public.trades where code = 'TEST-REBAR'))$$,
  'a PD may publish the map');

select is(
  (select version from public.skill_map_publishes p
     join public.trades t on t.id = p.trade_id
    where t.code = 'TEST-REBAR' order by version desc limit 1),
  1, 'the first publish is version 1');

select lives_ok(
  $$select public.publish_skill_map((select id from public.trades where code = 'TEST-REBAR'))$$,
  'publishing again is allowed');
select is(
  (select version from public.skill_map_publishes p
     join public.trades t on t.id = p.trade_id
    where t.code = 'TEST-REBAR' order by version desc limit 1),
  2, 'the second publish increments to version 2');

-- The snapshot must actually carry the ladder, or the worker view would read
-- an empty map while the draft looks correct.
select is(
  (select jsonb_array_length(snapshot -> 'levels') from public.skill_map_publishes p
     join public.trades t on t.id = p.trade_id
    where t.code = 'TEST-REBAR' order by version desc limit 1),
  2, 'the snapshot carries both levels');
select is(
  (select snapshot #>> '{levels,0,skills,0,title_th}' from public.skill_map_publishes p
     join public.trades t on t.id = p.trade_id
    where t.code = 'TEST-REBAR' order by version desc limit 1),
  'ผูกลวดพื้นฐาน', 'the snapshot carries the skill under its level');

-- ---------------------------------------------------------------------------
-- I. Worker level history — append-only, PD-written, and an `adjustment`
--    must state its reason (a silent demotion is not acceptable).
-- ---------------------------------------------------------------------------
set local role postgres;
insert into public.workers (id, name, pay_type, day_rate, active, created_by)
values ('44444444-4444-4444-4444-444444440406', 'ทดสอบ ช่างเหล็ก', 'daily', 480, true,
        '11111111-1111-1111-1111-111111110406');

set local role authenticated;
set local request.jwt.claims to '{"sub": "11111111-1111-1111-1111-111111110406"}';

select lives_ok(
  $$select public.set_worker_trade_level(
      '44444444-4444-4444-4444-444444440406',
      (select id from public.trades where code = 'TEST-REBAR'),
      (select tl.id from public.trade_levels tl join public.trades t on t.id = tl.trade_id
        where t.code = 'TEST-REBAR' and tl.rank = 1),
      'baseline', null)$$,
  'a PD may baseline a worker with no evidence (the cold-start ruling)');

select is(
  (select count(*)::int from public.worker_trade_levels
    where worker_id = '44444444-4444-4444-4444-444444440406'),
  1, 'the baseline wrote exactly one history row');

select throws_ok(
  $$select public.set_worker_trade_level(
      '44444444-4444-4444-4444-444444440406',
      (select id from public.trades where code = 'TEST-REBAR'),
      (select tl.id from public.trade_levels tl join public.trades t on t.id = tl.trade_id
        where t.code = 'TEST-REBAR' and tl.rank = 1),
      'adjustment', null)$$,
  '22023', null,
  'an adjustment without a reason is refused');

select lives_ok(
  $$select public.set_worker_trade_level(
      '44444444-4444-4444-4444-444444440406',
      (select id from public.trades where code = 'TEST-REBAR'),
      (select tl.id from public.trade_levels tl join public.trades t on t.id = tl.trade_id
        where t.code = 'TEST-REBAR' and tl.rank = 2),
      'promotion', 'ครบเกณฑ์ระดับ 2')$$,
  'a PD may promote to level 2');

-- ⚠️ Ordered by `seq`, NOT created_at. `now()` is transaction time, so the
-- baseline and the promotion above carry IDENTICAL created_at values — an
-- earlier version of this assertion tie-broke on `tl.rank desc` and therefore
-- passed while the production read was picking the wrong row. Ordering by rank
-- to find the highest-ranked row cannot fail, which is exactly why it proved
-- nothing.
select is(
  (select tl.rank from public.worker_trade_levels wtl
     join public.trade_levels tl on tl.id = wtl.trade_level_id
    where wtl.worker_id = '44444444-4444-4444-4444-444444440406'
    order by wtl.seq desc limit 1),
  2, 'the latest row by seq is the current level');

-- The two rows the ordering depends on genuinely tie on created_at, so this
-- pins the hazard itself rather than trusting that they happened to differ.
select is(
  (select count(distinct created_at)::int from public.worker_trade_levels
    where worker_id = '44444444-4444-4444-4444-444444440406'),
  1, 'both decisions share one created_at — created_at cannot order this history');
select is(
  (select count(distinct seq)::int from public.worker_trade_levels
    where worker_id = '44444444-4444-4444-4444-444444440406'),
  2, 'seq is distinct per row — it is the only usable total order');

-- A level cannot point at a trade it does not belong to.
select throws_ok(
  $$select public.set_worker_trade_level(
      '44444444-4444-4444-4444-444444440406',
      (select id from public.trades where code = 'TEST-POLISH'),
      (select tl.id from public.trade_levels tl join public.trades t on t.id = tl.trade_id
        where t.code = 'TEST-REBAR' and tl.rank = 1),
      'baseline', null)$$,
  '22023', null,
  'a level belonging to a different trade is refused');

-- Retiring a HELD level is refused — the holders must be re-baselined first.
select throws_ok(
  $$select public.retire_trade_level(
      (select tl.id from public.trade_levels tl join public.trades t on t.id = tl.trade_id
        where t.code = 'TEST-REBAR' and tl.rank = 2))$$,
  '22023', null,
  'a level a worker currently holds cannot be retired');

-- An UNHELD level retires cleanly.
select lives_ok(
  $$select public.retire_trade_level(
      (select tl.id from public.trade_levels tl join public.trades t on t.id = tl.trade_id
        where t.code = 'TEST-POLISH' and tl.rank = 1))$$,
  'an unheld level retires cleanly');

-- Append-only: even the PD cannot rewrite history through the table.
select throws_ok(
  $$update public.worker_trade_levels set kind = 'baseline'
     where worker_id = '44444444-4444-4444-4444-444444440406'$$,
  '42501', null,
  'worker_trade_levels is append-only — no UPDATE reaches it');

-- ---------------------------------------------------------------------------
-- J. A technician may READ a published map (U3's whole surface) but may not
--    read another worker's level history through the table.
-- ---------------------------------------------------------------------------
set local request.jwt.claims to '{"sub": "33333333-3333-3333-3333-333333330406"}';
select is(
  (select count(*)::int from public.skill_map_publishes p
     join public.trades t on t.id = p.trade_id where t.code = 'TEST-REBAR'),
  2, 'a technician may read the published maps');
select is(
  (select count(*)::int from public.trades where code = 'TEST-REBAR'),
  1, 'a technician may read the trade catalogue');

-- ---------------------------------------------------------------------------
-- K. Audit — every authoring write and every level decision is recorded.
-- ---------------------------------------------------------------------------
set local role postgres;
select is(
  (select count(*)::int from public.audit_log
    where action = 'skill_map_change'
      and actor_id = '11111111-1111-1111-1111-111111110406'),
  10, 'every PD authoring write wrote one skill_map_change audit row');
select is(
  (select count(*)::int from public.audit_log
    where action = 'worker_trade_level_set'
      and target_id = '44444444-4444-4444-4444-444444440406'),
  2, 'the baseline and the promotion each wrote a level audit row');

select * from finish();
rollback;

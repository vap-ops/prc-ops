begin;
select plan(32);

-- ============================================================================
-- Spec 391 U1 — ตัวอย่างงาน fills itself.
--
-- `wp_catalog_reference_photos` holds 0 rows, so the section 389 U5 shipped has
-- never rendered anything. The reader gains a DERIVED arm: `after`/`after_fix`
-- photos of complete, mapped, NON-GROUP WPs, newest first, capped at 4 — with
-- explicit stars pinned ahead of them, and a PD able to HIDE one.
--
-- ⚠️ The signature is UNCHANGED on purpose. A second argument would create an
-- OVERLOAD, not a replacement, and the shipped 1-arg caller would stay bound to
-- the old body forever — seeing no derived photo, with every test here green.
--
-- ⚠️ Hiding lives in its OWN table. `wp_catalog_reference_photos.starred_by` is
-- NOT NULL (a hide-only row has nothing to put there), and the shipped
-- `unstar_reference_photo` deletes by photo id with NO guard — a shared table
-- would let un-starring silently delete a hide. Asserted below, because that is
-- the defect the separate table exists to prevent.
-- ============================================================================

grant insert on _tap_buf to authenticated, anon;
grant select on _tap_buf to authenticated, anon;
grant usage  on sequence _tap_buf_ord_seq to authenticated, anon;

create temp table _ids (k text primary key, id uuid);
grant select, insert on _ids to authenticated, anon;

insert into auth.users (id, email, raw_user_meta_data) values
  ('70000000-0391-0391-0391-700000000391', 'pd@s391.local',      '{}'::jsonb),
  ('71000000-0391-0391-0391-710000000391', 'visitor@s391.local', '{}'::jsonb);
update public.users set role = 'project_director' where id = '70000000-0391-0391-0391-700000000391';
update public.users set role = 'visitor'          where id = '71000000-0391-0391-0391-710000000391';

insert into public.projects (id, code, name) values
  ('a1000000-0391-0391-0391-a10000000391', 'TAP-391', 'โครงการทดสอบตัวอย่างงาน');

-- One catalog item, reached by several WPs — the real shape (many WPs across
-- projects map to one item), and what makes the cap a per-ITEM rule.
-- code_prefix is NOT NULL (as are code and name) — the first draft of this
-- fixture omitted it and the whole file errored with 23502 rather than failing
-- an assertion, which is why the RED had to be proven behaviourally against
-- live rows instead.
insert into public.wp_catalog_items (id, code, name, code_prefix) values
  ('c1000000-0391-0391-0391-c10000000391', 'T391-01', 'งานทดสอบตัวอย่าง', 'T391');

-- Leaves go in BEFORE any group: `wp_hierarchy_guard` requires a parent for a
-- new leaf only once the project already holds a group row.
insert into public.work_packages (id, project_id, code, name, is_group, status, wp_catalog_item_id) values
  -- the ordinary candidate source
  ('d1000000-0391-0391-0391-d10000000391', 'a1000000-0391-0391-0391-a10000000391',
   'W391-01', 'งานเสร็จแล้ว', false, 'complete', 'c1000000-0391-0391-0391-c10000000391'),
  -- not confirmed — must contribute nothing
  ('d2000000-0391-0391-0391-d20000000391', 'a1000000-0391-0391-0391-a10000000391',
   'W391-02', 'งานรออนุมัติ', false, 'pending_approval', 'c1000000-0391-0391-0391-c10000000391');

-- A group, purely to pin the guarantee below.
insert into public.work_packages (id, project_id, code, name, is_group, status, wp_catalog_item_id) values
  ('d3000000-0391-0391-0391-d30000000391', 'a1000000-0391-0391-0391-a10000000391',
   'G391-01', 'กลุ่มงาน', true, 'not_started', 'c1000000-0391-0391-0391-c10000000391');

-- Photos. created_at is set explicitly so "newest first" is deterministic —
-- inserting in order would otherwise leave the ordering to clock resolution.
insert into public.photo_logs (id, work_package_id, phase, storage_path, uploaded_by, created_at, rework_round) values
  -- WP1: two `after` + one `during` (excluded) + one `after_fix`
  ('f1000000-0391-0391-0391-f10000000391', 'd1000000-0391-0391-0391-d10000000391',
   'after',     'p/391/a1.jpg', '70000000-0391-0391-0391-700000000391', now() - interval '5 hours', 0),
  ('f2000000-0391-0391-0391-f20000000391', 'd1000000-0391-0391-0391-d10000000391',
   'after',     'p/391/a2.jpg', '70000000-0391-0391-0391-700000000391', now() - interval '4 hours', 0),
  ('f3000000-0391-0391-0391-f30000000391', 'd1000000-0391-0391-0391-d10000000391',
   'during',    'p/391/d1.jpg', '70000000-0391-0391-0391-700000000391', now() - interval '3 hours', 0),
  ('f4000000-0391-0391-0391-f40000000391', 'd1000000-0391-0391-0391-d10000000391',
   'after_fix', 'p/391/x1.jpg', '70000000-0391-0391-0391-700000000391', now() - interval '2 hours', 0),
  -- WP2 (pending_approval) and WP3 (group): each an `after` that must be ignored
  ('f5000000-0391-0391-0391-f50000000391', 'd2000000-0391-0391-0391-d20000000391',
   'after',     'p/391/b1.jpg', '70000000-0391-0391-0391-700000000391', now() - interval '1 hours', 0);

-- ============================================================================
-- A. The DERIVED arm — the whole point of the spec.
-- ============================================================================
select is(
  (select count(*)::int from public.get_wp_reference_photos('c1000000-0391-0391-0391-c10000000391', '00000000-0000-0000-0000-000000000000')),
  3,
  'derives the 3 eligible photos of the complete leaf WP (2 after + 1 after_fix)');

-- ⭐ U1b — THE BUG THIS UNIT SHIPPED AND HAD TO FIX, now pinned.
--
-- The reader knew only the catalog ITEM, so a completed WP was served its OWN
-- photos as its own ตัวอย่างงาน — measured on live data: 144 of 144 complete
-- mapped WPs, 403 of 403 photos, rendered directly above the same photos in the
-- WP's own gallery, with zero cross-project content anywhere. The whole point of
-- the section is the OTHER project's work.
--
-- Note what an item-only assertion cannot see: every test above passes with the
-- bug present, because they never ask WHOSE photos came back. That is exactly
-- the gap the U1 review flagged — "now returns 4" proved rows come back, not
-- which 4.
select is(
  (select count(*)::int from public.get_wp_reference_photos(
     'c1000000-0391-0391-0391-c10000000391', 'd1000000-0391-0391-0391-d10000000391')),
  0,
  'a WP is never its OWN example — excluding it leaves nothing here, since it is the only source');

-- …and the exclusion is SCOPED, not a blanket off-switch: naming a different WP
-- must not suppress the real candidates.
select is(
  (select count(*)::int from public.get_wp_reference_photos(
     'c1000000-0391-0391-0391-c10000000391', 'd2000000-0391-0391-0391-d20000000391')),
  3,
  'excluding a DIFFERENT WP leaves all 3 — the filter targets one WP, not the arm');

-- POSITIVE CONTROL, stated as its own assertion: an empty result would satisfy
-- every exclusion test below, so prove a real photo comes back by identity.
select ok(
  exists (select 1 from public.get_wp_reference_photos('c1000000-0391-0391-0391-c10000000391', '00000000-0000-0000-0000-000000000000')
           where photo_log_id = 'f4000000-0391-0391-0391-f40000000391'),
  'the after_fix photo is among them (positive control — the arm really returns rows)');

select ok(
  not exists (select 1 from public.get_wp_reference_photos('c1000000-0391-0391-0391-c10000000391', '00000000-0000-0000-0000-000000000000')
               where photo_log_id = 'f3000000-0391-0391-0391-f30000000391'),
  'a `during` photo is NOT an example — it shows what happened, not what done looks like');

select ok(
  not exists (select 1 from public.get_wp_reference_photos('c1000000-0391-0391-0391-c10000000391', '00000000-0000-0000-0000-000000000000')
               where photo_log_id = 'f5000000-0391-0391-0391-f50000000391'),
  'a photo from a pending_approval WP is NOT derived — only confirmed work');

-- ⭐ The spec asked for an `is_group` filter in the derived arm, on the reasoning
-- that a group rolls up to complete arithmetically. It was NOT built, because
-- `wp_reject_group_binding()` already refuses any photo bound to a group — the
-- predicate would have been UNREACHABLE, and an unreachable clause asserts a
-- hazard that is not there (spec 340's lesson, three migrations to undo).
-- So pin the REAL guarantee instead. If this trigger is ever relaxed, this test
-- reds and whoever relaxed it learns the derived arm now needs that filter.
select throws_ok(
  $$ insert into public.photo_logs (work_package_id, phase, storage_path, uploaded_by)
     values ('d3000000-0391-0391-0391-d30000000391', 'after', 'p/391/g1.jpg',
             '70000000-0391-0391-0391-700000000391') $$,
  '23514',
  null,
  'a group WP cannot own a photo at all — which is WHY the derived arm needs no is_group filter');

select is(
  (select photo_log_id from public.get_wp_reference_photos('c1000000-0391-0391-0391-c10000000391', '00000000-0000-0000-0000-000000000000') limit 1),
  'f4000000-0391-0391-0391-f40000000391'::uuid,
  'newest first');

-- Derived rows carry NULL starred_by — which is what lets the UI mark the
-- explicitly starred ones (D7) without a second query.
select ok(
  (select bool_and(starred_by is null)
     from public.get_wp_reference_photos('c1000000-0391-0391-0391-c10000000391', '00000000-0000-0000-0000-000000000000')),
  'derived rows report starred_by NULL, so the UI can tell them from real stars');

-- ============================================================================
-- B. Superseded / tombstoned photos stay out (the shipped reader's rule, which
--    the new derived arm must not lose).
-- ============================================================================
-- A TOMBSTONE, not a replacement row: `photo_logs_path_supersede_well_formed`
-- enforces `(storage_path is null) = (superseded_by is not null)` (ADR 0015), so
-- a row carrying both a path and a supersede pointer is rejected outright. This
-- is the shape the app actually writes when a photo is removed.
insert into public.photo_logs (id, work_package_id, phase, storage_path, uploaded_by, created_at, rework_round, superseded_by)
values ('f7000000-0391-0391-0391-f70000000391', 'd1000000-0391-0391-0391-d10000000391',
        'after', null, '70000000-0391-0391-0391-700000000391', now(), 0,
        'f1000000-0391-0391-0391-f10000000391');

select ok(
  not exists (select 1 from public.get_wp_reference_photos('c1000000-0391-0391-0391-c10000000391', '00000000-0000-0000-0000-000000000000')
               where photo_log_id = 'f1000000-0391-0391-0391-f10000000391'),
  'a SUPERSEDED photo drops out of the derived arm');

-- ============================================================================
-- C. The cap. Five candidates, four rendered.
-- ============================================================================
insert into public.photo_logs (id, work_package_id, phase, storage_path, uploaded_by, created_at, rework_round) values
  ('f8000000-0391-0391-0391-f80000000391', 'd1000000-0391-0391-0391-d10000000391',
   'after', 'p/391/a4.jpg', '70000000-0391-0391-0391-700000000391', now() - interval '10 minutes', 0),
  ('f9000000-0391-0391-0391-f90000000391', 'd1000000-0391-0391-0391-d10000000391',
   'after', 'p/391/a5.jpg', '70000000-0391-0391-0391-700000000391', now() - interval '5 minutes', 0);

select is(
  (select count(*)::int from public.get_wp_reference_photos('c1000000-0391-0391-0391-c10000000391', '00000000-0000-0000-0000-000000000000')),
  4,
  'the cap holds at 4 with 5 candidates');

-- ============================================================================
-- D. HIDE — PD tier, and it wins over both arms.
-- ============================================================================
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "71000000-0391-0391-0391-710000000391"}';
select throws_ok(
  $$ select public.hide_reference_photo('f9000000-0391-0391-0391-f90000000391') $$,
  '42501',
  null,
  'a visitor cannot hide a reference photo');
reset role;

set local role authenticated;
set local "request.jwt.claims" = '{"sub": "70000000-0391-0391-0391-700000000391"}';
select lives_ok(
  $$ select public.hide_reference_photo('f9000000-0391-0391-0391-f90000000391') $$,
  'a project_director can hide one');
reset role;

select ok(
  not exists (select 1 from public.get_wp_reference_photos('c1000000-0391-0391-0391-c10000000391', '00000000-0000-0000-0000-000000000000')
               where photo_log_id = 'f9000000-0391-0391-0391-f90000000391'),
  'the hidden photo leaves the derived arm');

-- ============================================================================
-- E. Stars pin AHEAD of derived, and hiding beats starring.
-- ============================================================================
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "70000000-0391-0391-0391-700000000391"}';
select public.star_reference_photo('f2000000-0391-0391-0391-f20000000391', 'ตัวอย่างที่ดี');
reset role;

select is(
  (select photo_log_id from public.get_wp_reference_photos('c1000000-0391-0391-0391-c10000000391', '00000000-0000-0000-0000-000000000000') limit 1),
  'f2000000-0391-0391-0391-f20000000391'::uuid,
  'a starred photo pins to the FRONT, ahead of newer derived ones');

select is(
  (select count(*)::int from public.get_wp_reference_photos('c1000000-0391-0391-0391-c10000000391', '00000000-0000-0000-0000-000000000000')
    where photo_log_id = 'f2000000-0391-0391-0391-f20000000391'),
  1,
  'and it appears ONCE — starring a photo that was already derived must not double it');

set local role authenticated;
set local "request.jwt.claims" = '{"sub": "70000000-0391-0391-0391-700000000391"}';
select public.hide_reference_photo('f2000000-0391-0391-0391-f20000000391');
reset role;

select ok(
  not exists (select 1 from public.get_wp_reference_photos('c1000000-0391-0391-0391-c10000000391', '00000000-0000-0000-0000-000000000000')
               where photo_log_id = 'f2000000-0391-0391-0391-f20000000391'),
  'hiding beats starring — a hidden photo is gone from the starred arm too');

-- ⭐ THE DEFECT THE SEPARATE TABLE EXISTS TO PREVENT. `unstar_reference_photo`
-- deletes by photo id with no guard; had the hide lived in the same table, this
-- call would have deleted it and the photo would silently return.
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "70000000-0391-0391-0391-700000000391"}';
select public.unstar_reference_photo('f2000000-0391-0391-0391-f20000000391');
reset role;

select ok(
  not exists (select 1 from public.get_wp_reference_photos('c1000000-0391-0391-0391-c10000000391', '00000000-0000-0000-0000-000000000000')
               where photo_log_id = 'f2000000-0391-0391-0391-f20000000391'),
  'un-starring a HIDDEN photo leaves it hidden — the shared-table defect, pinned');

-- ============================================================================
-- F. Grants. A new function carries a default PUBLIC EXECUTE (#833), so the
--    revoke must name `public` as well as `anon`; has_function_privilege on
--    'anon' resolves PUBLIC through role inheritance.
-- ============================================================================
select ok(
  not has_function_privilege('anon', 'public.hide_reference_photo(uuid)', 'execute'),
  'anon cannot execute hide_reference_photo');
select ok(
  has_function_privilege('authenticated', 'public.hide_reference_photo(uuid)', 'execute'),
  'authenticated CAN (positive control for the grant)');

-- unhide was entirely uncovered in the first draft, though §4 promised "anon
-- cannot execute EITHER writer". A body that deletes nothing, or one grantable
-- by anon, would have shipped green.
select ok(
  not has_function_privilege('anon', 'public.unhide_reference_photo(uuid)', 'execute'),
  'anon cannot execute unhide_reference_photo');

set local role authenticated;
set local "request.jwt.claims" = '{"sub": "71000000-0391-0391-0391-710000000391"}';
select throws_ok(
  $$ select public.unhide_reference_photo('f9000000-0391-0391-0391-f90000000391') $$,
  '42501',
  null,
  'a visitor cannot UNhide either — the gate is on both directions');
reset role;

set local role authenticated;
set local "request.jwt.claims" = '{"sub": "70000000-0391-0391-0391-700000000391"}';
select public.unhide_reference_photo('f9000000-0391-0391-0391-f90000000391');
reset role;

select ok(
  exists (select 1 from public.get_wp_reference_photos('c1000000-0391-0391-0391-c10000000391', '00000000-0000-0000-0000-000000000000')
           where photo_log_id = 'f9000000-0391-0391-0391-f90000000391'),
  'unhide RESTORES the photo — not just a no-op that returns cleanly');

-- U2 — the table's read posture. `/review` reads it directly to render the
-- toggle's state, and a zero-grant table returns ZERO ROWS to the RLS client
-- rather than erroring: the control would have shown "not hidden" for every
-- photo, and the bug would have looked like a failed write.
-- COLUMN privilege, not table. 075901 narrowed the grant to `photo_log_id` — the
-- one column /review selects — so `hidden_by` and `created_at` (who suppressed
-- what, and when) stay closed. `has_table_privilege(..., 'select')` is FALSE for
-- a column-only grant, which is how the narrowing caught this assertion.
select ok(
  has_column_privilege(
    'authenticated', 'public.wp_catalog_hidden_reference_photos', 'photo_log_id', 'select'),
  'authenticated can read photo_log_id (the toggle needs its own state)');
select ok(
  not has_column_privilege(
    'authenticated', 'public.wp_catalog_hidden_reference_photos', 'hidden_by', 'select'),
  'but NOT hidden_by — who suppressed a photo is not firm-wide reading');
select ok(
  not has_table_privilege('authenticated', 'public.wp_catalog_hidden_reference_photos', 'insert')
    and not has_table_privilege('authenticated', 'public.wp_catalog_hidden_reference_photos', 'delete'),
  'but cannot write it directly — the PD gate lives in the DEFINER pair, not in a policy');

-- The reader's own posture must be UNCHANGED by this unit — 389 U5 chose it
-- deliberately and `389-wp-catalog.test.sql:96` pins it. Re-asserted here so a
-- careless body replacement that also touched grants fails in BOTH files.
-- (uuid, uuid) since U1b. `has_function_privilege` needs an EXACT signature and
-- raises 42883 otherwise — which is how this assertion caught the drop, and why
-- a literal-signature pin is worth keeping rather than softening.
select ok(
  not has_function_privilege('anon', 'public.get_wp_reference_photos(uuid, uuid)', 'execute'),
  'the reader stays un-executable by anon — this unit changes the body, not the posture');

-- ============================================================================
-- H. U2b — the STARRED arm had the same self-reference bug, and the shipped UI
--    can only ever create the case that triggers it.
--
--    The ⭐ renders only on /review/work-packages/[id], and star_reference_photo
--    derives the item from the photo's OWN WP — so every star the app can create
--    is a self-reference. Left pinned at tier 0, four stars would fill the cap
--    and the section would become 100% the viewing WP's own photos, above the
--    identical gallery, with the subtitle crediting the PD for it.
-- ============================================================================
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "70000000-0391-0391-0391-700000000391"}';
-- f8, not f1: section B superseded f1 with a tombstone, and star_reference_photo
-- refuses a superseded photo (22023). Using it here errored the whole file.
select public.star_reference_photo('f8000000-0391-0391-0391-f80000000391', null);
reset role;

select ok(
  not exists (select 1 from public.get_wp_reference_photos(
                'c1000000-0391-0391-0391-c10000000391', 'd1000000-0391-0391-0391-d10000000391')
               where photo_log_id = 'f8000000-0391-0391-0391-f80000000391'),
  'a STARRED photo is excluded on its own WP too — parity with the derived arm');

select ok(
  exists (select 1 from public.get_wp_reference_photos(
            'c1000000-0391-0391-0391-c10000000391', 'd2000000-0391-0391-0391-d20000000391')
           where photo_log_id = 'f8000000-0391-0391-0391-f80000000391'),
  '…and still ranks first on every OTHER WP of the type — the star is not lost');

-- The section's subtitle claims ทำเสร็จแล้ว. /review is a pending_approval
-- surface, so a star is always applied BEFORE the WP is finished; without a
-- status filter on the starred arm that claim was false for any WP that never
-- completed. The star now activates on completion.
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "70000000-0391-0391-0391-700000000391"}';
select public.star_reference_photo('f5000000-0391-0391-0391-f50000000391', null);
reset role;

-- RECORDED DECISION, asserted in the direction it actually holds. A star on a
-- not-yet-complete WP DOES render — spec 389 U5 shipped the starred arm with no
-- status condition, and the ⭐ lives on /review, a pending_approval surface, so
-- every star is applied before completion.
--
-- 075901 added `w.status = 'complete'` here to make the subtitle's ทำเสร็จแล้ว
-- claim true; it red FIVE of spec 389's assertions and was reverted in 075902.
-- The claim was removed from the COPY instead. This assertion is what stops the
-- next author re-adding the filter without meeting 389's contract first.
select ok(
  exists (select 1 from public.get_wp_reference_photos(
            'c1000000-0391-0391-0391-c10000000391', 'd1000000-0391-0391-0391-d10000000391')
           where photo_log_id = 'f5000000-0391-0391-0391-f50000000391'),
  'a star on a not-yet-complete WP DOES render — 389s contract; the copy must not claim finished');

-- ============================================================================
-- I. The exclusion argument is REQUIRED. With a default, omitting it was silent
--    — PostgREST resolves the 1-arg call and returns the un-excluded set, so a
--    future caller reintroduces the 403-of-403 bug with a green suite. Without
--    one, the same mistake is a hard 42883 / PGRST202.
-- ============================================================================
select throws_ok(
  $$ select * from public.get_wp_reference_photos('c1000000-0391-0391-0391-c10000000391') $$,
  '42883',
  null,
  'calling the reader WITHOUT the exclusion is an error, not a silent full set');

-- ============================================================================
-- J. The hidden table's RLS POLICY, not just its grant.
--
--    ⚠️ has_table_privilege answers a question about GRANT and says nothing about
--    RLS. Deleting the policy in 075900 while leaving the grant kept every other
--    assertion green — and regressed /review to the exact bug that migration
--    exists to fix: zero rows to the RLS client, every tile reading "not hidden",
--    a hide that springs back. So read it AS the role.
-- ============================================================================
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "70000000-0391-0391-0391-710000000391"}';
select is(
  -- count(photo_log_id), not count(*): `count(*)` needs no column and so would
  -- pass even under a grant that exposed nothing readable. Naming the granted
  -- column exercises the grant AND the policy together, which is the pair this
  -- assertion exists for.
  (select count(photo_log_id)::int from public.wp_catalog_hidden_reference_photos),
  1,
  'an authenticated caller can actually READ the hidden rows (policy, not just grant)');
reset role;

select * from finish();
rollback;
